import {
  MemoryJobSchema,
  type MemoryJob,
  type PersonalMemory,
  type PersonalMemorySource,
  type PersonalMemorySensitivity,
} from "@tabb/contracts";
import { validateMemoryContent } from "@tabb/memory-policy";
import type { PersonalMemoryService } from "./personal-memory.ts";

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
  readonly category: string;
  readonly source: PersonalMemorySource;
  readonly sensitivity: PersonalMemorySensitivity;
};

export type ProposedUpdateMemory = {
  readonly type: "update";
  readonly id: string;
  readonly content: string;
  readonly category: string;
  readonly source: PersonalMemorySource;
  readonly sensitivity: PersonalMemorySensitivity;
};

export type ProposedArchiveMemory = {
  readonly type: "archive";
  readonly id: string;
};

export type ProposedMemoryOperation =
  | ProposedCreateMemory
  | ProposedUpdateMemory
  | ProposedArchiveMemory;

const ELIGIBLE_MEMORY_SOURCES: readonly PersonalMemorySource[] = [
  "typed_text",
  "terminal_input",
];

function isEligibleMemorySource(
  source: PersonalMemorySource,
): source is "typed_text" | "terminal_input" {
  return (ELIGIBLE_MEMORY_SOURCES as readonly string[]).includes(source);
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

class NoOpMemoryAgentModel implements MemoryAgentModel {
  async proposeOperations(): Promise<readonly ProposedMemoryOperation[]> {
    return [];
  }
}

export class BackgroundMemoryAgent {
  private readonly personalMemoryService: PersonalMemoryService;
  private readonly model: MemoryAgentModel;

  constructor(deps: BackgroundMemoryAgentDependencies) {
    this.personalMemoryService = deps.personalMemoryService;
    this.model = deps.model ?? new NoOpMemoryAgentModel();
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
        if (!isEligibleMemorySource(operation.source)) {
          return;
        }

        const contentValidation = validateMemoryContent(operation.content);
        if (!contentValidation.safe) {
          return;
        }

        const categoryValidation = validateMemoryContent(operation.category);
        if (!categoryValidation.safe) {
          return;
        }

        await this.personalMemoryService.createMemory({
          userId,
          content: operation.content,
          category: operation.category,
          source: operation.source,
          sensitivity: operation.sensitivity,
        });
        return;
      }

      case "update": {
        const existing = await this.personalMemoryService.findMemoryById(
          operation.id,
        );
        if (!existing || existing.userId !== userId) {
          return;
        }

        if (!isEligibleMemorySource(operation.source)) {
          return;
        }

        const contentValidation = validateMemoryContent(operation.content);
        if (!contentValidation.safe) {
          return;
        }

        const categoryValidation = validateMemoryContent(operation.category);
        if (!categoryValidation.safe) {
          return;
        }

        await this.personalMemoryService.updateMemory(operation.id, {
          content: operation.content,
          category: operation.category,
          source: operation.source,
          sensitivity: operation.sensitivity,
        });
        return;
      }

      case "archive": {
        const existing = await this.personalMemoryService.findMemoryById(
          operation.id,
        );
        if (!existing || existing.userId !== userId) {
          return;
        }

        await this.personalMemoryService.archiveMemory(operation.id);
        return;
      }
    }
  }
}
