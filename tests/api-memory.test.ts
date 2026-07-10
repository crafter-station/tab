import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { createApp } from "../apps/api/src/index.ts";
import { createAuthInstance, migrateAuth } from "../apps/api/src/auth.ts";
import { DeviceTokenService, InMemoryDeviceTokenStorage } from "../apps/api/src/device-tokens.ts";
import {
  D1PersonalMemoryStorage,
  InMemoryPersonalMemoryStorage,
  PersonalMemoryService,
  type PersonalMemoryStorage,
  type QueryPersonalMemoryVectorsInput,
  type PersonalMemoryEmbeddingService,
  type PersonalMemoryVectorIndex,
  type PersonalMemoryVectorMatch,
  type PersonalMemoryVectorMetadata,
  type UpsertPersonalMemoryVectorInput,
} from "../apps/api/src/personal-memory.ts";
import { BillingService, InMemoryBillingStorage } from "../apps/api/src/billing.ts";
import {
  ApiResponseSchema,
  MemoryDeleteResponseSchema,
  MemoryListResponseSchema,
  MemoryWriteResponseSchema,
} from "../packages/contracts/src/index.ts";
import { InMemoryTelemetryStorage } from "../apps/api/src/telemetry.ts";
import type {
  MemoryAgentModel,
  MemoryExtractionIdempotencyStorage,
  ProposedMemoryOperation,
} from "../apps/api/src/memory-agent.ts";
import { D1MemoryExtractionIdempotencyStorage } from "../apps/api/src/memory-agent.ts";
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
    planId: "free",
    polarCustomerId: "polar-customer-free",
    polarSubscriptionId: "polar-sub-free",
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
      created_at text NOT NULL,
      expires_at text NOT NULL,
      PRIMARY KEY (user_id, batch_id_hash)
    );
    CREATE INDEX idx_memory_extraction_idempotency_expires
      ON memory_extraction_idempotency (expires_at);
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
    expect(embeddingService.embeddedTexts[0]).toBe(
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
    const counts = { created: 1, updated: 2, deleted: 3, rejected: 4 };
    const waiting = waiterStorage.waitForResult({
      userId: "user-1",
      batchIdHash: "completed-batch",
      waitUntil: leaseExpiresAt,
    });

    expect(
      await ownerStorage.complete({
        userId: "user-2",
        batchIdHash: "completed-batch",
        claimId: claim.claimId,
        counts,
        expiresAt: new Date(now.getTime() + 60_000),
      }),
    ).toBe(false);
    expect(
      await ownerStorage.complete({
        userId: "user-1",
        batchIdHash: "completed-batch",
        claimId: claim.claimId,
        counts,
        expiresAt: new Date(now.getTime() + 60_000),
      }),
    ).toBe(true);
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
        counts: { created: 1, updated: 0, deleted: 0, rejected: 0 },
        expiresAt: new Date("2026-07-11T10:00:00.000Z"),
      }),
    ).toBe(false);
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
    const sqlite = createExtractionIdempotencyDatabase();
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
        memoryExtractionIdempotencyStorage:
          new D1MemoryExtractionIdempotencyStorage(createTestDatabase(sqlite)),
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

  it("continues suggestions without memory when vector retrieval fails", async () => {
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
    expect(capturedInput?.memories).toEqual([]);
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
