import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { getPlatformProxy } from "wrangler";
import type { D1Database } from "@cloudflare/workers-types";
import { createApp } from "../apps/api/src/index.ts";
import { createAuthInstance, migrateAuth } from "../apps/api/src/auth.ts";
import {
  D1DeviceTokenStorage,
  DeviceTokenService,
  InMemoryDeviceTokenStorage,
} from "../apps/api/src/device-tokens.ts";
import {
  D1PersonalMemoryStorage,
  InMemoryPersonalMemoryStorage,
  PersonalMemoryService,
  type AtomicExtractionOperationInput,
  type ExtractionOperationOutcome,
  type PersonalMemoryStorage,
  type QueryPersonalMemoryVectorsInput,
  type PersonalMemoryEmbeddingService,
  type PersonalMemoryVectorIndex,
  type PersonalMemoryVectorMatch,
  type PersonalMemoryVectorMetadata,
  type UpsertPersonalMemoryVectorInput,
} from "../apps/api/src/personal-memory.ts";
import {
  BillingService,
  D1BillingStorage,
  InMemoryBillingStorage,
} from "../apps/api/src/billing.ts";
import { createDatabase } from "../apps/api/src/db/index.ts";
import {
  ApiResponseSchema,
  MemoryDeleteResponseSchema,
  MemoryListResponseSchema,
  MemoryWriteResponseSchema,
} from "../packages/contracts/src/index.ts";
import { InMemoryTelemetryStorage } from "../apps/api/src/telemetry.ts";
import type {
  MemoryAgentModel,
  MemoryExtractionClock,
  MemoryExtractionIdempotencyStorage,
  ProposedMemoryOperation,
} from "../apps/api/src/personal-memory-extraction.ts";
import {
  D1MemoryExtractionIdempotencyStorage,
  InMemoryMemoryExtractionIdempotencyStorage,
  MemoryExtractionService,
} from "../apps/api/src/personal-memory-extraction.ts";
import { cleanupExpiredMemoryExtractionRecords } from "../apps/api/src/worker.ts";
import { createTestDatabase } from "./test-db.ts";
import type {
  SuggestionGenerator,
  SuggestionInput,
} from "../apps/api/src/index.ts";

async function createAuthenticatedTestApp(
  generateSuggestion?: SuggestionGenerator,
  vectorDeps?: {
    embeddingService: PersonalMemoryEmbeddingService;
    vectorIndex: PersonalMemoryVectorIndex;
  },
  memoryExtractionModel?: MemoryAgentModel,
  options?: {
    readonly personalMemoryStorage?: InMemoryPersonalMemoryStorage;
    readonly memoryExtractionIdempotencyStorage?: MemoryExtractionIdempotencyStorage;
  },
) {
  const database = new Database(":memory:");
  const auth = createAuthInstance({ database });
  await migrateAuth(auth);
  const deviceTokenStorage = new InMemoryDeviceTokenStorage();
  const deviceTokenService = new DeviceTokenService({ storage: deviceTokenStorage });
  const billingStorage = new InMemoryBillingStorage();
  const billingService = new BillingService({ storage: billingStorage });
  const personalMemoryStorage =
    options?.personalMemoryStorage ?? new InMemoryPersonalMemoryStorage();
  const app = createApp({
    generateSuggestion,
    auth,
    billingService,
    deviceTokenService,
    personalMemoryStorage,
    memoryExtractionModel,
    memoryExtractionIdempotencyStorage:
      options?.memoryExtractionIdempotencyStorage,
    ...vectorDeps,
    telemetryStorage: new InMemoryTelemetryStorage(),
  });
  const { token } = await deviceTokenService.createDeviceToken("user-1", {
    deviceId: "device-1",
    platform: "darwin",
    appVersion: "0.0.1",
  });
  await billingService.applyEntitlement({
    userId: "user-1",
    planId: "pro",
    polarCustomerId: "polar-customer-pro",
    polarSubscriptionId: "polar-sub-pro",
    status: "active",
    cachedAt: new Date(),
  });
  return { app, token, personalMemoryStorage, deviceTokenService };
}

async function createSecondUserToken(deviceTokenService: DeviceTokenService) {
  const { token } = await deviceTokenService.createDeviceToken("user-2", {
    deviceId: "device-2",
    platform: "darwin",
    appVersion: "0.0.1",
  });
  return token;
}

function authHeaders(token: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

const validSuggestionRequest = {
  requestId: "req-memory",
  deviceId: "device-1",
  mode: "deep_complete",
  typingContext: "Hello Acme",
  contextSource: "typed_text" as const,
  redaction: { applied: false, redactionCount: 0, kinds: [] as string[] },
  activeApplication: { bundleId: "com.apple.TextEdit" },
  memoryEnabled: true,
};

async function applyMigrationFile(db: Database, migrationPath: string) {
  const sql = await Bun.file(migrationPath).text();
  const statements = sql
    .split(";--> statement-breakpoint")
    .flatMap((part) => part.split(";"));

  for (const statement of statements) {
    const trimmed = statement.trim();
    if (trimmed) db.exec(trimmed);
  }
}

async function applyGeneratedMigrations(db: D1Database): Promise<void> {
  const journal = (await Bun.file(
    "apps/api/drizzle/meta/_journal.json",
  ).json()) as { entries: { tag: string }[] };

  for (const { tag } of journal.entries) {
    const sql = await Bun.file(`apps/api/drizzle/${tag}.sql`).text();
    const statements = sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    await db.batch(statements.map((statement) => db.prepare(statement)));
  }
}

class FakeEmbeddingService implements PersonalMemoryEmbeddingService {
  readonly embeddedTexts: string[] = [];

  async embedText(text: string): Promise<number[]> {
    this.embeddedTexts.push(text);
    return [text.length, this.embeddedTexts.length];
  }
}

class FakeVectorIndex implements PersonalMemoryVectorIndex {
  readonly upserts: Array<{
    id: string;
    values: number[];
    metadata: PersonalMemoryVectorMetadata;
  }> = [];
  readonly deletes: string[] = [];
  readonly vectors = new Map<string, UpsertPersonalMemoryVectorInput>();
  readonly queries: Array<{ values: number[]; userId: string; limit: number }> =
    [];
  matches: PersonalMemoryVectorMatch[] = [];
  failQueries = false;
  failUpserts = false;
  failDeletes = false;

  async upsertMemory(input: UpsertPersonalMemoryVectorInput): Promise<void> {
    if (this.failUpserts) {
      throw new Error("vector upsert unavailable");
    }
    this.upserts.push({
      id: input.id,
      values: Array.from(input.values),
      metadata: input.metadata,
    });
    this.vectors.set(input.id, input);
  }

  async deleteMemory(id: string): Promise<void> {
    this.deletes.push(id);
    if (this.failDeletes) {
      throw new Error("vector delete unavailable");
    }
    this.vectors.delete(id);
  }

  async queryMemories(
    input: QueryPersonalMemoryVectorsInput,
  ): Promise<PersonalMemoryVectorMatch[]> {
    this.queries.push({
      values: Array.from(input.values),
      userId: input.userId,
      limit: input.limit,
    });
    if (this.failQueries) {
      throw new Error("vector unavailable");
    }
    return this.matches;
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

class ManualMemoryExtractionClock implements MemoryExtractionClock {
  private current: Date;
  private readonly sleepers = new Set<() => void>();

  constructor(now = new Date("2026-07-10T10:00:00.000Z")) {
    this.current = now;
  }

  now(): Date {
    return new Date(this.current);
  }

  sleep(_ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.resolve();

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        this.sleepers.delete(finish);
        signal?.removeEventListener("abort", finish);
        resolve();
      };
      this.sleepers.add(finish);
      signal?.addEventListener("abort", finish, { once: true });
    });
  }

  advance(ms: number, wakeTimers = true): void {
    this.current = new Date(this.current.getTime() + ms);
    if (wakeTimers) {
      for (const wake of Array.from(this.sleepers)) wake();
    }
  }

  get pendingSleeps(): number {
    return this.sleepers.size;
  }
}

async function flushAsyncWork(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

class DeferredUpsertVectorIndex extends FakeVectorIndex {
  readonly upsertStarted = deferred<UpsertPersonalMemoryVectorInput>();
  readonly continueUpsert = deferred<void>();

  override async upsertMemory(
    input: UpsertPersonalMemoryVectorInput,
  ): Promise<void> {
    this.upsertStarted.resolve(input);
    await this.continueUpsert.promise;
    await super.upsertMemory(input);
  }
}

class DeferredTextEmbeddingService extends FakeEmbeddingService {
  readonly embeddingStarted = deferred<void>();
  readonly continueEmbedding = deferred<void>();
  private deferred = false;

  constructor(private readonly deferredText: string) {
    super();
  }

  override async embedText(text: string): Promise<number[]> {
    if (text === this.deferredText && !this.deferred) {
      this.deferred = true;
      this.embeddingStarted.resolve();
      await this.continueEmbedding.promise;
    }
    return super.embedText(text);
  }
}

function extractionBatch(batchId: string, text: string) {
  return {
    batchId,
    entries: [
      {
        id: `${batchId}-entry-1`,
        text,
        timestamp: "2026-07-08T00:00:00.000Z",
        contextSource: "typed_text" as const,
        activeApplication: { bundleId: "com.apple.TextEdit" },
        redaction: { applied: false, redactionCount: 0, kinds: [] as string[] },
      },
    ],
  };
}

async function hashBatchIdForTest(
  userId: string,
  batchId: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${userId}:${batchId}`),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function extractionModel(
  operations: readonly ProposedMemoryOperation[],
): MemoryAgentModel {
  return {
    async proposeOperations() {
      return operations;
    },
  };
}

function createD1MemoryStorage(options?: {
  readonly includeVectorDeletionOutbox?: boolean;
}): D1PersonalMemoryStorage {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE personal_memories (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      content text NOT NULL,
      created_by text DEFAULT 'system' NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE INDEX idx_personal_memories_user ON personal_memories (user_id);
  `);
  if (options?.includeVectorDeletionOutbox !== false) {
    sqlite.exec(`
      CREATE TABLE pending_personal_memory_vector_deletions (
        user_id text NOT NULL,
        memory_id text NOT NULL,
        created_at text NOT NULL,
        PRIMARY KEY (user_id, memory_id)
      );
    `);
  }
  sqlite.exec(`
    CREATE TABLE pending_personal_memory_vector_upserts (
      user_id text NOT NULL,
      memory_id text NOT NULL,
      mutation_id text NOT NULL,
      created_at text NOT NULL,
      PRIMARY KEY (user_id, memory_id)
    );
  `);
  return new D1PersonalMemoryStorage(createTestDatabase(sqlite));
}

