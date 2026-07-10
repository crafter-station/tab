import {
  PersonalMemorySchema,
  type ActiveApplication,
  type PersonalMemory,
  type PersonalMemoryCreatedBy,
} from "@tab/contracts";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDatabase } from "./db/index.ts";
import {
  pendingPersonalMemoryVectorDeletions,
  personalMemories,
} from "./db/schema.ts";
import type { VectorizeBinding, WorkersAiBinding } from "./api-types.ts";

const MEMORY_EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
const DEFAULT_MAX_RELEVANT_MEMORIES = 10;

export type CreatePersonalMemoryInput = {
  readonly userId: string;
  readonly content: string;
  readonly createdBy: PersonalMemoryCreatedBy;
};

export type UpdatePersonalMemoryInput = {
  readonly content?: string;
  readonly createdBy?: PersonalMemoryCreatedBy;
};

export type UpdateExtractedPersonalMemoryInput = {
  readonly content: string;
};

export type PendingPersonalMemoryVectorDeletion = {
  readonly userId: string;
  readonly memoryId: string;
  readonly createdAt: string;
};

export interface PersonalMemoryStorage {
  createMemory(input: CreatePersonalMemoryInput): Promise<PersonalMemory>;
  listMemoriesByUser(userId: string): Promise<PersonalMemory[]>;
  findMemoryById(userId: string, id: string): Promise<PersonalMemory | null>;
  updateMemory(
    userId: string,
    id: string,
    input: UpdatePersonalMemoryInput,
  ): Promise<PersonalMemory | null>;
  deleteMemory(userId: string, id: string): Promise<boolean>;
  updateMemoryForExtraction(
    userId: string,
    id: string,
    input: UpdateExtractedPersonalMemoryInput,
  ): Promise<PersonalMemory | null>;
  deleteMemoryForExtraction(userId: string, id: string): Promise<boolean>;
  listPendingVectorDeletions(
    userId: string,
    memoryId?: string,
  ): Promise<PendingPersonalMemoryVectorDeletion[]>;
  enqueueVectorDeletion(userId: string, memoryId: string): Promise<void>;
  acknowledgeVectorDeletion(userId: string, memoryId: string): Promise<void>;
}

export type PersonalMemoryVectorMetadata = {
  readonly userId: string;
  readonly createdBy: PersonalMemoryCreatedBy;
};

export type PersonalMemoryVectorMatch = {
  readonly id: string;
  readonly score?: number;
};

export type UpsertPersonalMemoryVectorInput = {
  readonly id: string;
  readonly values: readonly number[];
  readonly metadata: PersonalMemoryVectorMetadata;
};

export type QueryPersonalMemoryVectorsInput = {
  readonly values: readonly number[];
  readonly userId: string;
  readonly limit: number;
};

export interface PersonalMemoryEmbeddingService {
  embedText(text: string): Promise<number[]>;
}

export interface PersonalMemoryVectorIndex {
  upsertMemory(input: UpsertPersonalMemoryVectorInput): Promise<void>;
  deleteMemory(id: string): Promise<void>;
  queryMemories(
    input: QueryPersonalMemoryVectorsInput,
  ): Promise<PersonalMemoryVectorMatch[]>;
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number");
}

function getProperty(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  return (value as Record<string, unknown>)[key];
}

function parseEmbeddingResponse(response: unknown): number[] {
  const data = getProperty(response, "data");
  const first = Array.isArray(data) ? data[0] : undefined;
  const embedding = getProperty(first, "embedding") ?? first;

  if (!isNumberArray(embedding)) {
    throw new Error("Workers AI embedding response did not contain a vector");
  }

  return embedding;
}

export class WorkersAiPersonalMemoryEmbeddingService
  implements PersonalMemoryEmbeddingService
{
  constructor(
    private readonly ai: WorkersAiBinding,
    private readonly model = MEMORY_EMBEDDING_MODEL,
  ) {}

  async embedText(text: string): Promise<number[]> {
    return parseEmbeddingResponse(
      await this.ai.run(this.model, { text: [text] }),
    );
  }
}

function parseVectorMatches(response: unknown): PersonalMemoryVectorMatch[] {
  const matches = getProperty(response, "matches");
  if (!Array.isArray(matches)) return [];

  return matches
    .map((match) => {
      const id = (match as { id?: unknown })?.id;
      if (typeof id !== "string") return null;

      const score = (match as { score?: unknown })?.score;
      return {
        id,
        ...(typeof score === "number" && { score }),
      } satisfies PersonalMemoryVectorMatch;
    })
    .filter((match): match is PersonalMemoryVectorMatch => match !== null);
}

