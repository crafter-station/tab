import { describe, expect, it } from "bun:test";
import type { PersonalMemory } from "@tab/contracts";
import { PersonalMemoryPolicy } from "../apps/api/src/personal-memory-policy.ts";
import type { PersonalMemoryPolicyPort } from "../apps/api/src/personal-memory-policy.ts";

class FakePersonalMemoryPort implements PersonalMemoryPolicyPort {
  readonly memories = new Map<string, PersonalMemory>();
  created = 0;
  updated = 0;
  deleted = 0;
  failUpdates = false;
  failDeletes = false;

  async listMemories(userId: string): Promise<PersonalMemory[]> {
    return Array.from(this.memories.values()).filter((memory) => memory.userId === userId);
  }

  async findMemoryById(
    userId: string,
    id: string,
  ): Promise<PersonalMemory | null> {
    const memory = this.memories.get(id);
    return memory?.userId === userId ? memory : null;
  }

  async createMemory(input: {
    readonly userId: string;
    readonly content: string;
    readonly createdBy: "system";
  }): Promise<PersonalMemory> {
    this.created += 1;
    const now = new Date().toISOString();
    const memory: PersonalMemory = {
      id: `memory-${this.memories.size + 1}`,
      userId: input.userId,
      content: input.content,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    };
    this.memories.set(memory.id, memory);
    return memory;
  }

  async updateMemory(
    userId: string,
    id: string,
    input: { readonly content: string },
  ): Promise<PersonalMemory | null> {
    this.updated += 1;
    const memory = this.memories.get(id);
    if (!memory || memory.userId !== userId || this.failUpdates) return null;
    const updated = {
      ...memory,
      content: input.content,
      updatedAt: new Date().toISOString(),
    };
    this.memories.set(id, updated);
    return updated;
  }

  async deleteMemory(userId: string, id: string): Promise<boolean> {
    this.deleted += 1;
    const memory = this.memories.get(id);
    if (!memory || memory.userId !== userId || this.failDeletes) return false;
    return this.memories.delete(id);
  }
}

function memory(id: string, userId: string, createdBy: "user" | "system"): PersonalMemory {
  return {
    id,
    userId,
    content: `${createdBy} memory`,
    createdBy,
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
  };
}

describe("Personal Memory policy", () => {
  it("applies extraction authorship, safety, mutability, and cap rules behind one interface", async () => {
    const port = new FakePersonalMemoryPort();
    port.memories.set("user-memory", memory("user-memory", "user-1", "user"));
    port.memories.set("system-memory", memory("system-memory", "user-1", "system"));
    const policy = new PersonalMemoryPolicy(port, 3);

    const counts = await policy.applyExtractionOperations("user-1", [
      { type: "create", content: "Prefers Friday launch updates" },
      { type: "create", content: "Stripe key sk_live_1234567890abcdef" },
      { type: "update", id: "user-memory", content: "Should not change user memory" },
      { type: "update", id: "system-memory", content: "Updated system memory" },
      { type: "create", content: "Rejected because cap is reached" },
      { type: "delete", id: "user-memory", reason: "Contradicted" },
      { type: "delete", id: "system-memory", reason: "Contradicted" },
    ]);

    expect(counts).toEqual({ created: 1, updated: 1, deleted: 1, rejected: 4 });
    expect(port.created).toBe(1);
    expect(port.updated).toBe(1);
    expect(port.deleted).toBe(1);
    expect(port.memories.get("user-memory")?.content).toBe("user memory");
    expect(port.memories.has("system-memory")).toBe(false);
  });

  it("rejects scoped mutations that no longer apply", async () => {
    const port = new FakePersonalMemoryPort();
    port.memories.set(
      "update-memory",
      memory("update-memory", "user-1", "system"),
    );
    port.memories.set(
      "delete-memory",
      memory("delete-memory", "user-1", "system"),
    );
    port.failUpdates = true;
    port.failDeletes = true;

    const counts = await new PersonalMemoryPolicy(port).applyExtractionOperations(
      "user-1",
      [
        { type: "update", id: "update-memory", content: "Updated content" },
        { type: "delete", id: "delete-memory", reason: "Contradicted" },
      ],
    );

    expect(counts).toEqual({ created: 0, updated: 0, deleted: 0, rejected: 2 });
  });
});
