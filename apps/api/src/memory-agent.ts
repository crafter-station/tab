import {
  MemoryExtractionRequestSchema,
  type MemoryExtractionCounts,
  type MemoryExtractionRequest,
  type MemoryJob,
  type PersonalMemory,
} from "@tab/contracts";
import {
  MEMORY_EXTRACTION_WINDOW_POLICY,
  summarizeMemoryExtractionWindow,
} from "@tab/memory-policy";
import { generateText, Output } from "ai";
import type { PersonalMemoryService } from "./personal-memory.ts";
import {
  PersonalMemoryPolicy,
  type ProposedMemoryOperation,
} from "./personal-memory-policy.ts";
import { env } from "./env.ts";
import { z } from "zod";
import { and, eq, isNotNull, isNull, lte, or } from "drizzle-orm";
import type { AppDatabase } from "./db/index.ts";
import { memoryExtractionIdempotency } from "./db/schema.ts";

export type { MemoryJob };
export type { ProposedMemoryOperation } from "./personal-memory-policy.ts";

export const MEMORY_EXTRACTION_MODEL_ID = "openai/gpt-5.5";
const MEMORY_EXTRACTION_CLAIM_LEASE_MS = 5 * 60 * 1_000;
const MEMORY_EXTRACTION_RESULT_POLL_MS = 25;

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
  claim(input: {
    readonly userId: string;
    readonly batchIdHash: string;
    readonly now: Date;
    readonly leaseExpiresAt: Date;
  }): Promise<MemoryExtractionClaim>;
  complete(input: {
    readonly userId: string;
    readonly batchIdHash: string;
    readonly claimId: string;
    readonly counts: MemoryExtractionCounts;
    readonly expiresAt: Date;
  }): Promise<boolean>;
  waitForResult(input: {
    readonly userId: string;
    readonly batchIdHash: string;
    readonly waitUntil: Date;
  }): Promise<MemoryExtractionCounts | null>;
  release(input: {
    readonly userId: string;
    readonly batchIdHash: string;
    readonly claimId: string;
    readonly now: Date;
  }): Promise<void>;
}

export type MemoryExtractionClaim =
  | { readonly status: "claimed"; readonly claimId: string }
  | { readonly status: "pending"; readonly leaseExpiresAt: Date }
  | { readonly status: "completed"; readonly counts: MemoryExtractionCounts };

type InMemoryExtractionIdempotencyRecord = {
  claimId: string | null;
  leaseExpiresAt: Date | null;
  counts: MemoryExtractionCounts;
  expiresAt: Date;
};

