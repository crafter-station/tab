import {
  MemoryExtractionRequestSchema,
  type MemoryExtractionCounts,
  type MemoryExtractionRequest,
  MemoryJobSchema,
  type MemoryJob,
  type PersonalMemory,
} from "@tabb/contracts";
import { generateText, Output } from "ai";
import { validateMemoryContent } from "@tabb/memory-policy";
import type { PersonalMemoryService } from "./personal-memory.ts";
import { env } from "./env.ts";
import { z } from "zod";
import { and, eq, gt } from "drizzle-orm";
import type { AppDatabase } from "./db/index.ts";
import { memoryExtractionIdempotency } from "./db/schema.ts";

const MAX_MEMORIES_PER_USER = 500;
const EXTRACTION_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export type { MemoryJob };

export interface MemoryJobQueue {
  enqueue(job: MemoryJob): Promise<void>;
}

type MemoryQueueSubscriber = (job: MemoryJob) => Promise<void>;

type QueuedMemoryJob = {
  readonly job: MemoryJob;
  processed: boolean;
};

export class InMemoryMemoryJobQueue implements MemoryJobQueue {
  private jobs: QueuedMemoryJob[] = [];
  private subscriber?: MemoryQueueSubscriber;

  async enqueue(job: MemoryJob): Promise<void> {
    const parsed = MemoryJobSchema.parse(job);
    const queued = { job: parsed, processed: false };
    this.jobs.push(queued);
    if (this.subscriber) {
      await this.subscriber(parsed);
      queued.processed = true;
    }
  }

  subscribe(subscriber: MemoryQueueSubscriber): void {
    this.subscriber = subscriber;
  }

  async drain(): Promise<void> {
    if (!this.subscriber) return;
    for (const queued of this.jobs) {
      if (!queued.processed) {
        await this.subscriber(queued.job);
        queued.processed = true;
      }
    }
  }

  getJobs(): readonly MemoryJob[] {
    return this.jobs.map((queued) => queued.job);
  }
}

export type ProposedCreateMemory = {
  readonly type: "create";
  readonly content: string;
  readonly reason?: string;
};

export type ProposedUpdateMemory = {
  readonly type: "update";
  readonly id: string;
  readonly content: string;
  readonly reason?: string;
};

export type ProposedDeleteMemory = {
  readonly type: "delete";
  readonly id: string;
  readonly reason?: string;
};

export type ProposedMemoryOperation =
  | ProposedCreateMemory
  | ProposedUpdateMemory
  | ProposedDeleteMemory;

const MEMORY_EXTRACTION_MODEL_ID = "openai/gpt-5.5";

const MemoryOperationOutputSchema = z.object({
  operations: z.array(
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("create"),
        content: z.string().min(1),
        reason: z.string().min(1).optional(),
      }),
      z.object({
        type: z.literal("update"),
        id: z.string().min(1),
        content: z.string().min(1),
        reason: z.string().min(1).optional(),
      }),
      z.object({
        type: z.literal("delete"),
        id: z.string().min(1),
        reason: z.string().min(1),
      }),
    ]),
  ),
});

function isSafeMemoryText(content: string): boolean {
  return validateMemoryContent(content).safe;
}

function emptyExtractionCounts(): MemoryExtractionCounts {
  return { created: 0, updated: 0, deleted: 0, rejected: 0 };
}

function hasDurableExtractionResult(counts: MemoryExtractionCounts): boolean {
  return (
    counts.created > 0 ||
    counts.updated > 0 ||
    counts.deleted > 0 ||
    counts.rejected > 0
  );
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

export type BackgroundMemoryAgentDependencies = {
  readonly personalMemoryService: PersonalMemoryService;
  readonly model?: MemoryAgentModel;
};

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
};

export class MemoryExtractionService {
  private readonly personalMemoryService: PersonalMemoryService;
  private readonly idempotencyStorage: MemoryExtractionIdempotencyStorage;
  private readonly model: MemoryAgentModel;

