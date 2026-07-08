import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { createApp } from "../apps/api/src/index.ts";
import { createAuthInstance, migrateAuth } from "../apps/api/src/auth.ts";
import {
  DeviceTokenService,
  InMemoryDeviceTokenStorage,
} from "../apps/api/src/device-tokens.ts";
import {
  InMemoryPersonalMemoryStorage,
  PersonalMemoryService,
} from "../apps/api/src/personal-memory.ts";
import {
  BackgroundMemoryAgent,
  InMemoryMemoryJobQueue,
  type MemoryJob,
  type MemoryAgentModel,
  type ProposedMemoryOperation,
} from "../apps/api/src/memory-agent.ts";
import { BillingService, InMemoryBillingStorage } from "../apps/api/src/billing.ts";
import { InMemoryTelemetryStorage } from "../apps/api/src/telemetry.ts";
import type { SuggestionGenerator } from "../apps/api/src/index.ts";

async function createMemoryAgentTestApp(
  generateSuggestion: SuggestionGenerator,
  model?: MemoryAgentModel,
) {
  const database = new Database(":memory:");
  const auth = createAuthInstance({ database });
  await migrateAuth(auth);
  const deviceTokenStorage = new InMemoryDeviceTokenStorage();
  const deviceTokenService = new DeviceTokenService({ storage: deviceTokenStorage });
  const billingStorage = new InMemoryBillingStorage();
  const billingService = new BillingService({ storage: billingStorage });
  const personalMemoryStorage = new InMemoryPersonalMemoryStorage();
  const personalMemoryService = new PersonalMemoryService({
    storage: personalMemoryStorage,
  });
  const memoryJobQueue = new InMemoryMemoryJobQueue();
  const memoryAgent = new BackgroundMemoryAgent({
    personalMemoryService,
    model,
  });
  await memoryJobQueue.subscribe(async (job) => memoryAgent.processJob(job));

  const app = createApp({
    generateSuggestion,
    auth,
    billingService,
    deviceTokenService,
    personalMemoryStorage,
    memoryJobQueue,
    memoryAgent,
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

  return {
    app,
    token,
    memoryJobQueue,
    personalMemoryStorage,
    personalMemoryService,
    memoryAgent,
  };
}

function authHeaders(token: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

const baseSuggestionRequest = {
  requestId: "req-memory-agent",
  deviceId: "device-1",
  typingContext: "Working on the Tab launch plan",
  contextSource: "typed_text" as const,
  redaction: { applied: false, redactionCount: 0, kinds: [] as string[] },
  activeApplication: { bundleId: "com.apple.TextEdit" },
  memoryEnabled: true,
  contextHash: "com.apple.TextEdit:Working on the Tab launch plan:false",
  clientMetadata: { appVersion: "0.0.1", platform: "darwin" },
};

function captureJobPromise(queue: InMemoryMemoryJobQueue): Promise<MemoryJob> {
  return new Promise((resolve) => {
    const originalEnqueue = queue.enqueue.bind(queue);
    queue.enqueue = async (job: MemoryJob) => {
      queue.enqueue = originalEnqueue;
      resolve(job);
      return originalEnqueue(job);
    };
  });
}

const returningGenerator: SuggestionGenerator = async () => ({ text: " today" });
const emptyGenerator: SuggestionGenerator = async () => null;

describe("Background Memory Agent", () => {
  it("enqueues a memory job for typed_text context", async () => {
    const { app, token, memoryJobQueue } = await createMemoryAgentTestApp(
      returningGenerator,
    );

    const jobPromise = captureJobPromise(memoryJobQueue);

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(baseSuggestionRequest),
    });

    expect(response.status).toBe(200);
    const job = await jobPromise;
    expect(job.userId).toBe("user-1");
    expect(job.contextSource).toBe("typed_text");
    expect(job.typingContext).toBe("Working on the Tab launch plan");
    expect(job.memoryEligible).toBe(true);
  });

  it("does not enqueue a memory job for pasted_text context", async () => {
    const { app, token, memoryJobQueue } = await createMemoryAgentTestApp(
      returningGenerator,
    );

    let enqueued = false;
    const originalEnqueue = memoryJobQueue.enqueue.bind(memoryJobQueue);
    memoryJobQueue.enqueue = async (job: MemoryJob) => {
      enqueued = true;
      return originalEnqueue(job);
    };

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        ...baseSuggestionRequest,
        requestId: "req-pasted",
        contextSource: "pasted_text",
        typingContext: "Some pasted third-party text",
      }),
    });

    expect(response.status).toBe(200);
    expect(enqueued).toBe(false);
  });

  it("enqueues a memory job for terminal_input context", async () => {
    const { app, token, memoryJobQueue } = await createMemoryAgentTestApp(
      returningGenerator,
    );

    const jobPromise = captureJobPromise(memoryJobQueue);

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        ...baseSuggestionRequest,
        requestId: "req-terminal",
        contextSource: "terminal_input",
        typingContext: "git commit -m \"Launch Tab\"",
      }),
    });

    expect(response.status).toBe(200);
    const job = await jobPromise;
    expect(job.contextSource).toBe("terminal_input");
    expect(job.memoryEligible).toBe(true);
  });

  it("does not enqueue a memory job when memoryEnabled is false", async () => {
    const { app, token, memoryJobQueue } = await createMemoryAgentTestApp(
      returningGenerator,
    );

    let enqueued = false;
    const originalEnqueue = memoryJobQueue.enqueue.bind(memoryJobQueue);
    memoryJobQueue.enqueue = async (job: MemoryJob) => {
      enqueued = true;
      return originalEnqueue(job);
    };

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        ...baseSuggestionRequest,
        requestId: "req-memory-disabled",
        memoryEnabled: false,
      }),
    });

    expect(response.status).toBe(200);
    expect(enqueued).toBe(false);
  });

  it("enqueues a memory job even when no suggestion is returned", async () => {
    const { app, token, memoryJobQueue } = await createMemoryAgentTestApp(
      emptyGenerator,
    );

    const jobPromise = captureJobPromise(memoryJobQueue);

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(baseSuggestionRequest),
    });

    expect(response.status).toBe(200);
    const job = await jobPromise;
    expect(job.memoryEligible).toBe(true);
  });

  it("creates a memory when the model proposes a safe operation", async () => {
    const safeModel: MemoryAgentModel = {
      async proposeOperations() {
        return [
          {
            type: "create",
            content: "Working on Tab launch plan",
          },
        ];
      },
    };

    const { app, token, memoryJobQueue, personalMemoryService } =
      await createMemoryAgentTestApp(returningGenerator, safeModel);

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(baseSuggestionRequest),
    });

    expect(response.status).toBe(200);
    await memoryJobQueue.drain();

    const memories = await personalMemoryService.listMemories("user-1");
    expect(memories).toHaveLength(1);
    expect(memories[0].content).toBe("Working on Tab launch plan");
    expect(memories[0].createdBy).toBe("system");
  });

  it("rejects a create operation that contains a secret", async () => {
    const unsafeModel: MemoryAgentModel = {
      async proposeOperations() {
        return [
          {
            type: "create",
            content: "Stripe API key is sk_live_1234567890abcdef",
          },
        ];
      },
    };

    const { app, token, memoryJobQueue, personalMemoryService } =
      await createMemoryAgentTestApp(returningGenerator, unsafeModel);

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(baseSuggestionRequest),
    });

    expect(response.status).toBe(200);
    await memoryJobQueue.drain();

    const memories = await personalMemoryService.listMemories("user-1");
    expect(memories).toHaveLength(0);
  });

  it("rejects an update operation that contains a bearer token", async () => {
    const unsafeModel: MemoryAgentModel = {
      async proposeOperations(_job, memories) {
        const memory = memories[0];
        return [
          {
            type: "update",
            id: memory.id,
            content: "Auth header Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
          },
        ];
      },
    };

    const { app, token, memoryJobQueue, personalMemoryService } =
      await createMemoryAgentTestApp(returningGenerator, unsafeModel);

    const existingMemory = await personalMemoryService.createMemory({
      userId: "user-1",
      content: "Old work note",
      createdBy: "system",
    });

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(baseSuggestionRequest),
    });

    expect(response.status).toBe(200);
    await memoryJobQueue.drain();

    const memories = await personalMemoryService.listMemories("user-1");
    const updated = memories.find((m) => m.id === existingMemory.id);
    expect(updated?.content).not.toContain("Bearer ");
    expect(updated?.content).toBe("Old work note");
  });

  it("rejects a create operation with a private key block", async () => {
    const unsafeModel: MemoryAgentModel = {
      async proposeOperations() {
        return [
          {
            type: "create",
            content: "-----BEGIN OPENSSH PRIVATE KEY-----\nabc123\n-----END OPENSSH PRIVATE KEY-----",
          },
        ];
      },
    };

    const { app, token, memoryJobQueue, personalMemoryService } =
      await createMemoryAgentTestApp(returningGenerator, unsafeModel);

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(baseSuggestionRequest),
    });

    expect(response.status).toBe(200);
    await memoryJobQueue.drain();

    const memories = await personalMemoryService.listMemories("user-1");
    expect(memories).toHaveLength(0);
  });

  it("rejects a create operation with a database URL", async () => {
    const unsafeModel: MemoryAgentModel = {
      async proposeOperations() {
        return [
          {
            type: "create",
            content: "DATABASE_URL=postgres://user:secret@localhost:5432/db",
          },
        ];
      },
    };

    const { app, token, memoryJobQueue, personalMemoryService } =
      await createMemoryAgentTestApp(returningGenerator, unsafeModel);

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(baseSuggestionRequest),
    });

    expect(response.status).toBe(200);
    await memoryJobQueue.drain();

    const memories = await personalMemoryService.listMemories("user-1");
    expect(memories).toHaveLength(0);
  });

  it("rejects a create operation with a high-entropy secret string", async () => {
    const unsafeModel: MemoryAgentModel = {
      async proposeOperations() {
        return [
          {
            type: "create",
            content: "Production secret dGhpcyBpcyBhIHNlY3JldA==",
          },
        ];
      },
    };

    const { app, token, memoryJobQueue, personalMemoryService } =
      await createMemoryAgentTestApp(returningGenerator, unsafeModel);

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(baseSuggestionRequest),
    });

    expect(response.status).toBe(200);
    await memoryJobQueue.drain();

    const memories = await personalMemoryService.listMemories("user-1");
    expect(memories).toHaveLength(0);
  });

  it("rejects a create operation with a government identifier", async () => {
    const unsafeModel: MemoryAgentModel = {
      async proposeOperations() {
        return [
          {
            type: "create",
            content: "My SSN is 123-45-6789",
          },
        ];
      },
    };

    const { app, token, memoryJobQueue, personalMemoryService } =
      await createMemoryAgentTestApp(returningGenerator, unsafeModel);

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(baseSuggestionRequest),
    });

    expect(response.status).toBe(200);
    await memoryJobQueue.drain();

    const memories = await personalMemoryService.listMemories("user-1");
    expect(memories).toHaveLength(0);
  });

  it("rejects a create operation with payment card data", async () => {
    const unsafeModel: MemoryAgentModel = {
      async proposeOperations() {
        return [
          {
            type: "create",
            content: "Card number 4111 1111 1111 1111 expires 12/25",
          },
        ];
      },
    };

    const { app, token, memoryJobQueue, personalMemoryService } =
      await createMemoryAgentTestApp(returningGenerator, unsafeModel);

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(baseSuggestionRequest),
    });

    expect(response.status).toBe(200);
    await memoryJobQueue.drain();

    const memories = await personalMemoryService.listMemories("user-1");
    expect(memories).toHaveLength(0);
  });

  it("rejects a create operation containing an auth cookie", async () => {
    const unsafeModel: MemoryAgentModel = {
      async proposeOperations() {
        return [
          {
            type: "create",
            content: "session_cookie=eyJ1c2VyX2lkIjoiMTIzIn0=; Path=/; HttpOnly",
          },
        ];
      },
    };

    const { app, token, memoryJobQueue, personalMemoryService } =
      await createMemoryAgentTestApp(returningGenerator, unsafeModel);

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(baseSuggestionRequest),
    });

    expect(response.status).toBe(200);
    await memoryJobQueue.drain();

    const memories = await personalMemoryService.listMemories("user-1");
    expect(memories).toHaveLength(0);
  });

  it("allows a delete operation for an existing memory", async () => {
    const { app, token, memoryJobQueue, personalMemoryService } =
      await createMemoryAgentTestApp(returningGenerator, {
        async proposeOperations(_job, memories) {
          return memories.map(
            (memory): ProposedMemoryOperation => ({
              type: "delete",
              id: memory.id,
            }),
          );
        },
      });

    const memory = await personalMemoryService.createMemory({
      userId: "user-1",
      content: "Outdated note",
      createdBy: "system",
    });

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(baseSuggestionRequest),
    });

    expect(response.status).toBe(200);
    await memoryJobQueue.drain();

    const deleted = await personalMemoryService.findMemoryById(memory.id);
    expect(deleted).toBeNull();
  });

  it("does not store the raw typing context or accepted suggestion text", async () => {
    const { app, token, memoryJobQueue } = await createMemoryAgentTestApp(
      returningGenerator,
    );

    const jobPromise = captureJobPromise(memoryJobQueue);

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(baseSuggestionRequest),
    });

    expect(response.status).toBe(200);
    const job = await jobPromise;
    expect(job.typingContext).toBeDefined();
    // The job carries only the snippet needed for extraction; it must not
    // include the suggestion text that was returned to the client.
    expect(job.suggestionText).toBeUndefined();
  });
});