function extractionCountsFromRow(row: {
  readonly created: number;
  readonly updated: number;
  readonly deleted: number;
  readonly rejected: number;
}): MemoryExtractionCounts {
  return {
    created: row.created,
    updated: row.updated,
    deleted: row.deleted,
    rejected: row.rejected,
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class InMemoryMemoryExtractionIdempotencyStorage
  implements MemoryExtractionIdempotencyStorage
{
  private readonly records = new Map<
    string,
    InMemoryExtractionIdempotencyRecord
  >();

  async claim(input: {
    readonly userId: string;
    readonly batchIdHash: string;
    readonly now: Date;
    readonly leaseExpiresAt: Date;
  }): Promise<MemoryExtractionClaim> {
    const key = `${input.userId}:${input.batchIdHash}`;
    const existing = this.records.get(key);
    if (
      existing?.claimId &&
      existing.leaseExpiresAt &&
      existing.leaseExpiresAt > input.now
    ) {
      return { status: "pending", leaseExpiresAt: existing.leaseExpiresAt };
    }
    if (!existing?.claimId && existing && existing.expiresAt > input.now) {
      return { status: "completed", counts: existing.counts };
    }

    const claimId = crypto.randomUUID();
    this.records.set(key, {
      claimId,
      leaseExpiresAt: input.leaseExpiresAt,
      counts: { created: 0, updated: 0, deleted: 0, rejected: 0 },
      expiresAt: input.leaseExpiresAt,
    });
    return { status: "claimed", claimId };
  }

  async complete(input: {
    readonly userId: string;
    readonly batchIdHash: string;
    readonly claimId: string;
    readonly counts: MemoryExtractionCounts;
    readonly expiresAt: Date;
  }): Promise<boolean> {
    const key = `${input.userId}:${input.batchIdHash}`;
    const existing = this.records.get(key);
    if (existing?.claimId !== input.claimId) return false;
    this.records.set(key, {
      claimId: null,
      leaseExpiresAt: null,
      counts: input.counts,
      expiresAt: input.expiresAt,
    });
    return true;
  }

  async waitForResult(input: {
    readonly userId: string;
    readonly batchIdHash: string;
    readonly waitUntil: Date;
  }): Promise<MemoryExtractionCounts | null> {
    const key = `${input.userId}:${input.batchIdHash}`;
    while (new Date() < input.waitUntil) {
      const record = this.records.get(key);
      const now = new Date();
      if (!record) return null;
      if (!record.claimId) {
        return record.expiresAt > now ? record.counts : null;
      }
      if (!record.leaseExpiresAt || record.leaseExpiresAt <= now) return null;
      await wait(
        Math.min(
          MEMORY_EXTRACTION_RESULT_POLL_MS,
          input.waitUntil.getTime() - now.getTime(),
        ),
      );
    }
    return null;
  }

  async release(input: {
    readonly userId: string;
    readonly batchIdHash: string;
    readonly claimId: string;
    readonly now: Date;
  }): Promise<void> {
    const record = this.records.get(`${input.userId}:${input.batchIdHash}`);
    if (record?.claimId === input.claimId) {
      record.leaseExpiresAt = input.now;
    }
  }
}

export class D1MemoryExtractionIdempotencyStorage
  implements MemoryExtractionIdempotencyStorage
{
  constructor(private readonly db: AppDatabase) {}

  async claim(input: {
    readonly userId: string;
    readonly batchIdHash: string;
    readonly now: Date;
    readonly leaseExpiresAt: Date;
  }): Promise<MemoryExtractionClaim> {
    const claimId = crypto.randomUUID();
    const now = input.now.toISOString();
    const leaseExpiresAt = input.leaseExpiresAt.toISOString();
    const claimed = await this.db
      .insert(memoryExtractionIdempotency)
      .values({
        userId: input.userId,
        batchIdHash: input.batchIdHash,
        created: 0,
        updated: 0,
        deleted: 0,
        rejected: 0,
        claimId,
        leaseExpiresAt,
        createdAt: now,
        expiresAt: leaseExpiresAt,
      })
      .onConflictDoUpdate({
        target: [
          memoryExtractionIdempotency.userId,
          memoryExtractionIdempotency.batchIdHash,
        ],
        set: {
          created: 0,
          updated: 0,
          deleted: 0,
          rejected: 0,
          claimId,
          leaseExpiresAt,
          createdAt: now,
          expiresAt: leaseExpiresAt,
        },
        setWhere: or(
          and(
            isNull(memoryExtractionIdempotency.claimId),
            lte(memoryExtractionIdempotency.expiresAt, now),
          ),
          and(
            isNotNull(memoryExtractionIdempotency.claimId),
            lte(memoryExtractionIdempotency.leaseExpiresAt, now),
          ),
        ),
      })
      .returning({ claimId: memoryExtractionIdempotency.claimId });
    if (claimed[0]?.claimId === claimId) {
      return { status: "claimed", claimId };
    }

    const row = await this.findRow(input.userId, input.batchIdHash);
    if (!row) return this.claim(input);
    if (!row.claimId && row.expiresAt > now) {
      return { status: "completed", counts: extractionCountsFromRow(row) };
    }
    if (row.claimId && row.leaseExpiresAt) {
      return {
        status: "pending",
        leaseExpiresAt: new Date(row.leaseExpiresAt),
      };
    }
    return this.claim(input);
  }

  async complete(input: {
    readonly userId: string;
    readonly batchIdHash: string;
    readonly claimId: string;
    readonly counts: MemoryExtractionCounts;
    readonly expiresAt: Date;
  }): Promise<boolean> {
    const completed = await this.db
      .update(memoryExtractionIdempotency)
      .set({
        created: input.counts.created,
        updated: input.counts.updated,
        deleted: input.counts.deleted,
        rejected: input.counts.rejected,
        claimId: null,
        leaseExpiresAt: null,
        expiresAt: input.expiresAt.toISOString(),
      })
      .where(
        and(
          eq(memoryExtractionIdempotency.userId, input.userId),
          eq(memoryExtractionIdempotency.batchIdHash, input.batchIdHash),
          eq(memoryExtractionIdempotency.claimId, input.claimId),
        ),
      )
      .returning({ batchIdHash: memoryExtractionIdempotency.batchIdHash });
    return completed.length > 0;
  }

  async waitForResult(input: {
    readonly userId: string;
    readonly batchIdHash: string;
    readonly waitUntil: Date;
  }): Promise<MemoryExtractionCounts | null> {
    while (new Date() < input.waitUntil) {
      const row = await this.findRow(input.userId, input.batchIdHash);
      const now = new Date();
      if (!row) return null;
      if (!row.claimId) {
        return row.expiresAt > now.toISOString()
          ? extractionCountsFromRow(row)
          : null;
      }
      if (!row.leaseExpiresAt || row.leaseExpiresAt <= now.toISOString()) {
        return null;
      }
      await wait(
        Math.min(
          MEMORY_EXTRACTION_RESULT_POLL_MS,
          input.waitUntil.getTime() - now.getTime(),
        ),
      );
    }
    return null;
  }

  async release(input: {
    readonly userId: string;
    readonly batchIdHash: string;
    readonly claimId: string;
    readonly now: Date;
  }): Promise<void> {
    await this.db
      .update(memoryExtractionIdempotency)
      .set({ leaseExpiresAt: input.now.toISOString() })
      .where(
        and(
          eq(memoryExtractionIdempotency.userId, input.userId),
          eq(memoryExtractionIdempotency.batchIdHash, input.batchIdHash),
          eq(memoryExtractionIdempotency.claimId, input.claimId),
        ),
      );
  }

  private findRow(userId: string, batchIdHash: string) {
    return this.db.query.memoryExtractionIdempotency.findFirst({
      where: and(
        eq(memoryExtractionIdempotency.userId, userId),
        eq(memoryExtractionIdempotency.batchIdHash, batchIdHash),
      ),
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
    const extractionWindow = summarizeMemoryExtractionWindow(parsed.entries);
    if (!extractionWindow) {
      throw new Error("Extraction batch must contain at least one entry");
    }
    const batchIdHash = await hashExtractionBatchId(userId, parsed.batchId);
    const claim = await this.acquireClaim(userId, batchIdHash);
    if (claim.status === "completed") {
      await this.personalMemoryService.cleanupPendingVectorDeletions(userId);
      return claim.counts;
    }

    try {
      await this.personalMemoryService.cleanupPendingVectorDeletions(userId);
      const memories = await this.personalMemoryService.selectCandidateMemoriesForExtraction({
        userId,
        typingContext: extractionWindow.typingContext,
        activeApplication: extractionWindow.activeApplication,
        memoryEnabled: true,
      });
      const operations = await this.model.proposeOperations(
        {
          requestId: parsed.batchId,
          userId,
          typingContext: extractionWindow.typingContext,
          contextSource: extractionWindow.contextSource,
          activeApplication: extractionWindow.activeApplication,
          memoryEligible: true,
          redaction: extractionWindow.redaction,
          clientMetadata: parsed.clientMetadata,
        },
        memories,
      );
      const counts = await this.personalMemoryPolicy.applyExtractionOperations(
        userId,
        operations,
      );
      const completedAt = new Date();
      const completed = await this.idempotencyStorage.complete({
        userId,
        batchIdHash,
        claimId: claim.claimId,
        counts,
        expiresAt: new Date(
          completedAt.getTime() + MEMORY_EXTRACTION_WINDOW_POLICY.failedBatchTtlMs,
        ),
      });
      if (!completed) {
        const winner = await this.idempotencyStorage.waitForResult({
          userId,
          batchIdHash,
          waitUntil: new Date(
            completedAt.getTime() + MEMORY_EXTRACTION_CLAIM_LEASE_MS,
          ),
        });
        if (winner) return winner;
        throw new Error("Extraction claim was lost before completion");
      }

      return counts;
    } catch (error) {
      try {
        await this.idempotencyStorage.release({
          userId,
          batchIdHash,
          claimId: claim.claimId,
          now: new Date(),
        });
      } catch {
        // The bounded lease still permits recovery if releasing the claim fails.
      }
      throw error;
    }
  }

  private async acquireClaim(
    userId: string,
    batchIdHash: string,
  ): Promise<Exclude<MemoryExtractionClaim, { status: "pending" }>> {
    while (true) {
      const now = new Date();
      const claim = await this.idempotencyStorage.claim({
        userId,
        batchIdHash,
        now,
        leaseExpiresAt: new Date(now.getTime() + MEMORY_EXTRACTION_CLAIM_LEASE_MS),
      });
      if (claim.status !== "pending") return claim;

      const result = await this.idempotencyStorage.waitForResult({
        userId,
        batchIdHash,
        waitUntil: claim.leaseExpiresAt,
      });
      if (result) return { status: "completed", counts: result };
    }
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
