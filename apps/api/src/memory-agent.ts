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
import type {
  ExtractionOperationOutcome,
  PersonalMemoryService,
  PersonalMemoryStorage,
} from "./personal-memory.ts";
import {
  PersonalMemoryPolicy,
  type PlannedMemoryOperation,
  type ProposedMemoryOperation,
} from "./personal-memory-policy.ts";
import { env } from "./env.ts";
import { z } from "zod";
import {
  and,
  eq,
  exists,
  gt,
  isNotNull,
  isNull,
  lte,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { AppDatabase } from "./db/index.ts";
import {
  memoryExtractionIdempotency,
  memoryExtractionOperations,
  pendingPersonalMemoryVectorDeletions,
  pendingPersonalMemoryVectorUpserts,
  personalMemories,
} from "./db/schema.ts";

export type { MemoryJob };
export type { ProposedMemoryOperation } from "./personal-memory-policy.ts";

export const MEMORY_EXTRACTION_MODEL_ID = "openai/gpt-5.5";
const MEMORY_EXTRACTION_CLAIM_LEASE_MS = 5 * 60 * 1_000;
const MEMORY_EXTRACTION_CLAIM_HEARTBEAT_MS = 60 * 1_000;
const MEMORY_EXTRACTION_RESULT_POLL_MS = 25;
const MEMORY_EXTRACTION_NO_OP_RESULT_TTL_MS = 5 * 1_000;

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

const PlannedMemoryOperationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create"),
    memoryId: z.string().min(1),
    content: z.string(),
    eligible: z.boolean(),
  }),
  z.object({
    type: z.literal("update"),
    memoryId: z.string().min(1),
    content: z.string(),
    eligible: z.boolean(),
  }),
  z.object({
    type: z.literal("delete"),
    memoryId: z.string().min(1),
    eligible: z.boolean(),
  }),
]);

const MemoryExtractionPlanSchema = z.object({
  version: z.literal(1),
  operations: z.array(PlannedMemoryOperationSchema),
});

type MemoryExtractionPlan = z.infer<typeof MemoryExtractionPlanSchema>;

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