export class CloudflareVectorizePersonalMemoryIndex
  implements PersonalMemoryVectorIndex
{
  constructor(private readonly index: VectorizeBinding) {}

  async upsertMemory(input: UpsertPersonalMemoryVectorInput): Promise<void> {
    await this.index.upsert([
      {
        id: input.id,
        values: Array.from(input.values),
        metadata: input.metadata,
      },
    ]);
  }

  async deleteMemory(id: string): Promise<void> {
    await this.index.deleteByIds([id]);
  }

  async queryMemories(
    input: QueryPersonalMemoryVectorsInput,
  ): Promise<PersonalMemoryVectorMatch[]> {
    return parseVectorMatches(
      await this.index.query(Array.from(input.values), {
        topK: input.limit,
        filter: { userId: input.userId },
        returnMetadata: true,
      }),
    );
  }
}

function toISOTimestamp(date: Date): string {
  return date.toISOString();
}

function createMemoryRecord(input: CreatePersonalMemoryInput): PersonalMemory {
  const now = toISOTimestamp(new Date());
  return {
    id: crypto.randomUUID(),
    userId: input.userId,
    content: input.content,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };
}

function compareMemoriesByNewestUpdate(
  a: PersonalMemory,
  b: PersonalMemory,
): number {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

export class InMemoryPersonalMemoryStorage implements PersonalMemoryStorage {
  private memories = new Map<string, PersonalMemory>();
  private pendingVectorDeletions = new Map<
    string,
    PendingPersonalMemoryVectorDeletion
  >();

  async createMemory(input: CreatePersonalMemoryInput): Promise<PersonalMemory> {
    const memory = createMemoryRecord(input);
    this.memories.set(memory.id, memory);
    return memory;
  }

  async listMemoriesByUser(userId: string): Promise<PersonalMemory[]> {
    return Array.from(this.memories.values())
      .filter((memory) => memory.userId === userId)
      .sort(compareMemoriesByNewestUpdate);
  }

  async findMemoryById(
    userId: string,
    id: string,
  ): Promise<PersonalMemory | null> {
    const memory = this.memories.get(id);
    return memory?.userId === userId ? memory : null;
  }

  async updateMemory(
    userId: string,
    id: string,
    input: UpdatePersonalMemoryInput,
  ): Promise<PersonalMemory | null> {
    const existing = this.memories.get(id);
    if (!existing || existing.userId !== userId) return null;

    const updated: PersonalMemory = {
      ...existing,
      ...(input.content !== undefined && { content: input.content }),
      ...(input.createdBy !== undefined && { createdBy: input.createdBy }),
      updatedAt: toISOTimestamp(new Date()),
    };
    this.memories.set(id, updated);
    return updated;
  }

  async deleteMemory(userId: string, id: string): Promise<boolean> {
    const existing = this.memories.get(id);
    if (!existing || existing.userId !== userId) return false;
    await this.enqueueVectorDeletion(userId, id);
    return this.memories.delete(id);
  }

  async updateMemoryForExtraction(
    userId: string,
    id: string,
    input: UpdateExtractedPersonalMemoryInput,
  ): Promise<PersonalMemory | null> {
    const existing = this.memories.get(id);
    if (
      !existing ||
      existing.userId !== userId ||
      existing.createdBy !== "system"
    ) {
      return null;
    }

    const updated: PersonalMemory = {
      ...existing,
      content: input.content,
      updatedAt: toISOTimestamp(new Date()),
    };
    this.memories.set(id, updated);
    return updated;
  }

  async deleteMemoryForExtraction(
    userId: string,
    id: string,
  ): Promise<boolean> {
    const existing = this.memories.get(id);
    if (
      !existing ||
      existing.userId !== userId ||
      existing.createdBy !== "system"
    ) {
      return false;
    }
    await this.enqueueVectorDeletion(userId, id);
    return this.memories.delete(id);
  }

  async listPendingVectorDeletions(
    userId: string,
    memoryId?: string,
  ): Promise<PendingPersonalMemoryVectorDeletion[]> {
    return Array.from(this.pendingVectorDeletions.values()).filter(
      (deletion) =>
        deletion.userId === userId &&
        (memoryId === undefined || deletion.memoryId === memoryId),
    );
  }

  async acknowledgeVectorDeletion(
    userId: string,
    memoryId: string,
  ): Promise<void> {
    this.pendingVectorDeletions.delete(`${userId}:${memoryId}`);
  }

  async enqueueVectorDeletion(userId: string, memoryId: string): Promise<void> {
    const key = `${userId}:${memoryId}`;
    if (this.pendingVectorDeletions.has(key)) return;
    this.pendingVectorDeletions.set(key, {
      userId,
      memoryId,
      createdAt: toISOTimestamp(new Date()),
    });
  }
}

function rowToMemory(row: typeof personalMemories.$inferSelect): PersonalMemory {
  return PersonalMemorySchema.parse({
    id: row.id,
    userId: row.userId,
    content: row.content,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

/**
 * D1-backed storage for Personal Memory records. The schema stores records
 * associated with users and includes authorship and timestamps.
 */
export class D1PersonalMemoryStorage implements PersonalMemoryStorage {
  private db: AppDatabase;

  constructor(db: AppDatabase) {
    this.db = db;
  }

  async createMemory(input: CreatePersonalMemoryInput): Promise<PersonalMemory> {
    const memory = createMemoryRecord(input);

    await this.db.insert(personalMemories).values({
      id: memory.id,
      userId: memory.userId,
      content: memory.content,
      createdBy: memory.createdBy,
      createdAt: memory.createdAt,
      updatedAt: memory.updatedAt,
    });

    return memory;
  }

  async listMemoriesByUser(userId: string): Promise<PersonalMemory[]> {
    const rows = await this.db
      .select()
      .from(personalMemories)
      .where(eq(personalMemories.userId, userId))
      .orderBy(desc(personalMemories.updatedAt));
    return rows.map(rowToMemory);
  }

  async findMemoryById(
    userId: string,
    id: string,
  ): Promise<PersonalMemory | null> {
    const row = await this.db.query.personalMemories.findFirst({
      where: and(
        eq(personalMemories.userId, userId),
        eq(personalMemories.id, id),
      ),
    });
    return row ? rowToMemory(row) : null;
  }

  async updateMemory(
    userId: string,
    id: string,
    input: UpdatePersonalMemoryInput,
  ): Promise<PersonalMemory | null> {
    const updatedAt = toISOTimestamp(new Date());
    const rows = await this.db
      .update(personalMemories)
      .set({
        ...(input.content !== undefined && { content: input.content }),
        ...(input.createdBy !== undefined && { createdBy: input.createdBy }),
        updatedAt,
      })
      .where(
        and(
          eq(personalMemories.userId, userId),
          eq(personalMemories.id, id),
        ),
      )
      .returning();

    return rows[0] ? rowToMemory(rows[0]) : null;
  }

  async deleteMemory(userId: string, id: string): Promise<boolean> {
    return this.deleteMemoryAndEnqueueVectorCleanup(userId, id, false);
  }

  async updateMemoryForExtraction(
    userId: string,
    id: string,
    input: UpdateExtractedPersonalMemoryInput,
  ): Promise<PersonalMemory | null> {
    const rows = await this.db
      .update(personalMemories)
      .set({
        content: input.content,
        updatedAt: toISOTimestamp(new Date()),
      })
      .where(
        and(
          eq(personalMemories.userId, userId),
          eq(personalMemories.id, id),
          eq(personalMemories.createdBy, "system"),
        ),
      )
      .returning();

    return rows[0] ? rowToMemory(rows[0]) : null;
  }

  async deleteMemoryForExtraction(
    userId: string,
    id: string,
  ): Promise<boolean> {
    return this.deleteMemoryAndEnqueueVectorCleanup(userId, id, true);
  }

  async listPendingVectorDeletions(
    userId: string,
    memoryId?: string,
  ): Promise<PendingPersonalMemoryVectorDeletion[]> {
    return this.db
      .select()
      .from(pendingPersonalMemoryVectorDeletions)
      .where(
        and(
          eq(pendingPersonalMemoryVectorDeletions.userId, userId),
          memoryId === undefined
            ? undefined
            : eq(pendingPersonalMemoryVectorDeletions.memoryId, memoryId),
        ),
      );
  }

  async acknowledgeVectorDeletion(
    userId: string,
    memoryId: string,
  ): Promise<void> {
    await this.db
      .delete(pendingPersonalMemoryVectorDeletions)
      .where(
        and(
          eq(pendingPersonalMemoryVectorDeletions.userId, userId),
          eq(pendingPersonalMemoryVectorDeletions.memoryId, memoryId),
        ),
      );
  }

  async enqueueVectorDeletion(userId: string, memoryId: string): Promise<void> {
    await this.db
      .insert(pendingPersonalMemoryVectorDeletions)
      .values({
        userId,
        memoryId,
        createdAt: toISOTimestamp(new Date()),
      })
      .onConflictDoNothing();
  }

  private async deleteMemoryAndEnqueueVectorCleanup(
    userId: string,
    id: string,
    systemCreatedOnly: boolean,
  ): Promise<boolean> {
    const predicate = and(
      eq(personalMemories.userId, userId),
      eq(personalMemories.id, id),
      systemCreatedOnly ? eq(personalMemories.createdBy, "system") : undefined,
    );
    const enqueueCleanup = this.db
      .insert(pendingPersonalMemoryVectorDeletions)
      .select(
        this.db
          .select({
            userId: personalMemories.userId,
            memoryId: personalMemories.id,
            createdAt: sql<string>`${toISOTimestamp(new Date())}`.as(
              "created_at",
            ),
          })
          .from(personalMemories)
          .where(predicate),
      )
      .onConflictDoNothing();
    const deleteCanonical = this.db
      .delete(personalMemories)
      .where(predicate)
      .returning({ id: personalMemories.id });
    const [, deleted] = await this.db.batch([
      enqueueCleanup,
      deleteCanonical,
    ] as const);
    return deleted.length > 0;
  }
}

export type PersonalMemoryServiceDependencies = {
  storage?: PersonalMemoryStorage;
  embeddingService?: PersonalMemoryEmbeddingService;
  vectorIndex?: PersonalMemoryVectorIndex;
  maxRelevantMemories?: number;
};

export type RelevanceInput = {
  readonly userId: string;
  readonly typingContext: string;
  readonly activeApplication: ActiveApplication;
  readonly memoryEnabled: boolean;
};

export type PersonalMemoryMutationGuard = () => Promise<void>;

const createMemoryInputSchema = z.object({
  userId: z.string().min(1),
  content: z.string().trim().min(1).max(500),
  createdBy: PersonalMemorySchema.shape.createdBy,
});

const updateMemoryInputSchema = z.object({
  content: z.string().trim().min(1).max(500).optional(),
  createdBy: PersonalMemorySchema.shape.createdBy.optional(),
});

const updateExtractedMemoryInputSchema = z.object({
  content: z.string().trim().min(1).max(500),
});

function normalizeTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  const normalizedText = text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();

  for (const token of normalizedText.split(/[^\p{Letter}\p{Number}]+/u)) {
    if (token.length >= 3) {
      tokens.add(token);
    }
  }
  return tokens;
}

function hasSharedSignificantToken(a: string, b: string): boolean {
  const sourceTokens = normalizeTokens(a);
  if (sourceTokens.size === 0) return false;

  return Array.from(normalizeTokens(b)).some((token) =>
    sourceTokens.has(token),
  );
}

function isMemoryRelevant(
  memory: PersonalMemory,
  typingContext: string,
  activeApplication: ActiveApplication,
): boolean {
  return (
    hasSharedSignificantToken(memory.content, typingContext) ||
    hasSharedSignificantToken(memory.content, activeApplication.bundleId)
  );
}

function selectTokenRelevantMemories(
  memories: readonly PersonalMemory[],
  input: RelevanceInput,
  limit: number,
): PersonalMemory[] {
  return memories
    .filter((memory) =>
      isMemoryRelevant(
        memory,
        input.typingContext,
        input.activeApplication,
      ),
    )
    .sort(compareMemoriesByNewestUpdate)
    .slice(0, limit);
}

function mergeMemoriesById(
  primary: readonly PersonalMemory[],
  secondary: readonly PersonalMemory[],
  limit: number,
): PersonalMemory[] {
  const memories: PersonalMemory[] = [];
  const seen = new Set<string>();

  for (const memory of [...primary, ...secondary]) {
    if (seen.has(memory.id)) continue;
    seen.add(memory.id);
    memories.push(memory);
    if (memories.length >= limit) break;
  }

  return memories;
}

/**
 * Service for reading and selecting Personal Memory in the hot suggestion path.
 * The service keeps the storage backend swappable and applies a small,
 * deterministic relevance filter so only selected current memories reach the
 * prompt.
 */
export class PersonalMemoryService {
  private storage: PersonalMemoryStorage;
  private embeddingService?: PersonalMemoryEmbeddingService;
  private vectorIndex?: PersonalMemoryVectorIndex;
  private maxRelevantMemories: number;

  constructor(deps: PersonalMemoryServiceDependencies = {}) {
    if (!deps.storage) {
      throw new Error("PersonalMemoryService requires a storage implementation");
    }
    this.storage = deps.storage;
    this.embeddingService = deps.embeddingService;
    this.vectorIndex = deps.vectorIndex;
    this.maxRelevantMemories = deps.maxRelevantMemories ?? DEFAULT_MAX_RELEVANT_MEMORIES;
  }

  async createMemory(
    input: CreatePersonalMemoryInput,
    beforeMutation?: PersonalMemoryMutationGuard,
  ): Promise<PersonalMemory> {
    const parsed = createMemoryInputSchema.parse(input);
    await beforeMutation?.();
    const memory = await this.storage.createMemory(parsed);
    await this.indexMemory(memory, beforeMutation);
    return memory;
  }

  async listMemories(userId: string): Promise<PersonalMemory[]> {
    await this.cleanupPendingVectorDeletions(userId);
    return this.storage.listMemoriesByUser(userId);
  }

  async findMemoryById(
    userId: string,
    id: string,
  ): Promise<PersonalMemory | null> {
    return this.storage.findMemoryById(userId, id);
  }

  async deleteMemory(userId: string, id: string): Promise<boolean> {
    const deleted = await this.storage.deleteMemory(userId, id);
    await this.cleanupPendingVectorDeletions(userId, id);
    return deleted;
  }

  async updateMemory(
    userId: string,
    id: string,
    input: UpdatePersonalMemoryInput,
  ): Promise<PersonalMemory | null> {
    const parsed = updateMemoryInputSchema.parse(input);
    const memory = await this.storage.updateMemory(userId, id, parsed);
    if (memory) {
      await this.indexMemory(memory);
    }
    return memory;
  }

  async updateMemoryForUser(
    userId: string,
    id: string,
    input: { readonly content: string },
  ): Promise<PersonalMemory | null> {
    const userAuthoredUpdate = updateMemoryInputSchema.parse({
      content: input.content,
      createdBy: "user",
    });
    return this.updateMemory(userId, id, userAuthoredUpdate);
  }

  async updateMemoryForExtraction(
    userId: string,
    id: string,
    input: UpdateExtractedPersonalMemoryInput,
    beforeMutation?: PersonalMemoryMutationGuard,
  ): Promise<PersonalMemory | null> {
    const parsed = updateExtractedMemoryInputSchema.parse(input);
    await beforeMutation?.();
    const memory = await this.storage.updateMemoryForExtraction(
      userId,
      id,
      parsed,
    );
    if (memory) {
      await this.indexMemory(memory, beforeMutation);
    }
    return memory;
  }

  async deleteMemoryForExtraction(
    userId: string,
    id: string,
    beforeMutation?: PersonalMemoryMutationGuard,
  ): Promise<boolean> {
    await beforeMutation?.();
    const deleted = await this.storage.deleteMemoryForExtraction(userId, id);
    await this.cleanupPendingVectorDeletions(userId, id, beforeMutation);
    return deleted;
  }

  async cleanupPendingVectorDeletions(
    userId: string,
    memoryId?: string,
    beforeMutation?: PersonalMemoryMutationGuard,
  ): Promise<void> {
    if (!this.vectorIndex) return;

    let pending: PendingPersonalMemoryVectorDeletion[];
    try {
      pending = await this.storage.listPendingVectorDeletions(userId, memoryId);
    } catch {
      return;
    }

    for (const deletion of pending) {
      await beforeMutation?.();
      try {
        await this.vectorIndex.deleteMemory(deletion.memoryId);
      } catch {
        // Canonical deletion is complete; leave the tombstone for a later retry.
        continue;
      }

      await beforeMutation?.();
      try {
        await this.storage.acknowledgeVectorDeletion(
          deletion.userId,
          deletion.memoryId,
        );
      } catch {
        // Leave the tombstone for a later idempotent vector deletion.
      }
    }
  }

  async reindexMemoryForUser(
    userId: string,
    id: string,
  ): Promise<PersonalMemory | null> {
    const memory = await this.storage.findMemoryById(userId, id);
    if (!memory) return null;

    await this.indexMemory(memory);
    return memory;
  }

  async selectRelevantMemories(input: RelevanceInput): Promise<PersonalMemory[]> {
    if (!input.memoryEnabled) {
      return [];
    }

    await this.cleanupPendingVectorDeletions(input.userId);

    if (this.embeddingService && this.vectorIndex) {
      return this.selectVectorRelevantMemories(
        input,
        this.embeddingService,
        this.vectorIndex,
      );
    }

    return selectTokenRelevantMemories(
      await this.storage.listMemoriesByUser(input.userId),
      input,
      this.maxRelevantMemories,
    );
  }

  async selectCandidateMemoriesForExtraction(
    input: RelevanceInput,
    beforeMutation?: PersonalMemoryMutationGuard,
  ): Promise<PersonalMemory[]> {
    if (!input.memoryEnabled) {
      return [];
    }

    await this.cleanupPendingVectorDeletions(
      input.userId,
      undefined,
      beforeMutation,
    );

    if (this.embeddingService && this.vectorIndex) {
      return this.selectVectorMemories(
        input,
        this.embeddingService,
        this.vectorIndex,
      );
    }

    return this.storage.listMemoriesByUser(input.userId);
  }

  private async selectVectorRelevantMemories(
    input: RelevanceInput,
    embeddingService: PersonalMemoryEmbeddingService,
    vectorIndex: PersonalMemoryVectorIndex,
  ): Promise<PersonalMemory[]> {
    try {
      const vectorMemories = await this.selectVectorMemories(
        input,
        embeddingService,
        vectorIndex,
      );
      const tokenMemories = selectTokenRelevantMemories(
        await this.storage.listMemoriesByUser(input.userId),
        input,
        this.maxRelevantMemories,
      );

      return mergeMemoriesById(
        vectorMemories,
        tokenMemories,
        this.maxRelevantMemories,
      );
    } catch {
      // Memory retrieval is best-effort on the hot suggestion path.
      return [];
    }
  }

  private async selectVectorMemories(
    input: RelevanceInput,
    embeddingService: PersonalMemoryEmbeddingService,
    vectorIndex: PersonalMemoryVectorIndex,
  ): Promise<PersonalMemory[]> {
    const values = await embeddingService.embedText(input.typingContext);
    const matches = await vectorIndex.queryMemories({
      values,
      userId: input.userId,
      limit: this.maxRelevantMemories,
    });
    const memories: PersonalMemory[] = [];

    for (const match of matches) {
      if (memories.length >= this.maxRelevantMemories) break;
      const memory = await this.storage.findMemoryById(input.userId, match.id);
      if (memory) {
        memories.push(memory);
      }
    }

    return memories;
  }

  private async indexMemory(
    memory: PersonalMemory,
    beforeMutation?: PersonalMemoryMutationGuard,
  ): Promise<void> {
    if (!this.embeddingService || !this.vectorIndex) return;

    let indexedMemory = memory;
    while (true) {
      const values = await this.embeddingService.embedText(indexedMemory.content);
      await beforeMutation?.();
      await this.vectorIndex.upsertMemory({
        id: indexedMemory.id,
        values,
        metadata: {
          userId: indexedMemory.userId,
          createdBy: indexedMemory.createdBy,
        },
      });

      const canonical = await this.storage.findMemoryById(
        indexedMemory.userId,
        indexedMemory.id,
      );
      if (!canonical) {
        await beforeMutation?.();
        await this.storage.enqueueVectorDeletion(
          indexedMemory.userId,
          indexedMemory.id,
        );
        await this.cleanupPendingVectorDeletions(
          indexedMemory.userId,
          indexedMemory.id,
          beforeMutation,
        );
        return;
      }
      // A newer canonical update won while this embedding/upsert was in flight.
      if (
        canonical.content === indexedMemory.content &&
        canonical.createdBy === indexedMemory.createdBy
      ) {
        return;
      }

      indexedMemory = canonical;
    }
  }
}
