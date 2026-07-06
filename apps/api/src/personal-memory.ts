import {
  PersonalMemorySchema,
  type ActiveApplication,
  type PersonalMemory,
  type PersonalMemorySensitivity,
  type PersonalMemorySource,
} from "@tabb/contracts";
import { z } from "zod";
import type { D1DatabaseLike } from "./device-tokens.ts";

export type CreatePersonalMemoryInput = {
  readonly userId: string;
  readonly content: string;
  readonly category: string;
  readonly source: PersonalMemorySource;
  readonly sensitivity: PersonalMemorySensitivity;
  readonly active?: boolean;
};

export interface PersonalMemoryStorage {
  createMemory(input: CreatePersonalMemoryInput): Promise<PersonalMemory>;
  listMemoriesByUser(userId: string): Promise<PersonalMemory[]>;
  findMemoryById(id: string): Promise<PersonalMemory | null>;
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
    category: input.category,
    source: input.source,
    sensitivity: input.sensitivity,
    active: input.active ?? true,
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
    return Array.from(this.memories.values()).filter(
      (memory) => memory.userId === userId,
    );
  }

  async findMemoryById(id: string): Promise<PersonalMemory | null> {
    return this.memories.get(id) ?? null;
  }

  async deleteMemory(id: string): Promise<boolean> {
    return this.memories.delete(id);
  }
}

function rowToMemory(row: Record<string, unknown>): PersonalMemory {
  return PersonalMemorySchema.parse({
    id: String(row.id),
    userId: String(row.user_id),
    content: String(row.content),
    category: String(row.category),
    source: String(row.source),
    sensitivity: String(row.sensitivity),
    active: row.active === true || row.active === 1 || row.active === "1",
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  });
}

/**
 * D1-backed storage for Personal Memory records. The schema stores records
 * associated with users and includes metadata for category, source,
 * sensitivity, active state, and timestamps.
 */
export class D1PersonalMemoryStorage implements PersonalMemoryStorage {
  private db: D1DatabaseLike;

  constructor(db: unknown) {
    this.db = db as D1DatabaseLike;
  }

  async ensureTables(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS personal_memories (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        category TEXT NOT NULL,
        source TEXT NOT NULL,
        sensitivity TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_personal_memories_user ON personal_memories(user_id);
    `);
  }

  async createMemory(input: CreatePersonalMemoryInput): Promise<PersonalMemory> {
    const memory = createMemoryRecord(input);

    await this.db
      .prepare(
        `INSERT INTO personal_memories (id, user_id, content, category, source, sensitivity, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        memory.id,
        memory.userId,
        memory.content,
        memory.category,
        memory.source,
        memory.sensitivity,
        memory.active ? 1 : 0,
        memory.createdAt,
        memory.updatedAt,
      )
      .run();

    return memory;
  }

  async listMemoriesByUser(userId: string): Promise<PersonalMemory[]> {
    const result = (await this.db
      .prepare("SELECT * FROM personal_memories WHERE user_id = ?")
      .bind(userId)
      .all()) as { results: Record<string, unknown>[] };
    return result.results.map(rowToMemory);
  }

  async findMemoryById(id: string): Promise<PersonalMemory | null> {
    const row = (await this.db
      .prepare("SELECT * FROM personal_memories WHERE id = ?")
      .bind(id)
      .first()) as Record<string, unknown> | null;
    return row ? rowToMemory(row) : null;
  }

  async deleteMemory(id: string): Promise<boolean> {
    const result = await this.db
      .prepare("DELETE FROM personal_memories WHERE id = ?")
      .bind(id)
      .run();
    return result.success;
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
  category: z.string().min(1),
  source: PersonalMemorySchema.shape.source,
  sensitivity: PersonalMemorySchema.shape.sensitivity,
  active: z.boolean().optional(),
});

function normalizeTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const token of text.toLowerCase().split(/[^a-z0-9]+/)) {
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
  if (!memory.active) return false;

  const categoryMatchesApplication =
    memory.category.toLowerCase() === activeApplication.bundleId.toLowerCase();

  return (
    categoryMatchesApplication ||
    hasSharedSignificantToken(memory.content, typingContext) ||
    hasSharedSignificantToken(memory.category, typingContext)
  );
}

/**
 * Service for reading and selecting Personal Memory in the hot suggestion path.
 * The service keeps the storage backend swappable and applies a small,
 * deterministic relevance filter so only selected active memories reach the
 * prompt.
 */
export class PersonalMemoryService {
  private storage: PersonalMemoryStorage;
  private maxRelevantMemories: number;

  constructor(deps: PersonalMemoryServiceDependencies = {}) {
    this.storage = deps.storage ?? new InMemoryPersonalMemoryStorage();
    this.maxRelevantMemories = deps.maxRelevantMemories ?? 5;
  }

  async createMemory(input: CreatePersonalMemoryInput): Promise<PersonalMemory> {
    const parsed = createMemoryInputSchema.parse(input);
    return this.storage.createMemory(parsed);
  }

  async listMemories(userId: string): Promise<PersonalMemory[]> {
    return this.storage.listMemoriesByUser(userId);
  }

  async deleteMemory(userId: string, id: string): Promise<boolean> {
    const memory = await this.storage.findMemoryById(id);
    if (!memory || memory.userId !== userId) {
      return false;
    }
    return this.storage.deleteMemory(id);
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