function createExtractionIdempotencyDatabase(): Database {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE memory_extraction_idempotency (
      user_id text NOT NULL,
      batch_id_hash text NOT NULL,
      created integer NOT NULL,
      updated integer NOT NULL,
      deleted integer NOT NULL,
      rejected integer NOT NULL,
      claim_id text,
      lease_expires_at text,
      operation_plan text,
      operation_count integer DEFAULT 0 NOT NULL,
      created_at text NOT NULL,
      expires_at text NOT NULL,
      PRIMARY KEY (user_id, batch_id_hash)
    );
    CREATE INDEX idx_memory_extraction_idempotency_expires
      ON memory_extraction_idempotency (expires_at);
    CREATE TABLE memory_extraction_operations (
      user_id text NOT NULL,
      batch_id_hash text NOT NULL,
      operation_index integer NOT NULL,
      outcome text NOT NULL,
      memory_id text,
      counted integer DEFAULT 0 NOT NULL,
      created_at text NOT NULL,
      PRIMARY KEY (user_id, batch_id_hash, operation_index)
    );
    CREATE INDEX idx_memory_extraction_operations_batch
      ON memory_extraction_operations (user_id, batch_id_hash);
    CREATE TABLE personal_memories (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      content text NOT NULL,
      created_by text DEFAULT 'system' NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE INDEX idx_personal_memories_user ON personal_memories (user_id);
    CREATE TABLE pending_personal_memory_vector_deletions (
      user_id text NOT NULL,
      memory_id text NOT NULL,
      created_at text NOT NULL,
      PRIMARY KEY (user_id, memory_id)
    );
    CREATE TABLE pending_personal_memory_vector_upserts (
      user_id text NOT NULL,
      memory_id text NOT NULL,
      mutation_id text NOT NULL,
      created_at text NOT NULL,
      PRIMARY KEY (user_id, memory_id)
    );
  `);
  return sqlite;
}

class AuthorshipFlippingMemoryStorage extends InMemoryPersonalMemoryStorage {
  override async deleteMemoryForExtraction(
    userId: string,
    id: string,
  ): Promise<boolean> {
    await this.updateMemory(userId, id, { createdBy: "user" });
    return super.deleteMemoryForExtraction(userId, id);
  }
}

class CountingPersonalMemoryStorage extends InMemoryPersonalMemoryStorage {
  extractionDeletes = 0;

  override async deleteMemoryForExtraction(
    userId: string,
    id: string,
  ): Promise<boolean> {
    this.extractionDeletes += 1;
    return super.deleteMemoryForExtraction(userId, id);
  }

  override applyExtractionOperationAtomically(
    input: AtomicExtractionOperationInput,
  ): ExtractionOperationOutcome {
    const outcome = super.applyExtractionOperationAtomically(input);
    if (outcome === "deleted") this.extractionDeletes += 1;
    return outcome;
  }
}

class EffectCountingPersonalMemoryStorage extends InMemoryPersonalMemoryStorage {
  readonly extractionEffects = {
    created: 0,
    updated: 0,
    deleted: 0,
  };

  override applyExtractionOperationAtomically(
    input: AtomicExtractionOperationInput,
  ): ExtractionOperationOutcome {
    const outcome = super.applyExtractionOperationAtomically(input);
    if (outcome !== "rejected") this.extractionEffects[outcome] += 1;
    return outcome;
  }
}

async function expectOwnerScopedStorage(storage: PersonalMemoryStorage) {
  const memory = await storage.createMemory({
    userId: "user-1",
    content: "Owner-scoped memory",
    createdBy: "system",
  });

  expect(await storage.findMemoryById("user-2", memory.id)).toBeNull();
  expect(
    await storage.updateMemory("user-2", memory.id, {
      content: "Cross-user edit",
    }),
  ).toBeNull();
  expect(await storage.deleteMemory("user-2", memory.id)).toBe(false);
  expect(await storage.listPendingVectorDeletions("user-2")).toEqual([]);
  expect(await storage.findMemoryById("user-1", memory.id)).toMatchObject({
    content: "Owner-scoped memory",
  });

  expect(
    await storage.updateMemory("user-1", memory.id, { content: "Owner edit" }),
  ).toMatchObject({ content: "Owner edit" });
  expect(await storage.deleteMemory("user-1", memory.id)).toBe(true);
  expect(await storage.findMemoryById("user-1", memory.id)).toBeNull();
}

async function expectExtractionScopedStorage(storage: PersonalMemoryStorage) {
  const updateMemory = await storage.createMemory({
    userId: "user-1",
    content: "System update candidate",
    createdBy: "system",
  });
  const deleteMemory = await storage.createMemory({
    userId: "user-1",
    content: "System delete candidate",
    createdBy: "system",
  });
  const allowedUpdate = await storage.createMemory({
    userId: "user-1",
    content: "Allowed system update",
    createdBy: "system",
  });
  const allowedDelete = await storage.createMemory({
    userId: "user-1",
    content: "Allowed system delete",
    createdBy: "system",
  });

  expect(
    await storage.findMemoryById("user-1", updateMemory.id),
  ).toMatchObject({ createdBy: "system" });
  expect(
    await storage.findMemoryById("user-1", deleteMemory.id),
  ).toMatchObject({ createdBy: "system" });
  expect(
    await storage.updateMemoryForExtraction("user-2", updateMemory.id, {
      content: "Cross-owner overwrite",
    }),
  ).toBeNull();
  expect(
    await storage.deleteMemoryForExtraction("user-2", deleteMemory.id),
  ).toBe(false);

  await storage.updateMemory("user-1", updateMemory.id, {
    createdBy: "user",
  });
  await storage.updateMemory("user-1", deleteMemory.id, {
    createdBy: "user",
  });

  expect(
    await storage.updateMemoryForExtraction("user-1", updateMemory.id, {
      content: "System overwrite",
    }),
  ).toBeNull();
  expect(
    await storage.deleteMemoryForExtraction("user-1", deleteMemory.id),
  ).toBe(false);
  expect(
    await storage.findMemoryById("user-1", updateMemory.id),
  ).toMatchObject({ content: "System update candidate", createdBy: "user" });
  expect(
    await storage.findMemoryById("user-1", deleteMemory.id),
  ).toMatchObject({ content: "System delete candidate", createdBy: "user" });
  expect(await storage.listPendingVectorDeletions("user-1")).toEqual([]);
  expect(
    await storage.updateMemoryForExtraction("user-1", allowedUpdate.id, {
      content: "Updated by extraction",
    }),
  ).toMatchObject({ content: "Updated by extraction", createdBy: "system" });
  expect(
    await storage.deleteMemoryForExtraction("user-1", allowedDelete.id),
  ).toBe(true);
  expect(
    await storage.findMemoryById("user-1", allowedDelete.id),
  ).toBeNull();
}

describe("Personal Memory API", () => {
  it("scopes canonical reads and mutations to the owning user in every storage adapter", async () => {
    await expectOwnerScopedStorage(new InMemoryPersonalMemoryStorage());
    await expectOwnerScopedStorage(createD1MemoryStorage());
  });

  it("atomically protects memories whose authorship changes after an extraction candidate read", async () => {
    await expectExtractionScopedStorage(new InMemoryPersonalMemoryStorage());
    await expectExtractionScopedStorage(createD1MemoryStorage());
  });

  it("keeps D1 and in-memory extraction journals replay-safe with identical outcomes", async () => {
    async function runScenario(adapter: "d1" | "memory") {
      const clock = new ManualMemoryExtractionClock();
      const sqlite = adapter === "d1" ? createExtractionIdempotencyDatabase() : null;
      const database = sqlite ? createTestDatabase(sqlite) : null;
      const personalMemoryStorage = database
        ? new D1PersonalMemoryStorage(database)
        : new InMemoryPersonalMemoryStorage();
      const extractionStorage = database
        ? new D1MemoryExtractionIdempotencyStorage(database, clock)
        : new InMemoryMemoryExtractionIdempotencyStorage(clock);
      const updateTarget = await personalMemoryStorage.createMemory({
        userId: "user-1",
        content: "Old update target",
        createdBy: "system",
      });
      const deleteTarget = await personalMemoryStorage.createMemory({
        userId: "user-1",
        content: "Delete target",
        createdBy: "system",
      });
      const protectedTarget = await personalMemoryStorage.createMemory({
        userId: "user-1",
        content: "Protected user memory",
        createdBy: "user",
      });
      const now = clock.now();
      const claim = await extractionStorage.claim({
        userId: "user-1",
        batchIdHash: "journal-parity",
        now,
        leaseExpiresAt: new Date(now.getTime() + 1_000),
      });
      if (claim.status !== "claimed") throw new Error("Expected extraction claim");
      const operations = [
        {
          type: "create",
          memoryId: "journal-created-memory",
          content: "Created exactly once",
          eligible: true,
        },
        {
          type: "update",
          memoryId: updateTarget.id,
          content: "Updated exactly once",
          eligible: true,
        },
        {
          type: "delete",
          memoryId: deleteTarget.id,
          eligible: true,
        },
        {
          type: "update",
          memoryId: protectedTarget.id,
          content: "Must remain protected",
          eligible: true,
        },
      ] as const;
      const claimInput = {
        userId: "user-1",
        batchIdHash: "journal-parity",
        claimId: claim.claimId,
        now,
      };
      expect(
        await extractionStorage.savePlan({
          ...claimInput,
          plan: { version: 1, operations: Array.from(operations) },
        }),
      ).toBe(true);

      const firstOutcomes = [];
      const replayOutcomes = [];
      for (const [operationIndex, operation] of operations.entries()) {
        firstOutcomes.push(
          await extractionStorage.commitExtractionOperation({
            ...claimInput,
            operationIndex,
            operation,
            maxMemoriesPerUser: 500,
            commitCanonicalOperation: (input) =>
              personalMemoryStorage.applyExtractionOperationAtomically!(input),
          }),
        );
      }
      for (const [operationIndex, operation] of operations.entries()) {
        replayOutcomes.push(
          await extractionStorage.commitExtractionOperation({
            ...claimInput,
            operationIndex,
            operation,
            maxMemoriesPerUser: 500,
            commitCanonicalOperation: (input) =>
              personalMemoryStorage.applyExtractionOperationAtomically!(input),
          }),
        );
      }
      const progress = await extractionStorage.readProgress(claimInput);
      const memories = await personalMemoryStorage.listMemoriesByUser("user-1");

      return {
        firstOutcomes,
        replayOutcomes,
        progress,
        contents: memories.map((memory) => memory.content).sort(),
        d1JournalRows: sqlite
          ? (
              sqlite
                .query(
                  "select operation_index, outcome, counted from memory_extraction_operations order by operation_index",
                )
                .all() as Array<Record<string, unknown>>
            )
          : null,
      };
    }

    const inMemory = await runScenario("memory");
    const d1 = await runScenario("d1");
    expect(d1.firstOutcomes).toEqual(inMemory.firstOutcomes);
    expect(d1.replayOutcomes).toEqual(inMemory.replayOutcomes);
    expect(d1.progress).toEqual({
      created: 1,
      updated: 1,
      deleted: 1,
      rejected: 1,
    });
    expect(d1.progress).toEqual(inMemory.progress);
    expect(d1.contents).toEqual(inMemory.contents);
    expect(d1.contents).toEqual([
      "Created exactly once",
      "Protected user memory",
      "Updated exactly once",
    ]);
    expect(d1.d1JournalRows).toEqual([
      { operation_index: 0, outcome: "created", counted: 1 },
      { operation_index: 1, outcome: "updated", counted: 1 },
      { operation_index: 2, outcome: "deleted", counted: 1 },
      { operation_index: 3, outcome: "rejected", counted: 1 },
    ]);
  });

  it("rejects payload and index mismatches without satisfying extraction completion in either adapter", async () => {
    async function runScenario(adapter: "d1" | "memory") {
      const clock = new ManualMemoryExtractionClock();
      const sqlite = adapter === "d1" ? createExtractionIdempotencyDatabase() : null;
      const database = sqlite ? createTestDatabase(sqlite) : null;
      const personalMemoryStorage = database
        ? new D1PersonalMemoryStorage(database)
        : new InMemoryPersonalMemoryStorage();
      const extractionStorage = database
        ? new D1MemoryExtractionIdempotencyStorage(database, clock)
        : new InMemoryMemoryExtractionIdempotencyStorage(clock);
      const now = clock.now();
      const claim = await extractionStorage.claim({
        userId: "user-1",
        batchIdHash: "plan-mismatch",
        now,
        leaseExpiresAt: new Date(now.getTime() + 60_000),
      });
      if (claim.status !== "claimed") throw new Error("Expected extraction claim");
      const operation = {
        type: "create" as const,
        memoryId: "planned-memory",
        content: "Persisted planned content",
        eligible: true,
      };
      const claimInput = {
        userId: "user-1",
        batchIdHash: "plan-mismatch",
        claimId: claim.claimId,
        now,
      };
      expect(
        await extractionStorage.savePlan({
          ...claimInput,
          plan: { version: 1, operations: [operation] },
        }),
      ).toBe(true);

      await expect(
        extractionStorage.commitExtractionOperation({
          ...claimInput,
          operationIndex: 0,
          operation: { ...operation, content: "Caller-substituted content" },
          maxMemoriesPerUser: 500,
          commitCanonicalOperation: (input) =>
            personalMemoryStorage.applyExtractionOperationAtomically!(input),
        }),
      ).rejects.toThrow("does not match its durable plan");
      await expect(
        extractionStorage.commitExtractionOperation({
          ...claimInput,
          operationIndex: 1,
          operation,
          maxMemoriesPerUser: 500,
          commitCanonicalOperation: (input) =>
            personalMemoryStorage.applyExtractionOperationAtomically!(input),
        }),
      ).rejects.toThrow("does not match its durable plan");
      expect(
        await extractionStorage.complete({
          ...claimInput,
          expiresAt: new Date(now.getTime() + 86_400_000),
        }),
      ).toBeNull();
      expect(
        await personalMemoryStorage.findMemoryById("user-1", operation.memoryId),
      ).toBeNull();
      expect(
        sqlite?.query("select * from memory_extraction_operations").all() ?? [],
      ).toEqual([]);

      expect(
        await extractionStorage.commitExtractionOperation({
          ...claimInput,
          operationIndex: 0,
          operation,
          maxMemoriesPerUser: 500,
          commitCanonicalOperation: (input) =>
            personalMemoryStorage.applyExtractionOperationAtomically!(input),
        }),
      ).toEqual({ status: "applied", outcome: "created" });
      const completed = await extractionStorage.complete({
        ...claimInput,
        expiresAt: new Date(now.getTime() + 86_400_000),
      });

      return {
        completed,
        memory: await personalMemoryStorage.findMemoryById(
          "user-1",
          operation.memoryId,
        ),
        persistedClaim: sqlite
          ? sqlite
              .query(
                "select operation_plan, operation_count from memory_extraction_idempotency where user_id = ? and batch_id_hash = ?",
              )
              .get("user-1", "plan-mismatch")
          : null,
        journalRows: sqlite
          ? sqlite.query("select * from memory_extraction_operations").all()
          : [],
      };
    }

    const inMemory = await runScenario("memory");
    const d1 = await runScenario("d1");
    expect(d1.completed).toEqual(inMemory.completed);
    expect(d1.completed).toEqual({
      created: 1,
      updated: 0,
      deleted: 0,
      rejected: 0,
    });
    expect(d1.memory).toMatchObject({ content: "Persisted planned content" });
    expect(d1.memory).toMatchObject({ content: inMemory.memory?.content });
    expect(d1.persistedClaim).toEqual({
      operation_plan: null,
      operation_count: 0,
    });
    expect(d1.journalRows).toEqual([]);
  });

  it("preserves a durable D1 plan for takeover within the 24-hour recovery window", async () => {
    const clock = new ManualMemoryExtractionClock();
    const sqlite = createExtractionIdempotencyDatabase();
    const database = createTestDatabase(sqlite);
    const ownerStorage = new D1MemoryExtractionIdempotencyStorage(database, clock);
    const contenderStorage = new D1MemoryExtractionIdempotencyStorage(
      database,
      clock,
    );
    const startedAt = clock.now();
    const first = await ownerStorage.claim({
      userId: "user-1",
      batchIdHash: "retained-takeover",
      now: startedAt,
      leaseExpiresAt: new Date(startedAt.getTime() + 1_000),
    });
    if (first.status !== "claimed") throw new Error("Expected extraction claim");
    const operation = {
      type: "create" as const,
      memoryId: "retained-memory",
      content: "Retained plan content",
      eligible: true,
    };
    expect(
      await ownerStorage.savePlan({
        userId: "user-1",
        batchIdHash: "retained-takeover",
        claimId: first.claimId,
        now: startedAt,
        plan: { version: 1, operations: [operation] },
      }),
    ).toBe(true);

    clock.advance(1_001);
    const takeoverAt = clock.now();
    const replacement = await contenderStorage.claim({
      userId: "user-1",
      batchIdHash: "retained-takeover",
      now: takeoverAt,
      leaseExpiresAt: new Date(takeoverAt.getTime() + 1_000),
    });
    if (replacement.status !== "claimed") throw new Error("Expected takeover");

    expect(
      await contenderStorage.readPlan({
        userId: "user-1",
        batchIdHash: "retained-takeover",
        claimId: replacement.claimId,
        now: takeoverAt,
      }),
    ).toEqual({
      status: "ready",
      plan: { version: 1, operations: [operation] },
    });
  });

  it("physically prunes abandoned D1 claims and operation journals after 24 hours", async () => {
    const clock = new ManualMemoryExtractionClock();
    const sqlite = createExtractionIdempotencyDatabase();
    const database = createTestDatabase(sqlite);
    const storage = new D1MemoryExtractionIdempotencyStorage(database, clock);
    const personalMemoryStorage = new D1PersonalMemoryStorage(database);
    const startedAt = clock.now();
    const claim = await storage.claim({
      userId: "user-1",
      batchIdHash: "abandoned-plan",
      now: startedAt,
      leaseExpiresAt: new Date(startedAt.getTime() + 300_000),
    });
    if (claim.status !== "claimed") throw new Error("Expected extraction claim");
    const operation = {
      type: "create" as const,
      memoryId: "abandoned-memory",
      content: "Abandoned sensitive plan content",
      eligible: true,
    };
    const claimInput = {
      userId: "user-1",
      batchIdHash: "abandoned-plan",
      claimId: claim.claimId,
      now: startedAt,
    };
    await storage.savePlan({
      ...claimInput,
      plan: { version: 1, operations: [operation] },
    });
    await storage.commitExtractionOperation({
      ...claimInput,
      operationIndex: 0,
      operation,
      maxMemoriesPerUser: 500,
      commitCanonicalOperation: (input) =>
        personalMemoryStorage.applyExtractionOperationAtomically!(input),
    });
    await storage.release(claimInput);

    clock.advance(86_400_001);
    const pruneAt = clock.now();
    await storage.claim({
      userId: "user-1",
      batchIdHash: "prune-trigger",
      now: pruneAt,
      leaseExpiresAt: new Date(pruneAt.getTime() + 300_000),
    });

    expect(
      sqlite
        .query(
          "select * from memory_extraction_idempotency where batch_id_hash = 'abandoned-plan'",
        )
        .all(),
    ).toEqual([]);
    expect(
      sqlite
        .query(
          "select * from memory_extraction_operations where batch_id_hash = 'abandoned-plan'",
        )
        .all(),
    ).toEqual([]);
  });

  it("globally prunes expired extraction state while retaining takeover and completed records", async () => {
    const sqlite = createExtractionIdempotencyDatabase();
    const database = createTestDatabase(sqlite);
    const now = new Date("2026-07-10T12:00:00.000Z");
    const expiredAt = new Date(now.getTime() - 1).toISOString();
    const expiredLease = new Date(now.getTime() - 60_000).toISOString();
    const retainedUntil = new Date(now.getTime() + 60_000).toISOString();
    const operationPlan = (memoryId: string) =>
      JSON.stringify({
        version: 1,
        operations: [
          {
            type: "create",
            memoryId,
            content: "Retained operation content",
            eligible: true,
          },
        ],
      });
    const insertRecord = sqlite.prepare(`
      INSERT INTO memory_extraction_idempotency (
        user_id, batch_id_hash, created, updated, deleted, rejected,
        claim_id, lease_expires_at, operation_plan, operation_count,
        created_at, expires_at
      ) VALUES (?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?, ?)
    `);

    insertRecord.run(
      "user-1",
      "expired-abandoned",
      1,
      "expired-claim",
      expiredLease,
      operationPlan("expired-memory"),
      1,
      "2026-07-09T11:59:59.000Z",
      expiredAt,
    );
    insertRecord.run(
      "user-1",
      "retained-takeover",
      1,
      "takeover-claim",
      expiredLease,
      operationPlan("retained-memory"),
      1,
      "2026-07-10T11:00:00.000Z",
      retainedUntil,
    );
    insertRecord.run(
      "user-1",
      "retained-completed",
      1,
      null,
      null,
      null,
      0,
      "2026-07-10T11:00:00.000Z",
      retainedUntil,
    );
    const insertOperation = sqlite.prepare(`
      INSERT INTO memory_extraction_operations (
        user_id, batch_id_hash, operation_index, outcome, memory_id,
        counted, created_at
      ) VALUES ('user-1', ?, 0, 'created', ?, 1, ?)
    `);
    insertOperation.run(
      "expired-abandoned",
      "expired-memory",
      "2026-07-09T12:00:00.000Z",
    );
    insertOperation.run(
      "retained-takeover",
      "retained-memory",
      "2026-07-10T11:00:00.000Z",
    );

    await cleanupExpiredMemoryExtractionRecords(database, now);

    expect(
      sqlite
        .query(
          "select batch_id_hash, created, claim_id from memory_extraction_idempotency order by batch_id_hash",
        )
        .all(),
    ).toEqual([
      {
        batch_id_hash: "retained-completed",
        created: 1,
        claim_id: null,
      },
      {
        batch_id_hash: "retained-takeover",
        created: 1,
        claim_id: "takeover-claim",
      },
    ]);
    expect(
      sqlite
        .query(
          "select batch_id_hash, memory_id from memory_extraction_operations order by batch_id_hash",
        )
        .all(),
    ).toEqual([
      {
        batch_id_hash: "retained-takeover",
        memory_id: "retained-memory",
      },
    ]);
  });

  it("runs a non-no-op extraction through createApp production D1 wiring", async () => {
    const platform = await getPlatformProxy<{ DB: D1Database }>({
      configPath: "wrangler.jsonc",
      persist: false,
      remoteBindings: false,
    });

    try {
      await applyGeneratedMigrations(platform.env.DB);
      const now = Date.now();
      await platform.env.DB.prepare(
        "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
        .bind("user-production-d1", "D1 User", "d1@example.com", 1, now, now)
        .run();
      const database = createDatabase(platform.env.DB);
      await new BillingService({
        storage: new D1BillingStorage(database),
      }).applyEntitlement({
        userId: "user-production-d1",
        planId: "pro",
        polarCustomerId: "polar-customer-production-d1",
        polarSubscriptionId: "polar-sub-production-d1",
        status: "active",
        cachedAt: new Date(),
      });
      const deviceTokenService = new DeviceTokenService({
        storage: new D1DeviceTokenStorage(database),
      });
      const { token } = await deviceTokenService.createDeviceToken(
        "user-production-d1",
        {
          deviceId: "device-production-d1",
          platform: "darwin",
          appVersion: "0.0.1",
        },
      );
      const app = createApp({
        db: platform.env.DB,
        memoryExtractionModel: extractionModel([
          { type: "create", content: "Created through production D1 wiring" },
        ]),
      });

      const response = await app.request("/api/memory/extract", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify(
          extractionBatch("production-d1-batch", "Production D1 fact"),
        ),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        status: "ok",
        data: {
          counts: { created: 1, updated: 0, deleted: 0, rejected: 0 },
        },
      });
      expect(
        await platform.env.DB.prepare(
          "SELECT content FROM personal_memories WHERE user_id = ?",
        )
          .bind("user-production-d1")
          .all(),
      ).toMatchObject({
        results: [{ content: "Created through production D1 wiring" }],
      });
      expect(
        await platform.env.DB.prepare(
          "SELECT operation_plan, operation_count FROM memory_extraction_idempotency WHERE user_id = ?",
        )
          .bind("user-production-d1")
          .first(),
      ).toEqual({ operation_plan: null, operation_count: 0 });
      expect(
        await platform.env.DB.prepare(
          "SELECT COUNT(*) AS count FROM memory_extraction_operations WHERE user_id = ?",
        )
          .bind("user-production-d1")
          .first(),
      ).toEqual({ count: 0 });
    } finally {
      await platform.dispose();
    }
  });

  it("processes synchronous extraction operations and returns final counts", async () => {
    const embeddingService = new FakeEmbeddingService();
    const vectorIndex = new FakeVectorIndex();
    const { app, token, personalMemoryStorage } =
      await createAuthenticatedTestApp(
        undefined,
        { embeddingService, vectorIndex },
        {
          async proposeOperations(_job, memories) {
            return [
              { type: "create", content: "Prefers concise launch updates" },
              {
                type: "update",
                id: memories[0].id,
                content: "Works on Tab launch planning",
              },
              { type: "delete", id: memories[1].id, reason: "Contradicted" },
            ];
          },
        },
      );
    const updated = await personalMemoryStorage.createMemory({
      userId: "user-1",
      content: "Works on Tab",
      createdBy: "system",
    });
    const deleted = await personalMemoryStorage.createMemory({
      userId: "user-1",
      content: "Uses the old launch plan",
      createdBy: "system",
    });
    vectorIndex.matches = [{ id: updated.id }, { id: deleted.id }];

    const response = await app.request("/api/memory/extract", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(
        extractionBatch("batch-success", "I now use the new launch plan."),
      ),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      data: { counts: { created: 1, updated: 1, deleted: 1, rejected: 0 } },
    });
    expect(
      await personalMemoryStorage.findMemoryById("user-1", deleted.id),
    ).toBeNull();
    expect(
      (await personalMemoryStorage.findMemoryById("user-1", updated.id))?.content,
    ).toBe("Works on Tab launch planning");
    expect(vectorIndex.queries).toHaveLength(1);
    expect(embeddingService.embeddedTexts).toContain(
      "I now use the new launch plan.",
    );
    expect(vectorIndex.deletes).toEqual([deleted.id]);
    expect(
      await personalMemoryStorage.listPendingVectorDeletions("user-1"),
    ).toEqual([]);
  });

  it("returns prior extraction counts for repeated idempotency keys", async () => {
    const { app, token, personalMemoryStorage } =
      await createAuthenticatedTestApp(
        undefined,
        undefined,
        extractionModel([
          { type: "create", content: "Prefers concise launch updates" },
        ]),
      );

    const first = await app.request("/api/memory/extract", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(extractionBatch("batch-idempotent", "Launch facts")),
    });
    const second = await app.request("/api/memory/extract", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(extractionBatch("batch-idempotent", "Different text")),
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({
      status: "ok",
      data: { counts: { created: 1, updated: 0, deleted: 0, rejected: 0 } },
    });
    expect(await personalMemoryStorage.listMemoriesByUser("user-1")).toHaveLength(
      1,
    );
  });

  it("allows only one D1 extraction claim across storage instances", async () => {
    const sqlite = createExtractionIdempotencyDatabase();
    const firstStorage = new D1MemoryExtractionIdempotencyStorage(
      createTestDatabase(sqlite),
    );
    const secondStorage = new D1MemoryExtractionIdempotencyStorage(
      createTestDatabase(sqlite),
    );
    const now = new Date("2026-07-10T10:00:00.000Z");
    const leaseExpiresAt = new Date("2026-07-10T10:05:00.000Z");

    const claims = await Promise.all([
      firstStorage.claim({
        userId: "user-1",
        batchIdHash: "batch-hash",
        now,
        leaseExpiresAt,
      }),
      secondStorage.claim({
        userId: "user-1",
        batchIdHash: "batch-hash",
        now,
        leaseExpiresAt,
      }),
    ]);

    expect(claims.filter((claim) => claim.status === "claimed")).toHaveLength(1);
    expect(claims.filter((claim) => claim.status === "pending")).toHaveLength(1);
  });

  it("renews a live D1 lease without allowing an expired owner to revive it", async () => {
    const sqlite = createExtractionIdempotencyDatabase();
    const ownerStorage = new D1MemoryExtractionIdempotencyStorage(
      createTestDatabase(sqlite),
    );
    const contenderStorage = new D1MemoryExtractionIdempotencyStorage(
      createTestDatabase(sqlite),
    );
    const claim = await ownerStorage.claim({
      userId: "user-1",
      batchIdHash: "renewed-batch",
      now: new Date("2026-07-10T10:00:00.000Z"),
      leaseExpiresAt: new Date("2026-07-10T10:00:01.000Z"),
    });
    if (claim.status !== "claimed") throw new Error("Expected extraction claim");

    expect(
      await ownerStorage.renew({
        userId: "user-1",
        batchIdHash: "renewed-batch",
        claimId: claim.claimId,
        now: new Date("2026-07-10T10:00:00.500Z"),
        leaseExpiresAt: new Date("2026-07-10T10:00:02.000Z"),
      }),
    ).toBe(true);
    expect(
      await contenderStorage.claim({
        userId: "user-1",
        batchIdHash: "renewed-batch",
        now: new Date("2026-07-10T10:00:01.500Z"),
        leaseExpiresAt: new Date("2026-07-10T10:00:03.000Z"),
      }),
    ).toEqual({
      status: "pending",
      leaseExpiresAt: new Date("2026-07-10T10:00:02.000Z"),
    });

    const replacement = await contenderStorage.claim({
      userId: "user-1",
      batchIdHash: "renewed-batch",
      now: new Date("2026-07-10T10:00:02.001Z"),
      leaseExpiresAt: new Date("2026-07-10T10:00:03.001Z"),
    });
    expect(replacement.status).toBe("claimed");
    expect(
      await ownerStorage.renew({
        userId: "user-1",
        batchIdHash: "renewed-batch",
        claimId: claim.claimId,
        now: new Date("2026-07-10T10:00:02.001Z"),
        leaseExpiresAt: new Date("2026-07-10T10:00:04.000Z"),
      }),
    ).toBe(false);
  });

  it("atomically completes and reuses D1 extraction results while waiters observe completion", async () => {
    const sqlite = createExtractionIdempotencyDatabase();
    const ownerStorage = new D1MemoryExtractionIdempotencyStorage(
      createTestDatabase(sqlite),
    );
    const waiterStorage = new D1MemoryExtractionIdempotencyStorage(
      createTestDatabase(sqlite),
    );
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + 5_000);
    const claim = await ownerStorage.claim({
      userId: "user-1",
      batchIdHash: "completed-batch",
      now,
      leaseExpiresAt,
    });
    if (claim.status !== "claimed") throw new Error("Expected extraction claim");
    const counts = { created: 0, updated: 0, deleted: 0, rejected: 0 };
    const waiting = waiterStorage.waitForResult({
      userId: "user-1",
      batchIdHash: "completed-batch",
      waitUntil: leaseExpiresAt,
    });

    expect(
      await ownerStorage.savePlan({
        userId: "user-2",
        batchIdHash: "completed-batch",
        claimId: claim.claimId,
        now,
        plan: { version: 1, operations: [] },
      }),
    ).toBe(false);
    expect(
      await ownerStorage.savePlan({
        userId: "user-1",
        batchIdHash: "completed-batch",
        claimId: claim.claimId,
        now,
        plan: { version: 1, operations: [] },
      }),
    ).toBe(true);
    expect(
      await ownerStorage.complete({
        userId: "user-1",
        batchIdHash: "completed-batch",
        claimId: claim.claimId,
        now,
        expiresAt: new Date(now.getTime() + 60_000),
      }),
    ).toEqual(counts);
    expect(await waiting).toEqual(counts);
    expect(
      await waiterStorage.claim({
        userId: "user-1",
        batchIdHash: "completed-batch",
        now: new Date(now.getTime() + 1_000),
        leaseExpiresAt: new Date(now.getTime() + 6_000),
      }),
    ).toEqual({ status: "completed", counts });
  });

  it("takes over an expired D1 extraction lease and rejects the stale claimant", async () => {
    const sqlite = createExtractionIdempotencyDatabase();
    const firstStorage = new D1MemoryExtractionIdempotencyStorage(
      createTestDatabase(sqlite),
    );
    const secondStorage = new D1MemoryExtractionIdempotencyStorage(
      createTestDatabase(sqlite),
    );
    const startedAt = new Date("2026-07-10T10:00:00.000Z");
    const leaseExpiresAt = new Date("2026-07-10T10:00:01.000Z");
    const first = await firstStorage.claim({
      userId: "user-1",
      batchIdHash: "expired-batch",
      now: startedAt,
      leaseExpiresAt,
    });
    if (first.status !== "claimed") throw new Error("Expected first claim");

    expect(
      await secondStorage.claim({
        userId: "user-1",
        batchIdHash: "expired-batch",
        now: new Date("2026-07-10T10:00:00.999Z"),
        leaseExpiresAt: new Date("2026-07-10T10:05:00.999Z"),
      }),
    ).toEqual({ status: "pending", leaseExpiresAt });

    const recovered = await secondStorage.claim({
      userId: "user-1",
      batchIdHash: "expired-batch",
      now: new Date("2026-07-10T10:00:01.001Z"),
      leaseExpiresAt: new Date("2026-07-10T10:05:01.001Z"),
    });
    expect(recovered.status).toBe("claimed");
    expect(recovered).not.toMatchObject({ claimId: first.claimId });
    expect(
      await firstStorage.complete({
        userId: "user-1",
        batchIdHash: "expired-batch",
        claimId: first.claimId,
        now: new Date("2026-07-10T10:00:01.001Z"),
        expiresAt: new Date("2026-07-11T10:00:00.000Z"),
      }),
    ).toBeNull();
  });

  it("makes a stale D1 claimant physically unable to mutate after its final guard", async () => {
    const sqlite = createExtractionIdempotencyDatabase();
    const database = createTestDatabase(sqlite);
    const staleStorage = new D1MemoryExtractionIdempotencyStorage(database);
    const replacementStorage = new D1MemoryExtractionIdempotencyStorage(database);
    const personalMemoryStorage = new D1PersonalMemoryStorage(database);
    const startedAt = new Date("2026-07-10T10:00:00.000Z");
    const staleClaim = await staleStorage.claim({
      userId: "user-1",
      batchIdHash: "statement-fence",
      now: startedAt,
      leaseExpiresAt: new Date("2026-07-10T10:00:01.000Z"),
    });
    if (staleClaim.status !== "claimed") throw new Error("Expected stale claim");
    const operation = {
      type: "create" as const,
      memoryId: "statement-fenced-memory",
      content: "Must be created by the replacement",
      eligible: true,
    };
    expect(
      await staleStorage.savePlan({
        userId: "user-1",
        batchIdHash: "statement-fence",
        claimId: staleClaim.claimId,
        now: startedAt,
        plan: { version: 1, operations: [operation] },
      }),
    ).toBe(true);
    expect(
      await staleStorage.renew({
        userId: "user-1",
        batchIdHash: "statement-fence",
        claimId: staleClaim.claimId,
        now: new Date("2026-07-10T10:00:00.500Z"),
        leaseExpiresAt: new Date("2026-07-10T10:00:01.500Z"),
      }),
    ).toBe(true);

    const takeoverAt = new Date("2026-07-10T10:00:01.501Z");
    const replacementClaim = await replacementStorage.claim({
      userId: "user-1",
      batchIdHash: "statement-fence",
      now: takeoverAt,
      leaseExpiresAt: new Date("2026-07-10T10:00:02.501Z"),
    });
    if (replacementClaim.status !== "claimed") {
      throw new Error("Expected replacement claim");
    }
    await expect(
      staleStorage.commitExtractionOperation({
        userId: "user-1",
        batchIdHash: "statement-fence",
        claimId: staleClaim.claimId,
        now: takeoverAt,
        operationIndex: 0,
        operation,
        maxMemoriesPerUser: 500,
        commitCanonicalOperation: (input) =>
          personalMemoryStorage.applyExtractionOperationAtomically!(input),
      }),
    ).resolves.toEqual({ status: "claim_lost" });
    expect(
      await personalMemoryStorage.findMemoryById(
        "user-1",
        operation.memoryId,
      ),
    ).toBeNull();
    expect(
      sqlite
        .query("select * from memory_extraction_operations")
        .all(),
    ).toEqual([]);

    await expect(
      replacementStorage.commitExtractionOperation({
        userId: "user-1",
        batchIdHash: "statement-fence",
        claimId: replacementClaim.claimId,
        now: takeoverAt,
        operationIndex: 0,
        operation,
        maxMemoriesPerUser: 500,
        commitCanonicalOperation: (input) =>
          personalMemoryStorage.applyExtractionOperationAtomically!(input),
      }),
    ).resolves.toEqual({ status: "applied", outcome: "created" });
    expect(
      await personalMemoryStorage.findMemoryById(
        "user-1",
        operation.memoryId,
      ),
    ).toMatchObject({ content: operation.content, createdBy: "system" });
  });

  it("renews a live extraction claim while the model is running", async () => {
    const clock = new ManualMemoryExtractionClock();
    const idempotencyStorage =
      new InMemoryMemoryExtractionIdempotencyStorage(clock);
    const personalMemoryStorage = new InMemoryPersonalMemoryStorage();
    const modelStarted = deferred<void>();
    const continueModel = deferred<void>();
    let modelCalls = 0;
    const service = new MemoryExtractionService({
      personalMemoryService: new PersonalMemoryService({
        storage: personalMemoryStorage,
      }),
      idempotencyStorage,
      clock,
      claimLeaseMs: 100,
      claimHeartbeatMs: 25,
      model: {
        async proposeOperations() {
          modelCalls += 1;
          modelStarted.resolve();
          await continueModel.promise;
          return [{ type: "create", content: "Live claimant result" }];
        },
      },
    });
    const request = extractionBatch("batch-live-heartbeat", "Live claimant");

    const first = service.extract("user-1", request);
    await modelStarted.promise;
    clock.advance(75);
    await flushAsyncWork();
    clock.advance(50, false);
    const second = service.extract("user-1", request);
    await flushAsyncWork();

    expect(modelCalls).toBe(1);
    continueModel.resolve();
    const firstCounts = await first;
    clock.advance(1);

    await expect(second).resolves.toEqual(firstCounts);
    expect(firstCounts).toEqual({
      created: 1,
      updated: 0,
      deleted: 0,
      rejected: 0,
    });
    expect(
      await personalMemoryStorage.listMemoriesByUser("user-1"),
    ).toHaveLength(1);
    expect(clock.pendingSleeps).toBe(0);
  });

  it("fences a stale claimant after lease takeover before canonical or vector mutation", async () => {
    const clock = new ManualMemoryExtractionClock();
    const idempotencyStorage =
      new InMemoryMemoryExtractionIdempotencyStorage(clock);
    const personalMemoryStorage = new InMemoryPersonalMemoryStorage();
    const embeddingService = new FakeEmbeddingService();
    const vectorIndex = new FakeVectorIndex();
    const firstModelStarted = deferred<void>();
    const continueFirstModel = deferred<void>();
    let modelCalls = 0;
    const service = new MemoryExtractionService({
      personalMemoryService: new PersonalMemoryService({
        storage: personalMemoryStorage,
        embeddingService,
        vectorIndex,
      }),
      idempotencyStorage,
      clock,
      claimLeaseMs: 100,
      claimHeartbeatMs: 25,
      model: {
        async proposeOperations() {
          modelCalls += 1;
          if (modelCalls === 1) {
            firstModelStarted.resolve();
            await continueFirstModel.promise;
            return [{ type: "create", content: "Stale claimant mutation" }];
          }
          return [{ type: "create", content: "Replacement winner mutation" }];
        },
      },
    });
    const request = extractionBatch("batch-takeover", "Takeover facts");

    const stale = service.extract("user-1", request);
    await firstModelStarted.promise;
    // Simulate an isolate whose event loop is wedged: time advances, but its
    // heartbeat timer cannot run before a replacement takes the expired lease.
    clock.advance(101, false);
    const winnerCounts = await service.extract("user-1", request);
    continueFirstModel.resolve();

    await expect(stale).resolves.toEqual(winnerCounts);
    expect(winnerCounts).toEqual({
      created: 1,
      updated: 0,
      deleted: 0,
      rejected: 0,
    });
    expect(modelCalls).toBe(2);
    expect(
      (await personalMemoryStorage.listMemoriesByUser("user-1")).map(
        (memory) => memory.content,
      ),
    ).toEqual(["Replacement winner mutation"]);
    expect(vectorIndex.upserts).toHaveLength(1);
    expect(embeddingService.embeddedTexts).not.toContain(
      "Stale claimant mutation",
    );
    expect(clock.pendingSleeps).toBe(0);
  });

  it("fences takeover in the final guard-to-canonical-statement gap", async () => {
    const clock = new ManualMemoryExtractionClock();
    const idempotencyStorage =
      new InMemoryMemoryExtractionIdempotencyStorage(clock);
    const personalMemoryStorage = new EffectCountingPersonalMemoryStorage();
    const personalMemoryService = new PersonalMemoryService({
      storage: personalMemoryStorage,
    });
    let modelCalls = 0;
    const model = extractionModel([
      { type: "create", content: "Only the replacement may commit this" },
    ]);
    const replacement = new MemoryExtractionService({
      personalMemoryService,
      idempotencyStorage,
      clock,
      claimLeaseMs: 100,
      claimHeartbeatMs: 25,
      model: {
        async proposeOperations(job, memories) {
          modelCalls += 1;
          return model.proposeOperations(job, memories);
        },
      },
    });
    const replacementFinished = deferred<MemoryExtractionCounts>();
    let injected = false;
    const stale = new MemoryExtractionService({
      personalMemoryService,
      idempotencyStorage,
      clock,
      claimLeaseMs: 100,
      claimHeartbeatMs: 25,
      model: {
        async proposeOperations(job, memories) {
          modelCalls += 1;
          return model.proposeOperations(job, memories);
        },
      },
      async beforeOperationCommit() {
        if (injected) return;
        injected = true;
        clock.advance(101, false);
        replacementFinished.resolve(
          await replacement.extract(
            "user-1",
            extractionBatch("batch-guard-gap", "Guard gap"),
          ),
        );
      },
    });
    const request = extractionBatch("batch-guard-gap", "Guard gap");

    const staleResult = stale.extract("user-1", request);
    const winnerCounts = await replacementFinished.promise;

    await expect(staleResult).resolves.toEqual(winnerCounts);
    expect(winnerCounts).toEqual({
      created: 1,
      updated: 0,
      deleted: 0,
      rejected: 0,
    });
    expect(modelCalls).toBe(1);
    expect(personalMemoryStorage.extractionEffects).toEqual({
      created: 1,
      updated: 0,
      deleted: 0,
    });
    expect(
      await personalMemoryStorage.listMemoriesByUser("user-1"),
    ).toHaveLength(1);
  });

  it("resumes a durable plan after operation zero without duplicate effects or counts", async () => {
    const clock = new ManualMemoryExtractionClock();
    const idempotencyStorage =
      new InMemoryMemoryExtractionIdempotencyStorage(clock);
    const personalMemoryStorage = new EffectCountingPersonalMemoryStorage();
    const updateTarget = await personalMemoryStorage.createMemory({
      userId: "user-1",
      content: "Before takeover update",
      createdBy: "system",
    });
    const deleteTarget = await personalMemoryStorage.createMemory({
      userId: "user-1",
      content: "Before takeover delete",
      createdBy: "system",
    });
    const personalMemoryService = new PersonalMemoryService({
      storage: personalMemoryStorage,
    });
    let modelCalls = 0;
    const model: MemoryAgentModel = {
      async proposeOperations() {
        modelCalls += 1;
        return [
          { type: "create", content: "Created before takeover" },
          {
            type: "update",
            id: updateTarget.id,
            content: "Updated after takeover",
          },
          { type: "delete", id: deleteTarget.id, reason: "Contradicted" },
        ];
      },
    };
    const request = extractionBatch("batch-operation-resume", "Resume plan");
    const replacement = new MemoryExtractionService({
      personalMemoryService,
      idempotencyStorage,
      clock,
      claimLeaseMs: 100,
      claimHeartbeatMs: 25,
      model,
    });
    const replacementFinished = deferred<MemoryExtractionCounts>();
    let injected = false;
    const stale = new MemoryExtractionService({
      personalMemoryService,
      idempotencyStorage,
      clock,
      claimLeaseMs: 100,
      claimHeartbeatMs: 25,
      model,
      async beforeOperationCommit({ operationIndex }) {
        if (injected || operationIndex !== 1) return;
        injected = true;
        clock.advance(101, false);
        replacementFinished.resolve(
          await replacement.extract("user-1", request),
        );
      },
    });

    const staleResult = stale.extract("user-1", request);
    const winnerCounts = await replacementFinished.promise;

    await expect(staleResult).resolves.toEqual(winnerCounts);
    expect(winnerCounts).toEqual({
      created: 1,
      updated: 1,
      deleted: 1,
      rejected: 0,
    });
    expect(modelCalls).toBe(1);
    expect(personalMemoryStorage.extractionEffects).toEqual({
      created: 1,
      updated: 1,
      deleted: 1,
    });
    expect(
      (await personalMemoryStorage.listMemoriesByUser("user-1"))
        .map((memory) => memory.content)
        .sort(),
    ).toEqual(["Created before takeover", "Updated after takeover"]);
  });

  it("shares no-op completion with active waiters but expires its coordination result quickly", async () => {
    const clock = new ManualMemoryExtractionClock();
    const personalMemoryStorage = new InMemoryPersonalMemoryStorage();
    const sqlite = createExtractionIdempotencyDatabase();
    const idempotencyStorage = new D1MemoryExtractionIdempotencyStorage(
      createTestDatabase(sqlite),
      clock,
    );
    const firstModelStarted = deferred<void>();
    const continueFirstModel = deferred<void>();
    let modelCalls = 0;
    const service = new MemoryExtractionService({
      personalMemoryService: new PersonalMemoryService({
        storage: personalMemoryStorage,
      }),
      idempotencyStorage,
      clock,
      claimLeaseMs: 100,
      claimHeartbeatMs: 25,
      noOpResultTtlMs: 50,
      model: {
        async proposeOperations() {
          modelCalls += 1;
          if (modelCalls === 1) {
            firstModelStarted.resolve();
            await continueFirstModel.promise;
          }
          return [];
        },
      },
    });
    const request = extractionBatch("batch-no-op", "No durable fact");

    const first = service.extract("user-1", request);
    await firstModelStarted.promise;
    const waiter = service.extract("user-1", request);
    await flushAsyncWork();
    expect(modelCalls).toBe(1);

    continueFirstModel.resolve();
    const firstCounts = await first;
    clock.advance(1);
    await expect(waiter).resolves.toEqual(firstCounts);
    await expect(service.extract("user-1", request)).resolves.toEqual(
      firstCounts,
    );
    expect(modelCalls).toBe(1);

    clock.advance(51, false);
    await expect(
      idempotencyStorage.waitForResult({
        userId: "user-1",
        batchIdHash: await hashBatchIdForTest("user-1", "batch-no-op"),
        waitUntil: new Date(clock.now().getTime() + 1),
      }),
    ).resolves.toBeNull();
    expect(
      (
        sqlite
          .query("select count(*) as count from memory_extraction_idempotency")
          .get() as { count: number }
      ).count,
    ).toBe(0);
    await expect(service.extract("user-1", request)).resolves.toEqual(
      firstCounts,
    );
    expect(modelCalls).toBe(2);
    expect(firstCounts).toEqual({
      created: 0,
      updated: 0,
      deleted: 0,
      rejected: 0,
    });
    expect(clock.pendingSleeps).toBe(0);
  });

  it("stops the claim heartbeat and releases the lease when extraction fails", async () => {
    const clock = new ManualMemoryExtractionClock();
    const personalMemoryStorage = new InMemoryPersonalMemoryStorage();
    const idempotencyStorage =
      new InMemoryMemoryExtractionIdempotencyStorage(clock);
    let modelCalls = 0;
    const service = new MemoryExtractionService({
      personalMemoryService: new PersonalMemoryService({
        storage: personalMemoryStorage,
      }),
      idempotencyStorage,
      clock,
      claimLeaseMs: 100,
      claimHeartbeatMs: 25,
      model: {
        async proposeOperations() {
          modelCalls += 1;
          if (modelCalls === 1) throw new Error("model unavailable");
          return [];
        },
      },
    });
    const request = extractionBatch("batch-heartbeat-failure", "Retry facts");

    await expect(service.extract("user-1", request)).rejects.toThrow(
      "model unavailable",
    );
    expect(clock.pendingSleeps).toBe(0);
    await expect(service.extract("user-1", request)).resolves.toEqual({
      created: 0,
      updated: 0,
      deleted: 0,
      rejected: 0,
    });
    expect(modelCalls).toBe(2);
    expect(clock.pendingSleeps).toBe(0);
  });

  it("rejects unsafe extraction operations and protected user-created mutations", async () => {
    const { app, token, personalMemoryStorage } =
      await createAuthenticatedTestApp(undefined, undefined, {
        async proposeOperations(_job, memories) {
          return [
            { type: "create", content: "Stripe key sk_live_1234567890abcdef" },
            { type: "update", id: memories[0].id, content: "Changed by system" },
            { type: "delete", id: memories[0].id, reason: "Contradicted" },
            { type: "delete", id: memories[1].id },
          ];
        },
      });
    const userMemory = await personalMemoryStorage.createMemory({
      userId: "user-1",
      content: "User-authored fact",
      createdBy: "user",
    });
    const systemMemory = await personalMemoryStorage.createMemory({
      userId: "user-1",
      content: "System-authored fact",
      createdBy: "system",
    });

    const response = await app.request("/api/memory/extract", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(extractionBatch("batch-rejected", "Sensitive fact")),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      data: { counts: { created: 0, updated: 0, deleted: 0, rejected: 4 } },
    });
    expect(
      await personalMemoryStorage.findMemoryById("user-1", userMemory.id),
    ).toMatchObject({
      content: "User-authored fact",
      createdBy: "user",
    });
    expect(
      await personalMemoryStorage.findMemoryById("user-1", systemMemory.id),
    ).toMatchObject({
      content: "System-authored fact",
    });
  });

  it("rejects extraction creates at the memory cap while allowing updates", async () => {
    const { app, token, personalMemoryStorage } =
      await createAuthenticatedTestApp(undefined, undefined, {
        async proposeOperations(_job, memories) {
          return [
            {
              type: "update",
              id: memories[0].id,
              content: "Updated memory at cap",
            },
            { type: "create", content: "New memory over cap" },
          ];
        },
      });
    for (let index = 0; index < 500; index += 1) {
      await personalMemoryStorage.createMemory({
        userId: "user-1",
        content: `Memory ${index}`,
        createdBy: "system",
      });
    }

    const response = await app.request("/api/memory/extract", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(extractionBatch("batch-cap", "Cap facts")),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      data: { counts: { created: 0, updated: 1, deleted: 0, rejected: 1 } },
    });
    const memories = await personalMemoryStorage.listMemoriesByUser("user-1");
    expect(memories.some((memory) => memory.content === "Updated memory at cap"))
      .toBe(true);
    expect(memories).toHaveLength(500);
  });

  it("fails extraction when a memory write cannot be indexed", async () => {
    const embeddingService = new FakeEmbeddingService();
    const vectorIndex = new FakeVectorIndex();
    vectorIndex.failUpserts = true;
    const { app, token, personalMemoryStorage } =
      await createAuthenticatedTestApp(
        undefined,
        { embeddingService, vectorIndex },
        extractionModel([
          { type: "create", content: "Prefers concise launch updates" },
        ]),
      );

    const response = await app.request("/api/memory/extract", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(extractionBatch("batch-write-fail", "Launch facts")),
    });

    expect(response.status).toBe(500);
    expect(await personalMemoryStorage.listMemoriesByUser("user-1")).toHaveLength(
      1,
    );
  });

  it("migrates old memory rows into the simplified system-authored shape", async () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE personal_memories (
        id text PRIMARY KEY NOT NULL,
        user_id text NOT NULL,
        content text NOT NULL,
        category text NOT NULL,
        source text NOT NULL,
        sensitivity text NOT NULL,
        active integer NOT NULL,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );
      CREATE INDEX idx_personal_memories_user ON personal_memories (user_id);
      INSERT INTO personal_memories (
        id,
        user_id,
        content,
        category,
        source,
        sensitivity,
        active,
        created_at,
        updated_at
      ) VALUES (
        'memory-1',
        'user-1',
        'Preserve this learned fact',
        'preference',
        'suggestion',
        'low',
        1,
        '2026-07-01T00:00:00.000Z',
        '2026-07-02T00:00:00.000Z'
      );
    `);
    await applyMigrationFile(
      sqlite,
      "apps/api/drizzle/0001_add-memory-created-by.sql",
    );
    await applyMigrationFile(
      sqlite,
      "apps/api/drizzle/0002_drop-old-memory-fields.sql",
    );
    const storage = new D1PersonalMemoryStorage(createTestDatabase(sqlite));

    const memories = await storage.listMemoriesByUser("user-1");
    const columns = sqlite
      .query("PRAGMA table_info(personal_memories)")
      .all() as Array<{ name: string }>;

    expect(memories).toEqual([
      expect.objectContaining({
        id: "memory-1",
        userId: "user-1",
        content: "Preserve this learned fact",
        createdBy: "system",
      }),
    ]);
    expect(columns.map((column) => column.name)).not.toEqual(
      expect.arrayContaining(["category", "source", "sensitivity", "active"]),
    );
  });

  it("embeds and indexes memory content with generic vector metadata", async () => {
    const embeddingService = new FakeEmbeddingService();
    const vectorIndex = new FakeVectorIndex();
    const personalMemoryService = new PersonalMemoryService({
      storage: new InMemoryPersonalMemoryStorage(),
      embeddingService,
      vectorIndex,
    });

    const memory = await personalMemoryService.createMemory({
      userId: "user-1",
      content: "Acme prefers Friday status updates",
      createdBy: "system",
    });

    expect(embeddingService.embeddedTexts).toEqual([
      "Acme prefers Friday status updates",
    ]);
    expect(vectorIndex.upserts).toEqual([
      {
        id: memory.id,
        values: [34, 1],
        metadata: { userId: "user-1", createdBy: "system" },
      },
    ]);
  });

  it("repairs a failed manual-create vector upsert during a later memory list", async () => {
    const storage = createD1MemoryStorage();
    const embeddingService = new FakeEmbeddingService();
    const vectorIndex = new FakeVectorIndex();
    const personalMemoryService = new PersonalMemoryService({
      storage,
      embeddingService,
      vectorIndex,
    });
    vectorIndex.failUpserts = true;

    await expect(
      personalMemoryService.createMemory({
        userId: "user-1",
        content: "Manual create awaiting vector repair",
        createdBy: "user",
      }),
    ).rejects.toThrow("vector upsert unavailable");
    const [canonical] = await storage.listMemoriesByUser("user-1");
    expect(canonical).toBeDefined();
    expect(await storage.listPendingVectorUpserts("user-1")).toHaveLength(1);

    vectorIndex.failUpserts = false;
    expect(await personalMemoryService.listMemories("user-1")).toEqual([
      canonical!,
    ]);
    expect(vectorIndex.vectors.get(canonical!.id)).toMatchObject({
      metadata: { userId: "user-1", createdBy: "user" },
    });
    expect(await storage.listPendingVectorUpserts("user-1")).toEqual([]);
  });

  it("repairs failed manual updates during suggestion and extraction candidate retrieval", async () => {
    const storage = createD1MemoryStorage();
    const embeddingService = new FakeEmbeddingService();
    const vectorIndex = new FakeVectorIndex();
    const personalMemoryService = new PersonalMemoryService({
      storage,
      embeddingService,
      vectorIndex,
    });
    const memory = await personalMemoryService.createMemory({
      userId: "user-1",
      content: "Initial indexed content",
      createdBy: "user",
    });
    vectorIndex.matches = [{ id: memory.id }];
    vectorIndex.failUpserts = true;

    await expect(
      personalMemoryService.updateMemoryForUser("user-1", memory.id, {
        content: "Updated before suggestion retrieval",
      }),
    ).rejects.toThrow("vector upsert unavailable");
    vectorIndex.failUpserts = false;
    await personalMemoryService.selectRelevantMemories({
      userId: "user-1",
      typingContext: "No lexical overlap needed",
      activeApplication: { bundleId: "com.apple.TextEdit" },
      memoryEnabled: true,
    });
    expect(vectorIndex.vectors.get(memory.id)?.values[0]).toBe(
      "Updated before suggestion retrieval".length,
    );
    expect(await storage.listPendingVectorUpserts("user-1")).toEqual([]);

    vectorIndex.failUpserts = true;
    await expect(
      personalMemoryService.updateMemoryForUser("user-1", memory.id, {
        content: "Updated before extraction retrieval",
      }),
    ).rejects.toThrow("vector upsert unavailable");
    vectorIndex.failUpserts = false;
    await personalMemoryService.selectCandidateMemoriesForExtraction({
      userId: "user-1",
      typingContext: "Extraction candidate query",
      activeApplication: { bundleId: "com.apple.TextEdit" },
      memoryEnabled: true,
    });
    expect(vectorIndex.vectors.get(memory.id)?.values[0]).toBe(
      "Updated before extraction retrieval".length,
    );
    expect(await storage.listPendingVectorUpserts("user-1")).toEqual([]);
  });

  it("drains pending vector deletions after processing an initial upsert set", async () => {
    const storage = createD1MemoryStorage();
    const vectorIndex = new FakeVectorIndex();
    const personalMemoryService = new PersonalMemoryService({
      storage,
      embeddingService: new FakeEmbeddingService(),
      vectorIndex,
    });
    await storage.createMemory({
      userId: "user-1",
      content: "Pending upsert before cleanup drain",
      createdBy: "user",
    });
    await storage.enqueueVectorDeletion("user-1", "orphaned-vector");

    await personalMemoryService.reconcilePendingVectorMutations("user-1");

    expect(vectorIndex.deletes).toEqual(["orphaned-vector"]);
    expect(await storage.listPendingVectorUpserts("user-1")).toEqual([]);
    expect(await storage.listPendingVectorDeletions("user-1")).toEqual([]);
  });

  it("drains unrelated deletions when read-path upsert repair fails", async () => {
    const storage = createD1MemoryStorage();
    const vectorIndex = new FakeVectorIndex();
    const personalMemoryService = new PersonalMemoryService({
      storage,
      embeddingService: new FakeEmbeddingService(),
      vectorIndex,
    });
    const memory = await storage.createMemory({
      userId: "user-1",
      content: "Pending retryable upsert",
      createdBy: "user",
    });
    await storage.enqueueVectorDeletion("user-1", "unrelated-deleted-vector");
    vectorIndex.failUpserts = true;

    await expect(personalMemoryService.listMemories("user-1")).resolves.toEqual([
      memory,
    ]);

    expect(vectorIndex.deletes).toEqual(["unrelated-deleted-vector"]);
    expect(await storage.listPendingVectorDeletions("user-1")).toEqual([]);
    expect(await storage.listPendingVectorUpserts("user-1")).toEqual([
      expect.objectContaining({ memoryId: memory.id }),
    ]);

    vectorIndex.failUpserts = false;
    await personalMemoryService.listMemories("user-1");
    expect(await storage.listPendingVectorUpserts("user-1")).toEqual([]);
  });

  it("does not touch the vector index when a scoped mutation does not apply", async () => {
    const storage = new InMemoryPersonalMemoryStorage();
    const embeddingService = new FakeEmbeddingService();
    const vectorIndex = new FakeVectorIndex();
    const personalMemoryService = new PersonalMemoryService({
      storage,
      embeddingService,
      vectorIndex,
    });
    const memory = await storage.createMemory({
      userId: "user-1",
      content: "Private owner memory",
      createdBy: "system",
    });

    await expect(
      personalMemoryService.updateMemory("user-2", memory.id, {
        content: "Cross-user edit",
      }),
    ).resolves.toBeNull();
    await expect(
      personalMemoryService.deleteMemory("user-2", memory.id),
    ).resolves.toBe(false);

    expect(embeddingService.embeddedTexts).toEqual([]);
    expect(vectorIndex.upserts).toEqual([]);
    expect(vectorIndex.deletes).toEqual([]);
    expect(await storage.listPendingVectorDeletions("user-2")).toEqual([]);
  });

  it("keeps durable cleanup pending when vector deletion fails and drains it on retry", async () => {
    const storage = createD1MemoryStorage();
    const vectorIndex = new FakeVectorIndex();
    const personalMemoryService = new PersonalMemoryService({
      storage,
      embeddingService: new FakeEmbeddingService(),
      vectorIndex,
    });
    const memory = await personalMemoryService.createMemory({
      userId: "user-1",
      content: "Retryable deletion",
      createdBy: "user",
    });
    vectorIndex.failDeletes = true;

    await expect(
      personalMemoryService.deleteMemory("user-1", memory.id),
    ).resolves.toBe(true);
    expect(await storage.findMemoryById("user-1", memory.id)).toBeNull();
    expect(await storage.listPendingVectorDeletions("user-1")).toEqual([
      expect.objectContaining({ userId: "user-1", memoryId: memory.id }),
    ]);

    vectorIndex.failDeletes = false;
    await expect(
      personalMemoryService.deleteMemory("user-1", memory.id),
    ).resolves.toBe(false);
    expect(await storage.findMemoryById("user-1", memory.id)).toBeNull();
    expect(await storage.listPendingVectorDeletions("user-1")).toEqual([]);
    expect(vectorIndex.deletes).toEqual([memory.id, memory.id]);
  });

  it("removes a delayed vector upsert after a concurrent canonical deletion", async () => {
    const storage = createD1MemoryStorage();
    const vectorIndex = new DeferredUpsertVectorIndex();
    const personalMemoryService = new PersonalMemoryService({
      storage,
      embeddingService: new FakeEmbeddingService(),
      vectorIndex,
    });
    const creating = personalMemoryService.createMemory({
      userId: "user-1",
      content: "Memory deleted during indexing",
      createdBy: "user",
    });
    const delayedUpsert = await vectorIndex.upsertStarted.promise;

    await expect(
      personalMemoryService.deleteMemory("user-1", delayedUpsert.id),
    ).resolves.toBe(true);
    expect(vectorIndex.vectors.has(delayedUpsert.id)).toBe(false);
    expect(await storage.listPendingVectorDeletions("user-1")).toEqual([]);

    vectorIndex.continueUpsert.resolve();
    await creating;

    expect(await storage.findMemoryById("user-1", delayedUpsert.id)).toBeNull();
    expect(vectorIndex.vectors.has(delayedUpsert.id)).toBe(false);
    expect(await storage.listPendingVectorDeletions("user-1")).toEqual([]);
    expect(vectorIndex.deletes).toEqual([delayedUpsert.id, delayedUpsert.id]);
  });

  it("reconciles a delayed extraction upsert after lease loss and canonical deletion", async () => {
    const clock = new ManualMemoryExtractionClock();
    const idempotencyStorage =
      new InMemoryMemoryExtractionIdempotencyStorage(clock);
    const personalMemoryStorage = new InMemoryPersonalMemoryStorage();
    const vectorIndex = new DeferredUpsertVectorIndex();
    const personalMemoryService = new PersonalMemoryService({
      storage: personalMemoryStorage,
      embeddingService: new FakeEmbeddingService(),
      vectorIndex,
    });
    let modelCalls = 0;
    const model: MemoryAgentModel = {
      async proposeOperations() {
        modelCalls += 1;
        return [{ type: "create", content: "Deleted while vector is delayed" }];
      },
    };
    const createService = (beforeOperationCommit?: () => Promise<void>) =>
      new MemoryExtractionService({
        personalMemoryService,
        idempotencyStorage,
        clock,
        claimLeaseMs: 100,
        claimHeartbeatMs: 25,
        model,
        beforeOperationCommit,
      });
    const request = extractionBatch(
      "batch-delayed-extraction-vector",
      "Delayed vector fact",
    );

    const stale = createService().extract("user-1", request);
    const delayedUpsert = await vectorIndex.upsertStarted.promise;
    clock.advance(101, false);
    const replacementResumed = deferred<void>();
    const replacement = createService(async () => {
      replacementResumed.resolve();
    }).extract("user-1", request);
    await replacementResumed.promise;
    await personalMemoryStorage.deleteMemory("user-1", delayedUpsert.id);
    vectorIndex.continueUpsert.resolve();

    const replacementCounts = await replacement;
    await expect(stale).resolves.toEqual(replacementCounts);
    expect(replacementCounts).toEqual({
      created: 1,
      updated: 0,
      deleted: 0,
      rejected: 0,
    });
    expect(modelCalls).toBe(1);
    expect(
      await personalMemoryStorage.findMemoryById("user-1", delayedUpsert.id),
    ).toBeNull();
    expect(vectorIndex.vectors.has(delayedUpsert.id)).toBe(false);
    expect(
      await personalMemoryStorage.listPendingVectorUpserts(
        "user-1",
        delayedUpsert.id,
      ),
    ).toEqual([]);
    expect(
      await personalMemoryStorage.listPendingVectorDeletions(
        "user-1",
        delayedUpsert.id,
      ),
    ).toEqual([]);
  });

  it("reindexes the current canonical content after an older update resumes", async () => {
    const delayedContent = "Outdated concurrent content";
    const currentContent = "Current canonical content";
    const storage = createD1MemoryStorage();
    const embeddingService = new DeferredTextEmbeddingService(delayedContent);
    const vectorIndex = new FakeVectorIndex();
    const personalMemoryService = new PersonalMemoryService({
      storage,
      embeddingService,
      vectorIndex,
    });
    const memory = await personalMemoryService.createMemory({
      userId: "user-1",
      content: "Initial content",
      createdBy: "system",
    });
    const olderUpdate = personalMemoryService.updateMemory(
      "user-1",
      memory.id,
      { content: delayedContent },
    );
    await embeddingService.embeddingStarted.promise;

    await personalMemoryService.updateMemory("user-1", memory.id, {
      content: currentContent,
    });
    embeddingService.continueEmbedding.resolve();
    await olderUpdate;

    expect(await storage.findMemoryById("user-1", memory.id)).toMatchObject({
      content: currentContent,
    });
    expect(vectorIndex.vectors.get(memory.id)?.values[0]).toBe(
      currentContent.length,
    );
    expect(embeddingService.embeddedTexts.at(-1)).toBe(currentContent);
  });

  it("acknowledges cleanup after an ordinary vector deletion succeeds", async () => {
    const storage = createD1MemoryStorage();
    const vectorIndex = new FakeVectorIndex();
    const personalMemoryService = new PersonalMemoryService({
      storage,
      embeddingService: new FakeEmbeddingService(),
      vectorIndex,
    });
    const memory = await personalMemoryService.createMemory({
      userId: "user-1",
      content: "Ordinary successful deletion",
      createdBy: "user",
    });

    await expect(
      personalMemoryService.deleteMemory("user-1", memory.id),
    ).resolves.toBe(true);
    expect(await storage.findMemoryById("user-1", memory.id)).toBeNull();
    expect(await storage.listPendingVectorDeletions("user-1")).toEqual([]);
    expect(vectorIndex.deletes).toEqual([memory.id]);
  });

  it("does not touch vector storage when the atomic D1 deletion fails", async () => {
    const storage = createD1MemoryStorage({
      includeVectorDeletionOutbox: false,
    });
    const vectorIndex = new FakeVectorIndex();
    const personalMemoryService = new PersonalMemoryService({
      storage,
      embeddingService: new FakeEmbeddingService(),
      vectorIndex,
    });
    const memory = await personalMemoryService.createMemory({
      userId: "user-1",
      content: "Canonical memory survives D1 failure",
      createdBy: "user",
    });

    await expect(
      personalMemoryService.deleteMemory("user-1", memory.id),
    ).rejects.toThrow("pending_personal_memory_vector_deletions");
    expect(await storage.findMemoryById("user-1", memory.id)).not.toBeNull();
    expect(vectorIndex.deletes).toEqual([]);
  });

  it("leaves the vector untouched when extraction authorship flips before atomic deletion", async () => {
    const storage = new AuthorshipFlippingMemoryStorage();
    const vectorIndex = new FakeVectorIndex();
    const personalMemoryService = new PersonalMemoryService({
      storage,
      embeddingService: new FakeEmbeddingService(),
      vectorIndex,
    });
    const memory = await storage.createMemory({
      userId: "user-1",
      content: "System memory before concurrent edit",
      createdBy: "system",
    });

    await expect(
      personalMemoryService.deleteMemoryForExtraction("user-1", memory.id),
    ).resolves.toBe(false);
    expect(await storage.findMemoryById("user-1", memory.id)).toMatchObject({
      createdBy: "user",
    });
    expect(await storage.listPendingVectorDeletions("user-1")).toEqual([]);
    expect(vectorIndex.deletes).toEqual([]);
  });

  it("persists successful extraction counts while retrying failed vector cleanup", async () => {
    const embeddingService = new FakeEmbeddingService();
    const vectorIndex = new FakeVectorIndex();
    let modelCalls = 0;
    const { app, token, personalMemoryStorage } =
      await createAuthenticatedTestApp(
        undefined,
        { embeddingService, vectorIndex },
        {
          async proposeOperations(_job, memories) {
            modelCalls += 1;
            return [
              { type: "delete", id: memories[0].id, reason: "Contradicted" },
            ];
          },
        },
      );
    const memory = await personalMemoryStorage.createMemory({
      userId: "user-1",
      content: "Old extraction fact",
      createdBy: "system",
    });
    vectorIndex.matches = [{ id: memory.id }];
    vectorIndex.failDeletes = true;

    const first = await app.request("/api/memory/extract", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(extractionBatch("batch-cleanup-retry", "New fact")),
    });

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      status: "ok",
      data: { counts: { created: 0, updated: 0, deleted: 1, rejected: 0 } },
    });
    expect(
      await personalMemoryStorage.findMemoryById("user-1", memory.id),
    ).toBeNull();
    expect(
      await personalMemoryStorage.listPendingVectorDeletions("user-1"),
    ).toHaveLength(1);

    vectorIndex.failDeletes = false;
    const retry = await app.request("/api/memory/extract", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(extractionBatch("batch-cleanup-retry", "New fact")),
    });

    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({
      status: "ok",
      data: { counts: { created: 0, updated: 0, deleted: 1, rejected: 0 } },
    });
    expect(modelCalls).toBe(1);
    expect(
      await personalMemoryStorage.listPendingVectorDeletions("user-1"),
    ).toEqual([]);
    expect(vectorIndex.deletes).toEqual([memory.id, memory.id]);
  });

  it("shares one completed extraction across concurrent requests while failed vector cleanup remains durable", async () => {
    const modelStarted = deferred<void>();
    const continueModel = deferred<void>();
    const storage = new CountingPersonalMemoryStorage();
    const vectorIndex = new FakeVectorIndex();
    let modelCalls = 0;
    const { app, token } = await createAuthenticatedTestApp(
      undefined,
      { embeddingService: new FakeEmbeddingService(), vectorIndex },
      {
        async proposeOperations(_job, memories) {
          modelCalls += 1;
          modelStarted.resolve();
          await continueModel.promise;
          return [
            { type: "delete", id: memories[0].id, reason: "Contradicted" },
          ];
        },
      },
      {
        personalMemoryStorage: storage,
      },
    );
    const memory = await storage.createMemory({
      userId: "user-1",
      content: "Old concurrent extraction fact",
      createdBy: "system",
    });
    vectorIndex.matches = [{ id: memory.id }];
    vectorIndex.failDeletes = true;
    const request = () =>
      app.request("/api/memory/extract", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify(
          extractionBatch("batch-concurrent", "Replacement fact"),
        ),
      });

    const first = request();
    await modelStarted.promise;
    const second = request();
    await new Promise((resolve) => setTimeout(resolve, 0));
    continueModel.resolve();
    const responses = await Promise.all([first, second]);
    const bodies = await Promise.all(responses.map((response) => response.json()));

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(bodies).toEqual([
      {
        status: "ok",
        data: { counts: { created: 0, updated: 0, deleted: 1, rejected: 0 } },
      },
      {
        status: "ok",
        data: { counts: { created: 0, updated: 0, deleted: 1, rejected: 0 } },
      },
    ]);
    expect(modelCalls).toBe(1);
    expect(storage.extractionDeletes).toBe(1);
    expect(await storage.findMemoryById("user-1", memory.id)).toBeNull();
    expect(await storage.listPendingVectorDeletions("user-1")).toEqual([
      expect.objectContaining({ userId: "user-1", memoryId: memory.id }),
    ]);
  });

  it("reindexes an existing memory by id from canonical storage and is safe to rerun", async () => {
    const content = "Acme prefers Friday status updates";
    const embeddingService = new FakeEmbeddingService();
    const vectorIndex = new FakeVectorIndex();
    const personalMemoryService = new PersonalMemoryService({
      storage: new InMemoryPersonalMemoryStorage(),
      embeddingService,
      vectorIndex,
    });
    const memory = await personalMemoryService.createMemory({
      userId: "user-1",
      content,
      createdBy: "system",
    });
    vectorIndex.upserts.length = 0;
    embeddingService.embeddedTexts.length = 0;

    await expect(
      personalMemoryService.reindexMemoryForUser("user-1", memory.id),
    ).resolves.toMatchObject({ id: memory.id });
    await expect(
      personalMemoryService.reindexMemoryForUser("user-1", memory.id),
    ).resolves.toMatchObject({ id: memory.id });
    await expect(
      personalMemoryService.reindexMemoryForUser("user-2", memory.id),
    ).resolves.toBeNull();

    expect(embeddingService.embeddedTexts).toEqual([content, content]);
    expect(vectorIndex.upserts).toEqual([
      {
        id: memory.id,
        values: [34, 1],
        metadata: { userId: "user-1", createdBy: "system" },
      },
      {
        id: memory.id,
        values: [34, 2],
        metadata: { userId: "user-1", createdBy: "system" },
      },
    ]);
  });

  it("lists only the authenticated user's memories", async () => {
    const { app, token, personalMemoryStorage } =
      await createAuthenticatedTestApp();

    await personalMemoryStorage.createMemory({
      userId: "user-1",
      content: "Uses Tab for work",
      createdBy: "system",
    });
    await personalMemoryStorage.createMemory({
      userId: "user-1",
      content: "Lives in Portland",
      createdBy: "user",
    });
    await personalMemoryStorage.createMemory({
      userId: "user-2",
      content: "User two memory",
      createdBy: "system",
    });

    const response = await app.request("/api/memory", {
      headers: authHeaders(token),
    });

    expect(response.status).toBe(200);
    const body = MemoryListResponseSchema.parse(await response.json());
    expect(body.data.memories).toHaveLength(2);
    expect(
      body.data.memories.every((memory) => memory.userId === "user-1"),
    ).toBe(true);
    expect(body.data.memories.every((memory) => "createdBy" in memory)).toBe(
      true,
    );
    expect(body.data.memories[0]).not.toHaveProperty("category");
    expect(body.data.memories[0]).not.toHaveProperty("source");
    expect(body.data.memories[0]).not.toHaveProperty("sensitivity");
    expect(body.data.memories[0]).not.toHaveProperty("active");
  });

  it("lists current memories ordered by newest updated first", async () => {
    const { app, token, personalMemoryStorage } =
      await createAuthenticatedTestApp();

    const older = await personalMemoryStorage.createMemory({
      userId: "user-1",
      content: "Older memory",
      createdBy: "system",
    });
    const newer = await personalMemoryStorage.createMemory({
      userId: "user-1",
      content: "Newer memory",
      createdBy: "system",
    });
    await new Promise((resolve) => setTimeout(resolve, 1));
    await personalMemoryStorage.updateMemory("user-1", older.id, {
      content: "Updated older memory",
    });

    const response = await app.request("/api/memory", {
      headers: authHeaders(token),
    });

    expect(response.status).toBe(200);
    const body = MemoryListResponseSchema.parse(await response.json());
    expect(body.data.memories.map((memory) => memory.id)).toEqual([
      older.id,
      newer.id,
    ]);
  });

  it("creates a user-authored memory manually", async () => {
    const { app, token } = await createAuthenticatedTestApp();

    const response = await app.request("/api/memory", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ content: "Prefers morning meetings" }),
    });

    expect(response.status).toBe(200);
    const body = MemoryWriteResponseSchema.parse(await response.json());
    expect(body.data.memory.content).toBe("Prefers morning meetings");
    expect(body.data.memory.userId).toBe("user-1");
    expect(body.data.memory.createdBy).toBe("user");

    const listResponse = await app.request("/api/memory", {
      headers: authHeaders(token),
    });
    const listBody = MemoryListResponseSchema.parse(await listResponse.json());
    expect(listBody.data.memories.map((memory) => memory.id)).toEqual([
      body.data.memory.id,
    ]);
  });

  it("edits a system-created memory and converts authorship to user", async () => {
    const { app, token, personalMemoryStorage } =
      await createAuthenticatedTestApp();

    const memory = await personalMemoryStorage.createMemory({
      userId: "user-1",
      content: "Works at Acme",
      createdBy: "system",
    });

    const response = await app.request(`/api/memory/${memory.id}`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify({ content: "Works at Acme Robotics" }),
    });

    expect(response.status).toBe(200);
    const body = MemoryWriteResponseSchema.parse(await response.json());
    expect(body.data.memory.content).toBe("Works at Acme Robotics");
    expect(body.data.memory.createdBy).toBe("user");

    const stored = await personalMemoryStorage.findMemoryById(
      "user-1",
      memory.id,
    );
    expect(stored?.createdBy).toBe("user");
  });

  it("rejects editing another user's memory", async () => {
    const { app, token, personalMemoryStorage } =
      await createAuthenticatedTestApp();

    const otherMemory = await personalMemoryStorage.createMemory({
      userId: "user-2",
      content: "Private user two note",
      createdBy: "system",
    });

    const response = await app.request(`/api/memory/${otherMemory.id}`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify({ content: "Edited" }),
    });

    expect(response.status).toBe(404);
    const body = ApiResponseSchema.parse(await response.json());
    expect(body.status).toBe("error");
    if (body.status !== "error") throw new Error("Expected error response");
    expect(body.error.code).toBe("invalid_request");
  });

  it("deletes the user's own memory", async () => {
    const { app, token, personalMemoryStorage } =
      await createAuthenticatedTestApp();

    const memory = await personalMemoryStorage.createMemory({
      userId: "user-1",
      content: "Temporary note",
      createdBy: "user",
    });

    const response = await app.request(`/api/memory/${memory.id}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });

    expect(response.status).toBe(200);
    const body = MemoryDeleteResponseSchema.parse(await response.json());
    expect(body.data.deleted).toBe(true);

    const listResponse = await app.request("/api/memory", {
      headers: authHeaders(token),
    });
    const listBody = MemoryListResponseSchema.parse(await listResponse.json());
    expect(listBody.data.memories).toHaveLength(0);
  });

  it("hard-deletes a system-created memory", async () => {
    const { app, token, personalMemoryStorage } =
      await createAuthenticatedTestApp();

    const memory = await personalMemoryStorage.createMemory({
      userId: "user-1",
      content: "Learned note",
      createdBy: "system",
    });

    const response = await app.request(`/api/memory/${memory.id}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });

    expect(response.status).toBe(200);
    expect(
      await personalMemoryStorage.findMemoryById("user-1", memory.id),
    ).toBeNull();
  });

  it("rejects deletion of another user's memory", async () => {
    const { app, token, personalMemoryStorage, deviceTokenService } =
      await createAuthenticatedTestApp();
    const otherToken = await createSecondUserToken(deviceTokenService);

    const otherMemory = await personalMemoryStorage.createMemory({
      userId: "user-2",
      content: "Private user two note",
      createdBy: "user",
    });

    const response = await app.request(`/api/memory/${otherMemory.id}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });

    expect(response.status).toBe(404);
    const body = ApiResponseSchema.parse(await response.json());
    expect(body.status).toBe("error");
    if (body.status !== "error") throw new Error("Expected error response");
    expect(body.error.code).toBe("invalid_request");

    const otherListResponse = await app.request("/api/memory", {
      headers: authHeaders(otherToken),
    });
    const otherListBody = MemoryListResponseSchema.parse(
      await otherListResponse.json(),
    );
    expect(otherListBody.data.memories).toHaveLength(1);
  });

  it("rejects unauthenticated list requests", async () => {
    const { app } = await createAuthenticatedTestApp();

    const response = await app.request("/api/memory");

    expect(response.status).toBe(401);
    const body = ApiResponseSchema.parse(await response.json());
    expect(body.status).toBe("error");
    if (body.status !== "error") throw new Error("Expected error response");
    expect(body.error.code).toBe("unauthenticated");
  });

  it("includes relevant memories in the suggestion prompt", async () => {
    let capturedInput: SuggestionInput | null = null;
    const { app, token, personalMemoryStorage } =
      await createAuthenticatedTestApp(async (input) => {
        capturedInput = input;
        return { text: " suggestion" };
      });

    await personalMemoryStorage.createMemory({
      userId: "user-1",
      content: "Acme Corp is a customer",
      createdBy: "system",
    });

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(validSuggestionRequest),
    });

    expect(response.status).toBe(200);
    expect(capturedInput).not.toBeNull();
    expect(capturedInput?.memories).toHaveLength(1);
    expect(capturedInput?.memories[0].content).toBe("Acme Corp is a customer");
  });

  it("selects up to ten relevant memories for suggestions", async () => {
    let capturedInput: SuggestionInput | null = null;
    const { app, token, personalMemoryStorage } =
      await createAuthenticatedTestApp(async (input) => {
        capturedInput = input;
        return { text: " suggestion" };
      });

    for (let index = 1; index <= 12; index += 1) {
      await personalMemoryStorage.createMemory({
        userId: "user-1",
        content: `Acme memory ${index}`,
        createdBy: "system",
      });
    }

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(validSuggestionRequest),
    });

    expect(response.status).toBe(200);
    expect(capturedInput?.memories).toHaveLength(10);
  });

  it("retrieves suggestion memories through vector IDs resolved from canonical storage", async () => {
    let capturedInput: SuggestionInput | null = null;
    const embeddingService = new FakeEmbeddingService();
    const vectorIndex = new FakeVectorIndex();
    const { app, token, personalMemoryStorage } =
      await createAuthenticatedTestApp(
        async (input) => {
          capturedInput = input;
          return { text: " suggestion" };
        },
        { embeddingService, vectorIndex },
      );

    const selected = await personalMemoryStorage.createMemory({
      userId: "user-1",
      content: "Use the blue launch deck for Acme",
      createdBy: "system",
    });
    const otherUser = await personalMemoryStorage.createMemory({
      userId: "user-2",
      content: "Private memory from another user",
      createdBy: "system",
    });
    vectorIndex.matches = [
      { id: otherUser.id, score: 0.99 },
      { id: "deleted-memory", score: 0.98 },
      { id: selected.id, score: 0.97 },
    ];

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        ...validSuggestionRequest,
        typingContext: "This does not share lexical tokens",
      }),
    });

    expect(response.status).toBe(200);
    expect(embeddingService.embeddedTexts).toContain(
      "This does not share lexical tokens",
    );
    expect(vectorIndex.queries).toHaveLength(1);
    expect(vectorIndex.queries[0]).toMatchObject({ userId: "user-1", limit: 10 });
    expect(capturedInput?.memories.map((memory) => memory.id)).toEqual([
      selected.id,
    ]);
  });

  it("does not perform memory extraction during suggestion generation", async () => {
    let extractionModelCalls = 0;
    const { app, token, personalMemoryStorage } =
      await createAuthenticatedTestApp(
        async () => ({ text: " suggestion" }),
        undefined,
        {
          async proposeOperations() {
            extractionModelCalls += 1;
            return [{ type: "create", content: "Should not be extracted" }];
          },
        },
      );

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(validSuggestionRequest),
    });

    expect(response.status).toBe(200);
    expect(extractionModelCalls).toBe(0);
    expect(await personalMemoryStorage.listMemoriesByUser("user-1")).toEqual([]);
  });

  it("only reads memory during suggestion generation", async () => {
    let capturedInput: SuggestionInput | null = null;
    let extractionModelCalls = 0;
    const embeddingService = new FakeEmbeddingService();
    const vectorIndex = new FakeVectorIndex();
    const { app, token, personalMemoryStorage } = await createAuthenticatedTestApp(
      async (input) => {
        capturedInput = input;
        return { text: " suggestion" };
      },
      { embeddingService, vectorIndex },
      {
        async proposeOperations() {
          extractionModelCalls += 1;
          throw new Error("suggestions must not run memory extraction");
        },
      },
    );
    const memory = await personalMemoryStorage.createMemory({
      userId: "user-1",
      content: "Acme Corp is a customer",
      createdBy: "system",
    });
    vectorIndex.matches = [{ id: memory.id, score: 0.99 }];

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(validSuggestionRequest),
    });

    expect(response.status).toBe(200);
    expect(vectorIndex.queries).toHaveLength(1);
    expect(capturedInput?.memories.map((item) => item.id)).toEqual([memory.id]);
    expect(extractionModelCalls).toBe(0);
  });

  it("uses lexical memory retrieval when vector retrieval fails", async () => {
    let capturedInput: SuggestionInput | null = null;
    const embeddingService = new FakeEmbeddingService();
    const vectorIndex = new FakeVectorIndex();
    vectorIndex.failQueries = true;
    const { app, token, personalMemoryStorage } =
      await createAuthenticatedTestApp(
        async (input) => {
          capturedInput = input;
          return { text: " suggestion" };
        },
        { embeddingService, vectorIndex },
      );

    const memory = await personalMemoryStorage.createMemory({
      userId: "user-1",
      content: "Acme Corp is a customer",
      createdBy: "system",
    });

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(validSuggestionRequest),
    });

    expect(response.status).toBe(200);
    expect(capturedInput?.memories.map((item) => item.id)).toEqual([memory.id]);
  });

  it("matches relevant memories without requiring exact accent marks", async () => {
    let capturedInput: SuggestionInput | null = null;
    const { app, token, personalMemoryStorage } =
      await createAuthenticatedTestApp(async (input) => {
        capturedInput = input;
        return { text: " suggestion" };
      });

    await personalMemoryStorage.createMemory({
      userId: "user-1",
      content: "Jos\u00e9 prefers caf\u00e9 meetings",
      createdBy: "system",
    });

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        ...validSuggestionRequest,
        typingContext: "Ask Jose about cafe plans",
      }),
    });

    expect(response.status).toBe(200);
    expect(capturedInput).not.toBeNull();
    expect(capturedInput?.memories).toHaveLength(1);
    expect(capturedInput?.memories[0].content).toBe(
      "Jos\u00e9 prefers caf\u00e9 meetings",
    );
  });

  it("does not include irrelevant memories in the suggestion prompt", async () => {
    let capturedInput: SuggestionInput | null = null;
    const { app, token, personalMemoryStorage } =
      await createAuthenticatedTestApp(async (input) => {
        capturedInput = input;
        return { text: " suggestion" };
      });

    await personalMemoryStorage.createMemory({
      userId: "user-1",
      content: "Zephyr internals",
      createdBy: "system",
    });

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        ...validSuggestionRequest,
        typingContext: "Hello world",
      }),
    });

    expect(response.status).toBe(200);
    expect(capturedInput).not.toBeNull();
    expect(capturedInput?.memories).toHaveLength(0);
  });

  it("does not include deleted memories even when relevant", async () => {
    let capturedInput: SuggestionInput | null = null;
    const { app, token, personalMemoryStorage } =
      await createAuthenticatedTestApp(async (input) => {
        capturedInput = input;
        return { text: " suggestion" };
      });

    const memory = await personalMemoryStorage.createMemory({
      userId: "user-1",
      content: "Acme Corp is a customer",
      createdBy: "system",
    });
    await personalMemoryStorage.deleteMemory("user-1", memory.id);

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(validSuggestionRequest),
    });

    expect(response.status).toBe(200);
    expect(capturedInput).not.toBeNull();
    expect(capturedInput?.memories).toHaveLength(0);
  });

  it("skips memory lookup when memoryEnabled is false", async () => {
    let capturedInput: SuggestionInput | null = null;
    const { app, token, personalMemoryStorage } =
      await createAuthenticatedTestApp(async (input) => {
        capturedInput = input;
        return { text: " suggestion" };
      });

    await personalMemoryStorage.createMemory({
      userId: "user-1",
      content: "Acme Corp is a customer",
      createdBy: "system",
    });

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        ...validSuggestionRequest,
        memoryEnabled: false,
      }),
    });

    expect(response.status).toBe(200);
    expect(capturedInput).not.toBeNull();
    expect(capturedInput?.memories).toHaveLength(0);
  });
});
