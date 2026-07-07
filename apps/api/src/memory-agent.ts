import {
  MemoryJobSchema,
  type MemoryJob,
  type PersonalMemory,
  type PersonalMemorySource,
  type PersonalMemorySensitivity,
} from "@tabb/contracts";
import { generateText, Output } from "ai";
import { validateMemoryContent } from "@tabb/memory-policy";
import type { PersonalMemoryService } from "./personal-memory.ts";
import { z } from "zod";

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

const MEMORY_EXTRACTION_MODEL_ID = "openai/gpt-5.5";

const MemoryOperationOutputSchema = z.object({
  operations: z.array(
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("create"),
        content: z.string().min(1),
        category: z.string().min(1),
        source: z.enum(["typed_text", "terminal_input"]),
        sensitivity: z.enum(["normal", "sensitive", "private"]),
      }),
      z.object({
        type: z.literal("update"),
        id: z.string().min(1),
        content: z.string().min(1),
        category: z.string().min(1),
        source: z.enum(["typed_text", "terminal_input"]),
        sensitivity: z.enum(["normal", "sensitive", "private"]),
      }),
      z.object({
        type: z.literal("archive"),
        id: z.string().min(1),
      }),
    ]),
  ),
});

function isEligibleMemorySource(
  source: PersonalMemorySource,
): source is "typed_text" | "terminal_input" {
  return (ELIGIBLE_MEMORY_SOURCES as readonly string[]).includes(source);
}

function isSafeMemoryText(content: string, category: string): boolean {
  return (
    validateMemoryContent(content).safe && validateMemoryContent(category).safe
  );
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

class AiGatewayMemoryAgentModel implements MemoryAgentModel {
  async proposeOperations(
    job: MemoryJob,
    memories: readonly PersonalMemory[],
  ): Promise<readonly ProposedMemoryOperation[]> {
    if (!process.env.AI_GATEWAY_API_KEY) {
      throw new Error("AI_GATEWAY_API_KEY is not configured");
    }

    const { output } = await generateText({
      model: MEMORY_EXTRACTION_MODEL_ID,
      output: Output.object({ schema: MemoryOperationOutputSchema }),
      system:
        "Extract durable personal memory from first-party user typing. Return only operations that are useful for future autocomplete. Do not store secrets, credentials, payment data, medical data, or third-party pasted content. Prefer no operation over speculative memory.",
      prompt: `Active application: ${job.activeApplication.bundleId}
Source: ${job.contextSource}
Redaction applied: ${job.redaction.applied}
Redaction count: ${job.redaction.redactionCount}

Existing memories:
${formatMemoriesForPrompt(memories)}

Recent user typing:
"""${job.typingContext}"""

Create a memory for stable preferences, projects, recurring facts, names, or work context. Update an existing memory only when the new text clearly refines it. Archive only when the text clearly contradicts an existing memory. Use category values like app bundle IDs, project names, or short topics.`,
      maxOutputTokens: 1200,
      temperature: 0,
    });

    return output.operations;
  }
}

function formatMemoriesForPrompt(memories: readonly PersonalMemory[]): string {
  if (memories.length === 0) return "None";

  return memories
    .map(
      (memory) =>
        `- id=${memory.id}; category=${memory.category}; sensitivity=${memory.sensitivity}; content=${memory.content}`,
    )
    .join("\n");
}

export class BackgroundMemoryAgent {
  private readonly personalMemoryService: PersonalMemoryService;
  private readonly model: MemoryAgentModel;

  constructor(deps: BackgroundMemoryAgentDependencies) {
    this.personalMemoryService = deps.personalMemoryService;
    this.model = deps.model ?? new NoOpMemoryAgentModel();
  }

  static createRealModel(): MemoryAgentModel {
    return new AiGatewayMemoryAgentModel();
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

        if (!isSafeMemoryText(operation.content, operation.category)) {
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
        const existing = await this.findMemoryForUser(userId, operation.id);
        if (!existing) {
          return;
        }

        if (!isEligibleMemorySource(operation.source)) {
          return;
        }

        if (!isSafeMemoryText(operation.content, operation.category)) {
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
        const existing = await this.findMemoryForUser(userId, operation.id);
        if (!existing) {
          return;
        }

        await this.personalMemoryService.archiveMemory(operation.id);
        return;
      }
    }
  }

  private async findMemoryForUser(
    userId: string,
    memoryId: string,
  ): Promise<PersonalMemory | null> {
    const memory = await this.personalMemoryService.findMemoryById(memoryId);

    if (!memory || memory.userId !== userId) {
      return null;
    }

    return memory;
  }
}