  constructor(deps: MemoryExtractionServiceDependencies) {
    this.personalMemoryService = deps.personalMemoryService;
    this.idempotencyStorage = deps.idempotencyStorage;
    this.model = deps.model ?? new NoOpMemoryAgentModel();
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
    const counts = await this.applyOperations(userId, operations);

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

  private async applyOperations(
    userId: string,
    operations: readonly ProposedMemoryOperation[],
  ): Promise<MemoryExtractionCounts> {
    const counts = emptyExtractionCounts();

    for (const operation of operations) {
      switch (operation.type) {
        case "create": {
          const currentCount = (
            await this.personalMemoryService.listMemories(userId)
          ).length;
          if (
            currentCount >= MAX_MEMORIES_PER_USER ||
            !isSafeMemoryText(operation.content)
          ) {
            counts.rejected += 1;
            break;
          }

          await this.personalMemoryService.createMemory({
            userId,
            content: operation.content,
            createdBy: "system",
          });
          counts.created += 1;
          break;
        }

        case "update": {
          const existing = await this.findMutableSystemMemory(
            userId,
            operation.id,
          );
          if (!existing || !isSafeMemoryText(operation.content)) {
            counts.rejected += 1;
            break;
          }

          await this.personalMemoryService.updateMemory(operation.id, {
            content: operation.content,
          });
          counts.updated += 1;
          break;
        }

        case "delete": {
          const existing = await this.findMutableSystemMemory(
            userId,
            operation.id,
          );
          if (!existing || !operation.reason?.trim()) {
            counts.rejected += 1;
            break;
          }

          await this.personalMemoryService.deleteMemory(userId, operation.id);
          counts.deleted += 1;
          break;
        }
      }
    }

    return counts;
  }

  private async findMutableSystemMemory(
    userId: string,
    memoryId: string,
  ): Promise<PersonalMemory | null> {
    const memory = await this.personalMemoryService.findMemoryById(memoryId);
    if (!memory || memory.userId !== userId || memory.createdBy !== "system") {
      return null;
    }
    return memory;
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
        "Extract durable personal memory from first-party user typing. Return only generic create, update, or delete operations that are useful for future autocomplete. Do not store secrets, credentials, payment data, medical data, or third-party pasted content. Prefer no operation over speculative memory.",
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

    return output.operations;
  }
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

export class BackgroundMemoryAgent {
  private readonly personalMemoryService: PersonalMemoryService;
  private readonly model: MemoryAgentModel;

  constructor(deps: BackgroundMemoryAgentDependencies) {
    this.personalMemoryService = deps.personalMemoryService;
    this.model = deps.model ?? new NoOpMemoryAgentModel();
  }

  static createRealModel(): MemoryAgentModel {
    return new AiGatewayMemoryAgentModel();
  }

  async processJob(job: MemoryJob): Promise<void> {
    const parsed = MemoryJobSchema.parse(job);

    if (!parsed.memoryEligible) {
      return;
    }

    const memories = await this.personalMemoryService.listMemories(
      parsed.userId,
    );

    const operations = await this.model.proposeOperations(parsed, memories);

    for (const operation of operations) {
      await this.applyOperation(parsed.userId, operation);
    }
  }

  private async applyOperation(
    userId: string,
    operation: ProposedMemoryOperation,
  ): Promise<void> {
    switch (operation.type) {
      case "create": {
        if (!isSafeMemoryText(operation.content)) {
          return;
        }

        await this.personalMemoryService.createMemory({
          userId,
          content: operation.content,
          createdBy: "system",
        });
        return;
      }

      case "update": {
        const existing = await this.findMemoryForUser(userId, operation.id);
        if (!existing) {
          return;
        }

        if (!isSafeMemoryText(operation.content)) {
          return;
        }

        await this.personalMemoryService.updateMemory(operation.id, {
          content: operation.content,
        });
        return;
      }

      case "delete": {
        await this.personalMemoryService.deleteMemory(userId, operation.id);
        return;
      }
    }
  }

  private async findMemoryForUser(
    userId: string,
    memoryId: string,
  ): Promise<PersonalMemory | null> {
    const memory = await this.personalMemoryService.findMemoryById(memoryId);

    if (!memory || memory.userId !== userId) {
      return null;
    }

    return memory;
  }
}
