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

export type PlannedMemoryOperation =
  | {
      readonly type: "create";
      readonly memoryId: string;
      readonly content: string;
      readonly eligible: boolean;
    }
  | {
      readonly type: "update";
      readonly memoryId: string;
      readonly content: string;
      readonly eligible: boolean;
    }
  | {
      readonly type: "delete";
      readonly memoryId: string;
      readonly eligible: boolean;
    };

export class PersonalMemoryPolicy {
  constructor(private readonly maxMemoriesPerUser = DEFAULT_MAX_MEMORIES_PER_USER) {}

  get memoryLimit(): number {
    return this.maxMemoriesPerUser;
  }

  planExtractionOperations(
    operations: readonly ProposedMemoryOperation[],
    createMemoryId: () => string = () => crypto.randomUUID(),
  ): PlannedMemoryOperation[] {
    return operations.map((operation) => {
      switch (operation.type) {
        case "create": {
          const createEligible = this.isSafeMemoryText(operation.content);
          return {
            type: "create",
            memoryId: createMemoryId(),
            content: createEligible ? operation.content : "",
            eligible: createEligible,
          };
        }
        case "update": {
          const updateEligible = this.isSafeMemoryText(operation.content);
          return {
            type: "update",
            memoryId: operation.id,
            content: updateEligible ? operation.content : "",
            eligible: updateEligible,
          };
        }
        case "delete":
          return {
            type: "delete",
            memoryId: operation.id,
            eligible: Boolean(operation.reason?.trim()),
          };
      }
    });
  }

  private isSafeMemoryText(content: string): boolean {
    return validateMemoryContent(content).safe;
  }
}
