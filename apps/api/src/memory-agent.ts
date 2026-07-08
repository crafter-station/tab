import {
  MemoryExtractionRequestSchema,
  type MemoryExtractionCounts,
  type MemoryExtractionRequest,
  type MemoryJob,
  type PersonalMemory,
} from "@tab/contracts";
import { generateText, Output } from "ai";
import type { PersonalMemoryService } from "./personal-memory.ts";
import {
  PersonalMemoryPolicy,
  hasDurableExtractionResult,
  type ProposedMemoryOperation,
} from "./personal-memory-policy.ts";
import { env } from "./env.ts";
import { z } from "zod";
import { and, eq, gt } from "drizzle-orm";
import type { AppDatabase } from "./db/index.ts";
import { memoryExtractionIdempotency } from "./db/schema.ts";

const EXTRACTION_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export type { MemoryJob };
export type { ProposedMemoryOperation } from "./personal-memory-policy.ts";

export const MEMORY_EXTRACTION_MODEL_ID = "openai/gpt-5.5";

const MemoryOperationOutputSchema = z.object({
  operations: z.array(
    z.object({
      type: z.enum(["create", "update", "delete"]),
      id: z.string(),
      content: z.string(),
      reason: z.string(),
    }),
  ),
});

function toProposedMemoryOperation(
  operation: z.infer<typeof MemoryOperationOutputSchema>["operations"][number],
): ProposedMemoryOperation | null {
  switch (operation.type) {
    case "create":
      return operation.content?.trim()
        ? {
            type: "create",
            content: operation.content,
            ...(operation.reason?.trim() && { reason: operation.reason }),
          }
        : null;
    case "update":
      return operation.id?.trim() && operation.content?.trim()
        ? {
            type: "update",
            id: operation.id,
            content: operation.content,
            ...(operation.reason?.trim() && { reason: operation.reason }),
          }
        : null;
    case "delete":
      return operation.id?.trim() && operation.reason?.trim()
        ? {
            type: "delete",
            id: operation.id,
            reason: operation.reason,
          }
        : null;
  }
}

function toProposedMemoryOperations(
  operations: z.infer<typeof MemoryOperationOutputSchema>["operations"],
): ProposedMemoryOperation[] {
  return operations
    .map(toProposedMemoryOperation)
    .filter((operation): operation is ProposedMemoryOperation => operation !== null);
}

