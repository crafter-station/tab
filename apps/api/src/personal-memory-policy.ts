import type { MemoryExtractionCounts, PersonalMemory } from "@tab/contracts";
import { validateMemoryContent } from "@tab/memory-policy";

const DEFAULT_MAX_MEMORIES_PER_USER = 500;

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

export type PersonalMemoryPolicyPort = {
  listMemories(userId: string): Promise<PersonalMemory[]>;
  findMemoryById(userId: string, id: string): Promise<PersonalMemory | null>;
  createMemory(input: {
    readonly userId: string;
    readonly content: string;
    readonly createdBy: "system";
  }, beforeMutation?: () => Promise<void>): Promise<PersonalMemory>;
  updateMemoryForExtraction(
    userId: string,
    id: string,
    input: { readonly content: string },
    beforeMutation?: () => Promise<void>,
  ): Promise<PersonalMemory | null>;
  deleteMemoryForExtraction(
    userId: string,
    id: string,
    beforeMutation?: () => Promise<void>,
  ): Promise<boolean>;
};

export function emptyExtractionCounts(): MemoryExtractionCounts {
  return { created: 0, updated: 0, deleted: 0, rejected: 0 };
}

export class PersonalMemoryPolicy {
  constructor(
    private readonly memory: PersonalMemoryPolicyPort,
    private readonly maxMemoriesPerUser = DEFAULT_MAX_MEMORIES_PER_USER,
  ) {}

  async applyExtractionOperations(
    userId: string,
    operations: readonly ProposedMemoryOperation[],
    beforeMutation?: () => Promise<void>,
  ): Promise<MemoryExtractionCounts> {
    const counts = emptyExtractionCounts();

    for (const operation of operations) {
      let applied = false;

      switch (operation.type) {
        case "create": {
          applied = await this.applyCreateOperation(
            userId,
            operation,
            beforeMutation,
          );
          if (applied) counts.created += 1;
          break;
        }

        case "update": {
          applied = await this.applyUpdateOperation(
            userId,
            operation,
            beforeMutation,
          );
          if (applied) counts.updated += 1;
          break;
        }

        case "delete": {
          applied = await this.applyDeleteOperation(
            userId,
            operation,
            beforeMutation,
          );
          if (applied) counts.deleted += 1;
          break;
        }
      }

      if (!applied) {
        counts.rejected += 1;
      }
    }

    return counts;
  }

  private async applyCreateOperation(
    userId: string,
    operation: ProposedCreateMemory,
    beforeMutation?: () => Promise<void>,
  ): Promise<boolean> {
    const currentCount = (await this.memory.listMemories(userId)).length;
    if (
      currentCount >= this.maxMemoriesPerUser ||
      !this.isSafeMemoryText(operation.content)
    ) {
      return false;
    }

    await beforeMutation?.();
    await this.memory.createMemory(
      {
        userId,
        content: operation.content,
        createdBy: "system",
      },
      beforeMutation,
    );
    return true;
  }

  private async applyUpdateOperation(
    userId: string,
    operation: ProposedUpdateMemory,
    beforeMutation?: () => Promise<void>,
  ): Promise<boolean> {
    const existing = await this.findMutableSystemMemory(userId, operation.id);
    if (!existing || !this.isSafeMemoryText(operation.content)) {
      return false;
    }

    await beforeMutation?.();
    const updated = await this.memory.updateMemoryForExtraction(
      userId,
      operation.id,
      { content: operation.content },
      beforeMutation,
    );
    return updated !== null;
  }

  private async applyDeleteOperation(
    userId: string,
    operation: ProposedDeleteMemory,
    beforeMutation?: () => Promise<void>,
  ): Promise<boolean> {
    const existing = await this.findMutableSystemMemory(userId, operation.id);
    if (!existing || !operation.reason?.trim()) {
      return false;
    }

    await beforeMutation?.();
    return this.memory.deleteMemoryForExtraction(
      userId,
      operation.id,
      beforeMutation,
    );
  }

  private async findMutableSystemMemory(
    userId: string,
    memoryId: string,
  ): Promise<PersonalMemory | null> {
    const memory = await this.memory.findMemoryById(userId, memoryId);
    if (!memory || memory.createdBy !== "system") {
      return null;
    }
    return memory;
  }

  private isSafeMemoryText(content: string): boolean {
    return validateMemoryContent(content).safe;
  }
}