export interface MemoryExtractionClock {
  now(): Date;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

const systemMemoryExtractionClock: MemoryExtractionClock = {
  now: () => new Date(),
  sleep(ms, signal) {
    if (signal?.aborted) return Promise.resolve();

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal?.removeEventListener("abort", finish);
        resolve();
      };
      const timeout = setTimeout(finish, ms);
      signal?.addEventListener("abort", finish, { once: true });
    });
  },
};

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
    readonly now: Date;
    readonly expiresAt: Date;
  }): Promise<MemoryExtractionCounts | null>;
  renew(input: {
    readonly userId: string;
    readonly batchIdHash: string;
    readonly claimId: string;
    readonly now: Date;
    readonly leaseExpiresAt: Date;
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
  readPlan(input: MemoryExtractionClaimInput): Promise<MemoryExtractionPlanRead>;
  savePlan(input: MemoryExtractionClaimInput & {
    readonly plan: MemoryExtractionPlan;
  }): Promise<boolean>;
  applyOperation(input: MemoryExtractionClaimInput & {
    readonly operationIndex: number;
    readonly operation: PlannedMemoryOperation;
    readonly maxMemoriesPerUser: number;
    readonly personalMemoryStorage: PersonalMemoryStorage;
  }): Promise<MemoryExtractionOperationApplyResult>;
  readProgress(
    input: MemoryExtractionClaimInput,
  ): Promise<MemoryExtractionCounts | null>;
}

type MemoryExtractionClaimInput = {
  readonly userId: string;
  readonly batchIdHash: string;
  readonly claimId: string;
  readonly now: Date;
};

type MemoryExtractionPlanRead =
  | { readonly status: "claim_lost" }
  | { readonly status: "missing" }
  | { readonly status: "ready"; readonly plan: MemoryExtractionPlan };

type MemoryExtractionOperationApplyResult =
  | { readonly status: "claim_lost" }
  | {
      readonly status: "applied";
      readonly outcome: ExtractionOperationOutcome;
    };

export type MemoryExtractionClaim =
  | { readonly status: "claimed"; readonly claimId: string }
  | { readonly status: "pending"; readonly leaseExpiresAt: Date }
  | { readonly status: "completed"; readonly counts: MemoryExtractionCounts };

type InMemoryExtractionIdempotencyRecord = {
  claimId: string | null;
  leaseExpiresAt: Date | null;
  counts: MemoryExtractionCounts;
  expiresAt: Date;
  plan: MemoryExtractionPlan | null;
  operations: Map<number, ExtractionOperationOutcome>;
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

export class InMemoryMemoryExtractionIdempotencyStorage
  implements MemoryExtractionIdempotencyStorage
{
  private readonly records = new Map<
    string,
    InMemoryExtractionIdempotencyRecord
  >();

  constructor(
    private readonly clock: MemoryExtractionClock = systemMemoryExtractionClock,
    private readonly resultPollMs = MEMORY_EXTRACTION_RESULT_POLL_MS,
  ) {}

  async claim(input: {
    readonly userId: string;
    readonly batchIdHash: string;
    readonly now: Date;
    readonly leaseExpiresAt: Date;
  }): Promise<MemoryExtractionClaim> {
    const key = `${input.userId}:${input.batchIdHash}`;
    let existing = this.records.get(key);
    if (existing && !existing.claimId && existing.expiresAt <= input.now) {
      this.records.delete(key);
      existing = undefined;
    }
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
    if (existing?.claimId) {
      existing.claimId = claimId;
      existing.leaseExpiresAt = input.leaseExpiresAt;
      existing.expiresAt = input.leaseExpiresAt;
      return { status: "claimed", claimId };
    }
    this.records.set(key, {
      claimId,
      leaseExpiresAt: input.leaseExpiresAt,
      counts: { created: 0, updated: 0, deleted: 0, rejected: 0 },
      expiresAt: input.leaseExpiresAt,
      plan: null,
      operations: new Map(),
    });
    return { status: "claimed", claimId };
  }

  async complete(input: {
    readonly userId: string;
    readonly batchIdHash: string;
    readonly claimId: string;
    readonly now: Date;
    readonly expiresAt: Date;
  }): Promise<MemoryExtractionCounts | null> {
    const key = `${input.userId}:${input.batchIdHash}`;
    const existing = this.records.get(key);
    if (
      existing?.claimId !== input.claimId ||
      !existing.leaseExpiresAt ||
      existing.leaseExpiresAt <= input.now
    ) {
      return null;
    }
    if (!existing.plan || existing.operations.size !== existing.plan.operations.length) {
      return null;
    }
    this.records.set(key, {
      claimId: null,
      leaseExpiresAt: null,
      counts: existing.counts,
      expiresAt: input.expiresAt,
      plan: existing.plan,
      operations: existing.operations,
    });
    return existing.counts;
  }

  async renew(input: {
    readonly userId: string;
    readonly batchIdHash: string;
    readonly claimId: string;
    readonly now: Date;
    readonly leaseExpiresAt: Date;
  }): Promise<boolean> {
    const record = this.records.get(`${input.userId}:${input.batchIdHash}`);
    if (
      record?.claimId !== input.claimId ||
      !record.leaseExpiresAt ||
      record.leaseExpiresAt <= input.now
    ) {
      return false;
    }

    record.leaseExpiresAt = input.leaseExpiresAt;
    record.expiresAt = input.leaseExpiresAt;
    return true;
  }

  async waitForResult(input: {
    readonly userId: string;
    readonly batchIdHash: string;
    readonly waitUntil: Date;
  }): Promise<MemoryExtractionCounts | null> {
    const key = `${input.userId}:${input.batchIdHash}`;
    while (this.clock.now() < input.waitUntil) {
      const record = this.records.get(key);
      const now = this.clock.now();
      if (!record) return null;
      if (!record.claimId) {
        if (record.expiresAt > now) return record.counts;
        this.records.delete(key);
        return null;
      }
      if (!record.leaseExpiresAt || record.leaseExpiresAt <= now) return null;
      await this.clock.sleep(
        Math.min(
          this.resultPollMs,
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

  async readPlan(
    input: MemoryExtractionClaimInput,
  ): Promise<MemoryExtractionPlanRead> {
    const record = this.getOwnedRecord(input);
    if (!record) return { status: "claim_lost" };
    return record.plan
      ? { status: "ready", plan: record.plan }
      : { status: "missing" };
  }

  async savePlan(
    input: MemoryExtractionClaimInput & { readonly plan: MemoryExtractionPlan },
  ): Promise<boolean> {
    const record = this.getOwnedRecord(input);
    if (!record || record.plan) return false;
    record.plan = MemoryExtractionPlanSchema.parse(input.plan);
    return true;
  }

  async applyOperation(
    input: MemoryExtractionClaimInput & {
      readonly operationIndex: number;
      readonly operation: PlannedMemoryOperation;
      readonly maxMemoriesPerUser: number;
      readonly personalMemoryStorage: PersonalMemoryStorage;
    },
  ): Promise<MemoryExtractionOperationApplyResult> {
    const record = this.getOwnedRecord(input);
    if (!record) return { status: "claim_lost" };
    const existing = record.operations.get(input.operationIndex);
    if (existing) return { status: "applied", outcome: existing };
    if (
      !record.plan ||
      input.operationIndex >= record.plan.operations.length ||
      JSON.stringify(record.plan.operations[input.operationIndex]) !==
        JSON.stringify(input.operation)
    ) {
      throw new Error("Extraction operation does not match its durable plan");
    }
    const applyAtomically =
      input.personalMemoryStorage.applyExtractionOperationAtomically;
    if (!applyAtomically) {
      throw new Error(
        "In-memory extraction requires an atomic Personal Memory storage adapter",
      );
    }

    const outcome = applyAtomically.call(input.personalMemoryStorage, {
      userId: input.userId,
      operation: input.operation,
      maxMemoriesPerUser: input.maxMemoriesPerUser,
      now: input.now.toISOString(),
    });
    record.operations.set(input.operationIndex, outcome);
    incrementExtractionCount(record.counts, outcome);
    return { status: "applied", outcome };
  }

  async readProgress(
    input: MemoryExtractionClaimInput,
  ): Promise<MemoryExtractionCounts | null> {
    return this.getOwnedRecord(input)?.counts ?? null;
  }

  private getOwnedRecord(
    input: MemoryExtractionClaimInput,
  ): InMemoryExtractionIdempotencyRecord | null {
    const record = this.records.get(`${input.userId}:${input.batchIdHash}`);
    if (
      record?.claimId !== input.claimId ||
      !record.leaseExpiresAt ||
      record.leaseExpiresAt <= input.now
    ) {
      return null;
    }
    return record;
  }
}

function incrementExtractionCount(
  counts: MemoryExtractionCounts,
  outcome: ExtractionOperationOutcome,
): void {
  if (outcome === "created") counts.created += 1;
  else if (outcome === "updated") counts.updated += 1;
  else if (outcome === "deleted") counts.deleted += 1;
  else counts.rejected += 1;
}

export class D1MemoryExtractionIdempotencyStorage
  implements MemoryExtractionIdempotencyStorage
{
  constructor(
    private readonly db: AppDatabase,
    private readonly clock: MemoryExtractionClock = systemMemoryExtractionClock,
    private readonly resultPollMs = MEMORY_EXTRACTION_RESULT_POLL_MS,
  ) {}

  async claim(input: {
    readonly userId: string;
    readonly batchIdHash: string;
    readonly now: Date;
    readonly leaseExpiresAt: Date;
  }): Promise<MemoryExtractionClaim> {
    const claimId = crypto.randomUUID();
    const now = input.now.toISOString();
    const leaseExpiresAt = input.leaseExpiresAt.toISOString();
    const pruneOperations = this.db
      .delete(memoryExtractionOperations)
      .where(
        exists(
          this.db
            .select({ userId: memoryExtractionIdempotency.userId })
            .from(memoryExtractionIdempotency)
            .where(
              and(
                eq(
                  memoryExtractionIdempotency.userId,
                  memoryExtractionOperations.userId,
                ),
                eq(
                  memoryExtractionIdempotency.batchIdHash,
                  memoryExtractionOperations.batchIdHash,
                ),
                isNull(memoryExtractionIdempotency.claimId),
                lte(memoryExtractionIdempotency.expiresAt, now),
              ),
            ),
        ),
      );
    const pruneClaims = this.db
      .delete(memoryExtractionIdempotency)
      .where(
        and(
          isNull(memoryExtractionIdempotency.claimId),
          lte(memoryExtractionIdempotency.expiresAt, now),
        ),
      );
    const claimBatch = this.db
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
        operationPlan: null,
        operationCount: 0,
        createdAt: now,
        expiresAt: leaseExpiresAt,
      })
      .onConflictDoUpdate({
        target: [
          memoryExtractionIdempotency.userId,
          memoryExtractionIdempotency.batchIdHash,
        ],
        set: {
          claimId,
          leaseExpiresAt,
          expiresAt: leaseExpiresAt,
        },
        setWhere: or(
          and(
            isNotNull(memoryExtractionIdempotency.claimId),
            lte(memoryExtractionIdempotency.leaseExpiresAt, now),
          ),
        ),
      })
      .returning({ claimId: memoryExtractionIdempotency.claimId });
    const [, , claimed] = await this.db.batch([
      pruneOperations,
      pruneClaims,
      claimBatch,
    ] as const);
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
    readonly now: Date;
    readonly expiresAt: Date;
  }): Promise<MemoryExtractionCounts | null> {
    const completed = await this.db
      .update(memoryExtractionIdempotency)
      .set({
        claimId: null,
        leaseExpiresAt: null,
        expiresAt: input.expiresAt.toISOString(),
      })
      .where(
        and(
          eq(memoryExtractionIdempotency.userId, input.userId),
          eq(memoryExtractionIdempotency.batchIdHash, input.batchIdHash),
          eq(memoryExtractionIdempotency.claimId, input.claimId),
          gt(
            memoryExtractionIdempotency.leaseExpiresAt,
            input.now.toISOString(),
          ),
          sql`${memoryExtractionIdempotency.operationCount} = (
            select count(*) from ${memoryExtractionOperations}
            where ${memoryExtractionOperations.userId} = ${input.userId}
              and ${memoryExtractionOperations.batchIdHash} = ${input.batchIdHash}
          )`,
        ),
      )
      .returning({
        created: memoryExtractionIdempotency.created,
        updated: memoryExtractionIdempotency.updated,
        deleted: memoryExtractionIdempotency.deleted,
        rejected: memoryExtractionIdempotency.rejected,
      });
    return completed[0] ? extractionCountsFromRow(completed[0]) : null;
  }

  async renew(input: {
    readonly userId: string;
    readonly batchIdHash: string;
    readonly claimId: string;
    readonly now: Date;
    readonly leaseExpiresAt: Date;
  }): Promise<boolean> {
    const renewed = await this.db
      .update(memoryExtractionIdempotency)
      .set({
        leaseExpiresAt: input.leaseExpiresAt.toISOString(),
        expiresAt: input.leaseExpiresAt.toISOString(),
      })
      .where(
        and(
          eq(memoryExtractionIdempotency.userId, input.userId),
          eq(memoryExtractionIdempotency.batchIdHash, input.batchIdHash),
          eq(memoryExtractionIdempotency.claimId, input.claimId),
          gt(
            memoryExtractionIdempotency.leaseExpiresAt,
            input.now.toISOString(),
          ),
        ),
      )
      .returning({ claimId: memoryExtractionIdempotency.claimId });
    return renewed[0]?.claimId === input.claimId;
  }

  async waitForResult(input: {
    readonly userId: string;
    readonly batchIdHash: string;
    readonly waitUntil: Date;
  }): Promise<MemoryExtractionCounts | null> {
    while (this.clock.now() < input.waitUntil) {
      const row = await this.findRow(input.userId, input.batchIdHash);
      const now = this.clock.now();
      if (!row) return null;
      if (!row.claimId) {
        if (row.expiresAt > now.toISOString()) {
          return extractionCountsFromRow(row);
        }
        await this.pruneExpiredCompleted(now);
        return null;
      }
      if (!row.leaseExpiresAt || row.leaseExpiresAt <= now.toISOString()) {
        return null;
      }
      await this.clock.sleep(
        Math.min(
          this.resultPollMs,
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

  async readPlan(
    input: MemoryExtractionClaimInput,
  ): Promise<MemoryExtractionPlanRead> {
    const rows = await this.db
      .select({ operationPlan: memoryExtractionIdempotency.operationPlan })
      .from(memoryExtractionIdempotency)
      .where(this.ownedClaim(input));
    if (!rows[0]) return { status: "claim_lost" };
    if (!rows[0].operationPlan) return { status: "missing" };
    return {
      status: "ready",
      plan: MemoryExtractionPlanSchema.parse(JSON.parse(rows[0].operationPlan)),
    };
  }

  async savePlan(
    input: MemoryExtractionClaimInput & { readonly plan: MemoryExtractionPlan },
  ): Promise<boolean> {
    const plan = MemoryExtractionPlanSchema.parse(input.plan);
    const saved = await this.db
      .update(memoryExtractionIdempotency)
      .set({
        operationPlan: JSON.stringify(plan),
        operationCount: plan.operations.length,
      })
      .where(
        and(
          this.ownedClaim(input),
          isNull(memoryExtractionIdempotency.operationPlan),
        ),
      )
      .returning({ batchIdHash: memoryExtractionIdempotency.batchIdHash });
    return saved.length > 0;
  }

  async applyOperation(
    input: MemoryExtractionClaimInput & {
      readonly operationIndex: number;
      readonly operation: PlannedMemoryOperation;
      readonly maxMemoriesPerUser: number;
      readonly personalMemoryStorage: PersonalMemoryStorage;
    },
  ): Promise<MemoryExtractionOperationApplyResult> {
    const operation = PlannedMemoryOperationSchema.parse(input.operation);
    const outcome = this.operationOutcome(input, operation);
    const journal = this.db
      .insert(memoryExtractionOperations)
      .select(
        this.db
          .select({
            userId: memoryExtractionIdempotency.userId,
            batchIdHash: memoryExtractionIdempotency.batchIdHash,
            operationIndex: sql<number>`${input.operationIndex}`.as(
              "operation_index",
            ),
            outcome: outcome.as("outcome"),
            memoryId: sql<string>`${operation.memoryId}`.as("memory_id"),
            counted: sql<boolean>`0`.as("counted"),
            createdAt: sql<string>`${input.now.toISOString()}`.as("created_at"),
          })
          .from(memoryExtractionIdempotency)
          .where(
            and(
              this.ownedClaim(input),
              notExists(
                this.db
                  .select({
                    operationIndex: memoryExtractionOperations.operationIndex,
                  })
                  .from(memoryExtractionOperations)
                  .where(this.operationKey(input)),
              ),
            ),
          ),
      )
      .onConflictDoNothing();
    const incrementCounts = this.db
      .update(memoryExtractionIdempotency)
      .set({
        created: sql`${memoryExtractionIdempotency.created} + case when exists (
          select 1 from ${memoryExtractionOperations}
          where ${memoryExtractionOperations.userId} = ${input.userId}
            and ${memoryExtractionOperations.batchIdHash} = ${input.batchIdHash}
            and ${memoryExtractionOperations.operationIndex} = ${input.operationIndex}
            and ${memoryExtractionOperations.outcome} = 'created'
            and ${memoryExtractionOperations.counted} = 0
        ) then 1 else 0 end`,
        updated: sql`${memoryExtractionIdempotency.updated} + case when exists (
          select 1 from ${memoryExtractionOperations}
          where ${memoryExtractionOperations.userId} = ${input.userId}
            and ${memoryExtractionOperations.batchIdHash} = ${input.batchIdHash}
            and ${memoryExtractionOperations.operationIndex} = ${input.operationIndex}
            and ${memoryExtractionOperations.outcome} = 'updated'
            and ${memoryExtractionOperations.counted} = 0
        ) then 1 else 0 end`,
        deleted: sql`${memoryExtractionIdempotency.deleted} + case when exists (
          select 1 from ${memoryExtractionOperations}
          where ${memoryExtractionOperations.userId} = ${input.userId}
            and ${memoryExtractionOperations.batchIdHash} = ${input.batchIdHash}
            and ${memoryExtractionOperations.operationIndex} = ${input.operationIndex}
            and ${memoryExtractionOperations.outcome} = 'deleted'
            and ${memoryExtractionOperations.counted} = 0
        ) then 1 else 0 end`,
        rejected: sql`${memoryExtractionIdempotency.rejected} + case when exists (
          select 1 from ${memoryExtractionOperations}
          where ${memoryExtractionOperations.userId} = ${input.userId}
            and ${memoryExtractionOperations.batchIdHash} = ${input.batchIdHash}
            and ${memoryExtractionOperations.operationIndex} = ${input.operationIndex}
            and ${memoryExtractionOperations.outcome} = 'rejected'
            and ${memoryExtractionOperations.counted} = 0
        ) then 1 else 0 end`,
      })
      .where(this.ownedClaim(input));
    const markCounted = this.db
      .update(memoryExtractionOperations)
      .set({ counted: true })
      .where(
        and(
          this.operationKey(input),
          exists(
            this.db
              .select({ claimId: memoryExtractionIdempotency.claimId })
              .from(memoryExtractionIdempotency)
              .where(this.ownedClaim(input)),
          ),
        ),
      );
    const observe = this.db
      .select({ outcome: memoryExtractionOperations.outcome })
      .from(memoryExtractionOperations)
      .where(
        and(
          this.operationKey(input),
          exists(
            this.db
              .select({ claimId: memoryExtractionIdempotency.claimId })
              .from(memoryExtractionIdempotency)
              .where(this.ownedClaim(input)),
          ),
        ),
      );
    const vectorMutationId = `${input.batchIdHash}:${input.operationIndex}`;
    let observed: Array<{ outcome: string }>;

    if (operation.type === "create") {
      const createCanonical = this.db
        .insert(personalMemories)
        .select(
          this.db
            .select({
              id: sql<string>`${operation.memoryId}`.as("id"),
              userId: sql<string>`${input.userId}`.as("user_id"),
              content: sql<string>`${operation.content}`.as("content"),
              createdBy: sql<string>`'system'`.as("created_by"),
              createdAt: sql<string>`${input.now.toISOString()}`.as("created_at"),
              updatedAt: sql<string>`${input.now.toISOString()}`.as("updated_at"),
            })
            .from(memoryExtractionOperations)
            .where(
              and(
                this.operationKey(input),
                eq(memoryExtractionOperations.outcome, "created"),
                eq(memoryExtractionOperations.counted, false),
                exists(
                  this.db
                    .select({ claimId: memoryExtractionIdempotency.claimId })
                    .from(memoryExtractionIdempotency)
                    .where(this.ownedClaim(input)),
                ),
              ),
            ),
        );
      const enqueueUpsert = this.enqueueExtractionVectorUpsert(
        input,
        vectorMutationId,
      );
      const [, , , , , rows] = await this.db.batch([
        journal,
        createCanonical,
        enqueueUpsert,
        incrementCounts,
        markCounted,
        observe,
      ] as const);
      observed = rows;
    } else if (operation.type === "update") {
      const updateCanonical = this.db
        .update(personalMemories)
        .set({ content: operation.content, updatedAt: input.now.toISOString() })
        .where(
          and(
            eq(personalMemories.userId, input.userId),
            eq(personalMemories.id, operation.memoryId),
            eq(personalMemories.createdBy, "system"),
            exists(
              this.db
                .select({
                  operationIndex: memoryExtractionOperations.operationIndex,
                })
                .from(memoryExtractionOperations)
                .where(
                  and(
                    this.operationKey(input),
                    eq(memoryExtractionOperations.outcome, "updated"),
                    eq(memoryExtractionOperations.counted, false),
                  ),
                ),
            ),
            exists(
              this.db
                .select({ claimId: memoryExtractionIdempotency.claimId })
                .from(memoryExtractionIdempotency)
                .where(this.ownedClaim(input)),
            ),
          ),
        );
      const enqueueUpsert = this.enqueueExtractionVectorUpsert(
        input,
        vectorMutationId,
      );
      const [, , , , , rows] = await this.db.batch([
        journal,
        updateCanonical,
        enqueueUpsert,
        incrementCounts,
        markCounted,
        observe,
      ] as const);
      observed = rows;
    } else {
      const enqueueDeletion = this.db
        .insert(pendingPersonalMemoryVectorDeletions)
        .select(
          this.db
            .select({
              userId: personalMemories.userId,
              memoryId: personalMemories.id,
              createdAt: sql<string>`${input.now.toISOString()}`.as(
                "created_at",
              ),
            })
            .from(personalMemories)
            .where(
              and(
                eq(personalMemories.userId, input.userId),
                eq(personalMemories.id, operation.memoryId),
                eq(personalMemories.createdBy, "system"),
                exists(
                  this.db
                    .select({
                      operationIndex: memoryExtractionOperations.operationIndex,
                    })
                    .from(memoryExtractionOperations)
                    .where(
                      and(
                        this.operationKey(input),
                        eq(memoryExtractionOperations.outcome, "deleted"),
                        eq(memoryExtractionOperations.counted, false),
                      ),
                    ),
                ),
                exists(
                  this.db
                    .select({ claimId: memoryExtractionIdempotency.claimId })
                    .from(memoryExtractionIdempotency)
                    .where(this.ownedClaim(input)),
                ),
              ),
            ),
        )
        .onConflictDoNothing();
      const deleteCanonical = this.db
        .delete(personalMemories)
        .where(
          and(
            eq(personalMemories.userId, input.userId),
            eq(personalMemories.id, operation.memoryId),
            eq(personalMemories.createdBy, "system"),
            exists(
              this.db
                .select({
                  operationIndex: memoryExtractionOperations.operationIndex,
                })
                .from(memoryExtractionOperations)
                .where(
                  and(
                    this.operationKey(input),
                    eq(memoryExtractionOperations.outcome, "deleted"),
                    eq(memoryExtractionOperations.counted, false),
                  ),
                ),
            ),
            exists(
              this.db
                .select({ claimId: memoryExtractionIdempotency.claimId })
                .from(memoryExtractionIdempotency)
                .where(this.ownedClaim(input)),
            ),
          ),
        );
      const [, , , , , rows] = await this.db.batch([
        journal,
        enqueueDeletion,
        deleteCanonical,
        incrementCounts,
        markCounted,
        observe,
      ] as const);
      observed = rows;
    }

    const observedOutcome = observed[0]?.outcome;
    if (
      observedOutcome !== "created" &&
      observedOutcome !== "updated" &&
      observedOutcome !== "deleted" &&
      observedOutcome !== "rejected"
    ) {
      return { status: "claim_lost" };
    }
    return { status: "applied", outcome: observedOutcome };
  }

  async readProgress(
    input: MemoryExtractionClaimInput,
  ): Promise<MemoryExtractionCounts | null> {
    const rows = await this.db
      .select({
        created: memoryExtractionIdempotency.created,
        updated: memoryExtractionIdempotency.updated,
        deleted: memoryExtractionIdempotency.deleted,
        rejected: memoryExtractionIdempotency.rejected,
      })
      .from(memoryExtractionIdempotency)
      .where(this.ownedClaim(input));
    return rows[0] ? extractionCountsFromRow(rows[0]) : null;
  }

  private operationOutcome(
    input: MemoryExtractionClaimInput & {
      readonly operationIndex: number;
      readonly maxMemoriesPerUser: number;
    },
    operation: PlannedMemoryOperation,
  ) {
    if (!operation.eligible) return sql<ExtractionOperationOutcome>`'rejected'`;
    if (operation.type === "create") {
      return sql<ExtractionOperationOutcome>`case
        when (select count(*) from ${personalMemories}
          where ${personalMemories.userId} = ${input.userId}) < ${input.maxMemoriesPerUser}
          and not exists (select 1 from ${personalMemories}
            where ${personalMemories.id} = ${operation.memoryId})
        then 'created' else 'rejected' end`;
    }
    const successfulOutcome = operation.type === "update" ? "updated" : "deleted";
    return sql<ExtractionOperationOutcome>`case
      when exists (select 1 from ${personalMemories}
        where ${personalMemories.userId} = ${input.userId}
          and ${personalMemories.id} = ${operation.memoryId}
          and ${personalMemories.createdBy} = 'system')
      then ${successfulOutcome} else 'rejected' end`;
  }

  private enqueueExtractionVectorUpsert(
    input: MemoryExtractionClaimInput & { readonly operationIndex: number },
    mutationId: string,
  ) {
    return this.db
      .insert(pendingPersonalMemoryVectorUpserts)
      .select(
        this.db
          .select({
            userId: personalMemories.userId,
            memoryId: personalMemories.id,
            mutationId: sql<string>`${mutationId}`.as("mutation_id"),
            createdAt: sql<string>`${input.now.toISOString()}`.as("created_at"),
          })
          .from(personalMemories)
          .where(
            and(
              eq(personalMemories.userId, input.userId),
              exists(
                this.db
                  .select({
                    operationIndex: memoryExtractionOperations.operationIndex,
                  })
                  .from(memoryExtractionOperations)
                  .where(
                    and(
                      this.operationKey(input),
                      or(
                        eq(memoryExtractionOperations.outcome, "created"),
                        eq(memoryExtractionOperations.outcome, "updated"),
                      ),
                      eq(memoryExtractionOperations.counted, false),
                      eq(
                        memoryExtractionOperations.memoryId,
                        personalMemories.id,
                      ),
                    ),
                  ),
              ),
              exists(
                this.db
                  .select({ claimId: memoryExtractionIdempotency.claimId })
                  .from(memoryExtractionIdempotency)
                  .where(this.ownedClaim(input)),
              ),
            ),
          ),
      )
      .onConflictDoUpdate({
        target: [
          pendingPersonalMemoryVectorUpserts.userId,
          pendingPersonalMemoryVectorUpserts.memoryId,
        ],
        set: { mutationId, createdAt: input.now.toISOString() },
      });
  }

  private ownedClaim(input: MemoryExtractionClaimInput) {
    return and(
      eq(memoryExtractionIdempotency.userId, input.userId),
      eq(memoryExtractionIdempotency.batchIdHash, input.batchIdHash),
      eq(memoryExtractionIdempotency.claimId, input.claimId),
      gt(memoryExtractionIdempotency.leaseExpiresAt, input.now.toISOString()),
    );
  }

  private operationKey(
    input: Pick<
      MemoryExtractionClaimInput,
      "userId" | "batchIdHash"
    > & { readonly operationIndex: number },
  ) {
    return and(
      eq(memoryExtractionOperations.userId, input.userId),
      eq(memoryExtractionOperations.batchIdHash, input.batchIdHash),
      eq(memoryExtractionOperations.operationIndex, input.operationIndex),
    );
  }

  private async pruneExpiredCompleted(now: Date): Promise<void> {
    const timestamp = now.toISOString();
    const pruneOperations = this.db
      .delete(memoryExtractionOperations)
      .where(
        exists(
          this.db
            .select({ userId: memoryExtractionIdempotency.userId })
            .from(memoryExtractionIdempotency)
            .where(
              and(
                eq(
                  memoryExtractionIdempotency.userId,
                  memoryExtractionOperations.userId,
                ),
                eq(
                  memoryExtractionIdempotency.batchIdHash,
                  memoryExtractionOperations.batchIdHash,
                ),
                isNull(memoryExtractionIdempotency.claimId),
                lte(memoryExtractionIdempotency.expiresAt, timestamp),
              ),
            ),
        ),
      );
    const pruneClaims = this.db
      .delete(memoryExtractionIdempotency)
      .where(
        and(
          isNull(memoryExtractionIdempotency.claimId),
          lte(memoryExtractionIdempotency.expiresAt, timestamp),
        ),
      );
    await this.db.batch([pruneOperations, pruneClaims] as const);
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
  readonly personalMemoryStorage: PersonalMemoryStorage;
  readonly idempotencyStorage: MemoryExtractionIdempotencyStorage;
  readonly model?: MemoryAgentModel;
  readonly personalMemoryPolicy?: PersonalMemoryPolicy;
  readonly clock?: MemoryExtractionClock;
  readonly claimLeaseMs?: number;
  readonly claimHeartbeatMs?: number;
  readonly noOpResultTtlMs?: number;
  readonly beforeOperationCommit?: (input: {
    readonly operationIndex: number;
    readonly claimId: string;
  }) => Promise<void>;
};

class MemoryExtractionClaimLostError extends Error {
  constructor() {
    super("Extraction claim was lost before completion");
  }
}

class MemoryExtractionClaimLease {
  private readonly abortController = new AbortController();
  private readonly heartbeatPromise: Promise<void>;
  private renewalPromise: Promise<boolean> | null = null;
  private lost = false;

  constructor(
    private readonly storage: MemoryExtractionIdempotencyStorage,
    private readonly clock: MemoryExtractionClock,
    private readonly claim: {
      readonly userId: string;
      readonly batchIdHash: string;
      readonly claimId: string;
    },
    private readonly leaseMs: number,
    private readonly heartbeatMs: number,
  ) {
    this.heartbeatPromise = this.runHeartbeat();
  }

  async ensureOwned(): Promise<void> {
    if (this.lost || !(await this.renew())) {
      this.lost = true;
      throw new MemoryExtractionClaimLostError();
    }
  }

  async stop(): Promise<void> {
    this.abortController.abort();
    await this.heartbeatPromise;
  }

  private async renew(): Promise<boolean> {
    if (this.renewalPromise) return this.renewalPromise;

    const renewalPromise = this.renewClaim();
    this.renewalPromise = renewalPromise;
    try {
      return await renewalPromise;
    } finally {
      if (this.renewalPromise === renewalPromise) {
        this.renewalPromise = null;
      }
    }
  }

  private async renewClaim(): Promise<boolean> {
    const now = this.clock.now();
    const leaseExpiresAt = new Date(now.getTime() + this.leaseMs);
    const renewed = await this.storage.renew({
      ...this.claim,
      now,
      leaseExpiresAt,
    });
    return renewed && leaseExpiresAt > this.clock.now();
  }

  private async runHeartbeat(): Promise<void> {
    while (!this.abortController.signal.aborted && !this.lost) {
      try {
        await this.clock.sleep(
          this.heartbeatMs,
          this.abortController.signal,
        );
      } catch {
        if (this.abortController.signal.aborted) return;
        continue;
      }
      if (this.abortController.signal.aborted) return;

      try {
        if (!(await this.renew())) {
          this.lost = true;
        }
      } catch {
        // Mutation guards still fail closed if renewal remains unavailable.
      }
    }
  }
}

function isNoOpExtractionResult(counts: MemoryExtractionCounts): boolean {
  return (
    counts.created === 0 &&
    counts.updated === 0 &&
    counts.deleted === 0 &&
    counts.rejected === 0
  );
}

export class MemoryExtractionService {
  private readonly personalMemoryService: PersonalMemoryService;
  private readonly personalMemoryStorage: PersonalMemoryStorage;
  private readonly idempotencyStorage: MemoryExtractionIdempotencyStorage;
  private readonly model: MemoryAgentModel;
  private readonly personalMemoryPolicy: PersonalMemoryPolicy;
  private readonly clock: MemoryExtractionClock;
  private readonly claimLeaseMs: number;
  private readonly claimHeartbeatMs: number;
  private readonly noOpResultTtlMs: number;
  private readonly beforeOperationCommit?: MemoryExtractionServiceDependencies["beforeOperationCommit"];

  constructor(deps: MemoryExtractionServiceDependencies) {
    this.personalMemoryService = deps.personalMemoryService;
    this.personalMemoryStorage = deps.personalMemoryStorage;
    this.idempotencyStorage = deps.idempotencyStorage;
    this.model = deps.model ?? new NoOpMemoryAgentModel();
    this.personalMemoryPolicy = deps.personalMemoryPolicy ?? new PersonalMemoryPolicy(deps.personalMemoryService);
    this.clock = deps.clock ?? systemMemoryExtractionClock;
    this.claimLeaseMs = deps.claimLeaseMs ?? MEMORY_EXTRACTION_CLAIM_LEASE_MS;
    this.claimHeartbeatMs =
      deps.claimHeartbeatMs ?? MEMORY_EXTRACTION_CLAIM_HEARTBEAT_MS;
    this.noOpResultTtlMs =
      deps.noOpResultTtlMs ?? MEMORY_EXTRACTION_NO_OP_RESULT_TTL_MS;
    this.beforeOperationCommit = deps.beforeOperationCommit;
    if (
      this.claimLeaseMs <= 0 ||
      this.claimHeartbeatMs <= 0 ||
      this.claimHeartbeatMs >= this.claimLeaseMs ||
      this.noOpResultTtlMs <= 0
    ) {
      throw new Error("Memory extraction lease timings are invalid");
    }
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
      await this.personalMemoryService.reconcilePendingVectorMutations(userId);
      return claim.counts;
    }

    const lease = new MemoryExtractionClaimLease(
      this.idempotencyStorage,
      this.clock,
      { userId, batchIdHash, claimId: claim.claimId },
      this.claimLeaseMs,
      this.claimHeartbeatMs,
    );
    let counts: MemoryExtractionCounts | undefined;
    let failure: unknown;
    let failed = false;
    try {
      await lease.ensureOwned();
      const claimInput = () => ({
        userId,
        batchIdHash,
        claimId: claim.claimId,
        now: this.clock.now(),
      });
      let planRead = await this.idempotencyStorage.readPlan(claimInput());
      if (planRead.status === "claim_lost") {
        throw new MemoryExtractionClaimLostError();
      }
      if (planRead.status === "missing") {
        const memories =
          await this.personalMemoryService.selectCandidateMemoriesForExtraction(
            {
              userId,
              typingContext: extractionWindow.typingContext,
              activeApplication: extractionWindow.activeApplication,
              memoryEnabled: true,
            },
          );
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
        await lease.ensureOwned();
        const plan: MemoryExtractionPlan = {
          version: 1,
          operations:
            this.personalMemoryPolicy.planExtractionOperations(operations),
        };
        if (
          !(await this.idempotencyStorage.savePlan({
            ...claimInput(),
            plan,
          }))
        ) {
          throw new MemoryExtractionClaimLostError();
        }
        planRead = { status: "ready", plan };
      }

      for (
        let operationIndex = 0;
        operationIndex < planRead.plan.operations.length;
        operationIndex += 1
      ) {
        await lease.ensureOwned();
        await this.beforeOperationCommit?.({
          operationIndex,
          claimId: claim.claimId,
        });
        const applied = await this.idempotencyStorage.applyOperation({
          ...claimInput(),
          operationIndex,
          operation: planRead.plan.operations[operationIndex]!,
          maxMemoriesPerUser: this.personalMemoryPolicy.memoryLimit,
          personalMemoryStorage: this.personalMemoryStorage,
        });
        if (applied.status === "claim_lost") {
          throw new MemoryExtractionClaimLostError();
        }
      }

      await this.personalMemoryService.reconcilePendingVectorMutations(userId);
      await lease.ensureOwned();
      counts = await this.idempotencyStorage.readProgress(claimInput()) ?? undefined;
      if (!counts) throw new MemoryExtractionClaimLostError();
      const completedAt = this.clock.now();
      // A no-op row coordinates in-flight waiters only; it is not a 24-hour
      // idempotency record and is pruned on a claim/read after this short TTL.
      const resultTtlMs = isNoOpExtractionResult(counts)
        ? this.noOpResultTtlMs
        : MEMORY_EXTRACTION_WINDOW_POLICY.failedBatchTtlMs;
      const completed = await this.idempotencyStorage.complete({
        userId,
        batchIdHash,
        claimId: claim.claimId,
        now: completedAt,
        expiresAt: new Date(completedAt.getTime() + resultTtlMs),
      });
      if (!completed) {
        throw new MemoryExtractionClaimLostError();
      }
      counts = completed;
    } catch (error) {
      failed = true;
      failure = error;
    } finally {
      await lease.stop();
    }

    if (!failed && counts) return counts;
    if (failure instanceof MemoryExtractionClaimLostError) {
      const winner = await this.idempotencyStorage.waitForResult({
        userId,
        batchIdHash,
        waitUntil: new Date(this.clock.now().getTime() + this.claimLeaseMs),
      });
      if (winner) return winner;
      throw failure;
    }

    try {
      await this.idempotencyStorage.release({
        userId,
        batchIdHash,
        claimId: claim.claimId,
        now: this.clock.now(),
      });
    } catch {
      // The bounded lease still permits recovery if releasing the claim fails.
    }
    throw failure;
  }

  private async acquireClaim(
    userId: string,
    batchIdHash: string,
  ): Promise<Exclude<MemoryExtractionClaim, { status: "pending" }>> {
    while (true) {
      const now = this.clock.now();
      const claim = await this.idempotencyStorage.claim({
        userId,
        batchIdHash,
        now,
        leaseExpiresAt: new Date(now.getTime() + this.claimLeaseMs),
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