async function hashExtractionBatchId(
  userId: string,
  batchId: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(`${userId}:${batchId}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export interface MemoryAgentModel {
  proposeOperations(
    job: MemoryJob,
    memories: readonly PersonalMemory[],
  ): Promise<readonly ProposedMemoryOperation[]>;
}

export interface MemoryExtractionIdempotencyStorage {
  findResult(
    userId: string,
    batchIdHash: string,
    now: Date,
  ): Promise<MemoryExtractionCounts | null>;
  saveResult(input: {
    readonly userId: string;
    readonly batchIdHash: string;
    readonly counts: MemoryExtractionCounts;
    readonly expiresAt: Date;
  }): Promise<void>;
}

export class InMemoryMemoryExtractionIdempotencyStorage
  implements MemoryExtractionIdempotencyStorage
{
  private readonly results = new Map<
    string,
    { counts: MemoryExtractionCounts; expiresAt: Date }
  >();

  async findResult(
    userId: string,
    batchIdHash: string,
    now: Date,
  ): Promise<MemoryExtractionCounts | null> {
    const key = `${userId}:${batchIdHash}`;
    const result = this.results.get(key);
    if (!result) return null;
    if (result.expiresAt <= now) {
      this.results.delete(key);
      return null;
    }
    return result.counts;
  }

  async saveResult(input: {
    readonly userId: string;
    readonly batchIdHash: string;
    readonly counts: MemoryExtractionCounts;
    readonly expiresAt: Date;
  }): Promise<void> {
    this.results.set(`${input.userId}:${input.batchIdHash}`, {
      counts: input.counts,
      expiresAt: input.expiresAt,
    });
  }
}

export class D1MemoryExtractionIdempotencyStorage
  implements MemoryExtractionIdempotencyStorage
{
  constructor(private readonly db: AppDatabase) {}

  async findResult(
    userId: string,
    batchIdHash: string,
    now: Date,
  ): Promise<MemoryExtractionCounts | null> {
    const row = await this.db.query.memoryExtractionIdempotency.findFirst({
      where: and(
        eq(memoryExtractionIdempotency.userId, userId),
        eq(memoryExtractionIdempotency.batchIdHash, batchIdHash),
        gt(memoryExtractionIdempotency.expiresAt, now.toISOString()),
      ),
    });

    if (!row) return null;
    return {
      created: row.created,
      updated: row.updated,
      deleted: row.deleted,
      rejected: row.rejected,
    };
  }

  async saveResult(input: {
    readonly userId: string;
    readonly batchIdHash: string;
    readonly counts: MemoryExtractionCounts;
    readonly expiresAt: Date;
  }): Promise<void> {
    await this.db.insert(memoryExtractionIdempotency).values({
      userId: input.userId,
      batchIdHash: input.batchIdHash,
      created: input.counts.created,
      updated: input.counts.updated,
      deleted: input.counts.deleted,
      rejected: input.counts.rejected,
      createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt.toISOString(),
    });
  }
}

export type MemoryExtractionServiceDependencies = {
  readonly personalMemoryService: PersonalMemoryService;
  readonly idempotencyStorage: MemoryExtractionIdempotencyStorage;
  readonly model?: MemoryAgentModel;
  readonly personalMemoryPolicy?: PersonalMemoryPolicy;
};

export class MemoryExtractionService {
  private readonly personalMemoryService: PersonalMemoryService;
  private readonly idempotencyStorage: MemoryExtractionIdempotencyStorage;
  private readonly model: MemoryAgentModel;
  private readonly personalMemoryPolicy: PersonalMemoryPolicy;

  constructor(deps: MemoryExtractionServiceDependencies) {
    this.personalMemoryService = deps.personalMemoryService;
    this.idempotencyStorage = deps.idempotencyStorage;
    this.model = deps.model ?? new NoOpMemoryAgentModel();
    this.personalMemoryPolicy = deps.personalMemoryPolicy ?? new PersonalMemoryPolicy(deps.personalMemoryService);
  }

  async extract(
    userId: string,
    request: MemoryExtractionRequest,
  ): Promise<MemoryExtractionCounts> {
    const parsed = MemoryExtractionRequestSchema.parse(request);
    const now = new Date();
    const batchIdHash = await hashExtractionBatchId(userId, parsed.batchId);
    const prior = await this.idempotencyStorage.findResult(
      userId,
      batchIdHash,
      now,
    );
    if (prior) return prior;

    const typingContext = parsed.entries.map((entry) => entry.text).join("\n");
    const firstEntry = parsed.entries[0];
    if (!firstEntry) {
      throw new Error("Extraction batch must contain at least one entry");
    }
    const memories = await this.personalMemoryService.selectCandidateMemoriesForExtraction({
      userId,
      typingContext,
      activeApplication: firstEntry.activeApplication,
      memoryEnabled: true,
    });
    const operations = await this.model.proposeOperations(
      {
        requestId: parsed.batchId,
        userId,
        typingContext,
        contextSource: firstEntry.contextSource,
        activeApplication: firstEntry.activeApplication,
        memoryEligible: true,
        redaction: firstEntry.redaction,
        clientMetadata: parsed.clientMetadata,
      },
      memories,
    );
    const counts = await this.personalMemoryPolicy.applyExtractionOperations(userId, operations);

    if (hasDurableExtractionResult(counts)) {
      await this.idempotencyStorage.saveResult({
        userId,
        batchIdHash,
        counts,
        expiresAt: new Date(now.getTime() + EXTRACTION_IDEMPOTENCY_TTL_MS),
      });
    }

    return counts;
  }
}

class NoOpMemoryAgentModel implements MemoryAgentModel {
  async proposeOperations(): Promise<readonly ProposedMemoryOperation[]> {
    return [];
  }
}

class AiGatewayMemoryAgentModel implements MemoryAgentModel {
  async proposeOperations(
    job: MemoryJob,
    memories: readonly PersonalMemory[],
  ): Promise<readonly ProposedMemoryOperation[]> {
    if (!env.AI_GATEWAY_API_KEY) {
      throw new Error("AI_GATEWAY_API_KEY is not configured");
    }

    const { output } = await generateText({
      model: MEMORY_EXTRACTION_MODEL_ID,
      output: Output.object({ schema: MemoryOperationOutputSchema }),
      system:
        "Extract durable personal memory from first-party user typing. Return only generic create, update, or delete operations that are useful for future autocomplete. Do not store secrets, credentials, payment data, medical data, or third-party pasted content. Prefer no operation over speculative memory. Each operation must include type, id, content, and reason; use an empty string for fields that do not apply.",
      prompt: `Active application: ${job.activeApplication.bundleId}
Source: ${job.contextSource}
Redaction applied: ${job.redaction.applied}
Redaction count: ${job.redaction.redactionCount}

Existing memories:
${formatMemoriesForPrompt(memories)}

Recent user typing:
"""${job.typingContext}"""

Create a memory for stable preferences, projects, recurring facts, names, or work context. Update an existing memory only when the new text clearly refines it. Delete only when the text clearly contradicts an existing memory. Do not output category, sensitivity, source, or authorship.`,
      maxOutputTokens: 1200,
      temperature: 0,
    });

    return toProposedMemoryOperations(output.operations);
  }
}

export function createAiGatewayMemoryAgentModel(): MemoryAgentModel {
  return new AiGatewayMemoryAgentModel();
}

function formatMemoriesForPrompt(memories: readonly PersonalMemory[]): string {
  if (memories.length === 0) return "None";

  return memories
    .map(
      (memory) =>
        `- id=${memory.id}; createdBy=${memory.createdBy}; content=${memory.content}`,
    )
    .join("\n");
}
