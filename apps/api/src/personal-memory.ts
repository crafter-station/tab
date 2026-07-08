import {
  PersonalMemorySchema,
  type ActiveApplication,
  type PersonalMemory,
  type PersonalMemoryCreatedBy,
} from "@tabb/contracts";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { AppDatabase } from "./db/index.ts";
import { personalMemories } from "./db/schema.ts";

export type CreatePersonalMemoryInput = {
  readonly userId: string;
  readonly content: string;
  readonly createdBy: PersonalMemoryCreatedBy;
};

export type UpdatePersonalMemoryInput = {
  readonly content?: string;
  readonly createdBy?: PersonalMemoryCreatedBy;
};

export interface PersonalMemoryStorage {
  createMemory(input: CreatePersonalMemoryInput): Promise<PersonalMemory>;
  listMemoriesByUser(userId: string): Promise<PersonalMemory[]>;
  findMemoryById(id: string): Promise<PersonalMemory | null>;
  updateMemory(
    id: string,
    input: UpdatePersonalMemoryInput,
  ): Promise<PersonalMemory | null>;
  deleteMemory(id: string): Promise<boolean>;
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

export class InMemoryPersonalMemoryStorage implements PersonalMemoryStorage {
  private memories = new Map<string, PersonalMemory>();

  async createMemory(input: CreatePersonalMemoryInput): Promise<PersonalMemory> {
    const memory = createMemoryRecord(input);
    this.memories.set(memory.id, memory);
    return memory;
  }

  async listMemoriesByUser(userId: string): Promise<PersonalMemory[]> {
    return Array.from(this.memories.values())
      .filter((memory) => memory.userId === userId)
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
  }

  async findMemoryById(id: string): Promise<PersonalMemory | null> {
    return this.memories.get(id) ?? null;
  }

  async updateMemory(
    id: string,
    input: UpdatePersonalMemoryInput,
  ): Promise<PersonalMemory | null> {
    const existing = this.memories.get(id);
    if (!existing) return null;

    const updated: PersonalMemory = {
      ...existing,
      ...(input.content !== undefined && { content: input.content }),
      ...(input.createdBy !== undefined && { createdBy: input.createdBy }),
      updatedAt: toISOTimestamp(new Date()),
    };
    this.memories.set(id, updated);
    return updated;
  }

  async deleteMemory(id: string): Promise<boolean> {
    return this.memories.delete(id);
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

  async findMemoryById(id: string): Promise<PersonalMemory | null> {
    const row = await this.db.query.personalMemories.findFirst({
      where: eq(personalMemories.id, id),
    });
    return row ? rowToMemory(row) : null;
  }

  async updateMemory(
    id: string,
    input: UpdatePersonalMemoryInput,
  ): Promise<PersonalMemory | null> {
    const existing = await this.findMemoryById(id);
    if (!existing) return null;

    const content = input.content ?? existing.content;
    const createdBy = input.createdBy ?? existing.createdBy;
    const updatedAt = toISOTimestamp(new Date());

    await this.db
      .update(personalMemories)
      .set({
        content,
        createdBy,
        updatedAt,
      })
      .where(eq(personalMemories.id, id));

    return {
      ...existing,
      content,
      createdBy,
      updatedAt,
    };
  }

  async deleteMemory(id: string): Promise<boolean> {
    const result = await this.db
      .delete(personalMemories)
      .where(eq(personalMemories.id, id))
      .returning();
    return result.length > 0;
  }
}

export type PersonalMemoryServiceDependencies = {
  storage?: PersonalMemoryStorage;
  maxRelevantMemories?: number;
};

export type RelevanceInput = {
  readonly userId: string;
  readonly typingContext: string;
  readonly activeApplication: ActiveApplication;
  readonly memoryEnabled: boolean;
};

const createMemoryInputSchema = z.object({
  userId: z.string().min(1),
  content: z.string().min(1),
  createdBy: PersonalMemorySchema.shape.createdBy,
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

/**
 * Service for reading and selecting Personal Memory in the hot suggestion path.
 * The service keeps the storage backend swappable and applies a small,
 * deterministic relevance filter so only selected current memories reach the
 * prompt.
 */
export class PersonalMemoryService {
  private storage: PersonalMemoryStorage;
  private maxRelevantMemories: number;

  constructor(deps: PersonalMemoryServiceDependencies = {}) {
    if (!deps.storage) {
      throw new Error("PersonalMemoryService requires a storage implementation");
    }
    this.storage = deps.storage;
    this.maxRelevantMemories = deps.maxRelevantMemories ?? 5;
  }

  async createMemory(input: CreatePersonalMemoryInput): Promise<PersonalMemory> {
    const parsed = createMemoryInputSchema.parse(input);
    return this.storage.createMemory(parsed);
  }

  async listMemories(userId: string): Promise<PersonalMemory[]> {
    return this.storage.listMemoriesByUser(userId);
  }

  async findMemoryById(id: string): Promise<PersonalMemory | null> {
    return this.storage.findMemoryById(id);
  }

  async deleteMemory(userId: string, id: string): Promise<boolean> {
    const memory = await this.storage.findMemoryById(id);
    if (!memory || memory.userId !== userId) {
      return false;
    }
    return this.storage.deleteMemory(id);
  }

  async updateMemory(
    id: string,
    input: UpdatePersonalMemoryInput,
  ): Promise<PersonalMemory | null> {
    return this.storage.updateMemory(id, input);
  }

  async selectRelevantMemories(input: RelevanceInput): Promise<PersonalMemory[]> {
    if (!input.memoryEnabled) {
      return [];
    }

    return (await this.storage.listMemoriesByUser(input.userId))
      .filter((memory) =>
        isMemoryRelevant(
          memory,
          input.typingContext,
          input.activeApplication,
        ),
      )
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )
      .slice(0, this.maxRelevantMemories);
  }
}
