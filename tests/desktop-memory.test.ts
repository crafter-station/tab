import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { createApp } from "../apps/api/src/index.ts";
import { createAuthInstance, migrateAuth } from "../apps/api/src/auth.ts";
import { DeviceTokenService, InMemoryDeviceTokenStorage } from "../apps/api/src/device-tokens.ts";
import { BillingService, InMemoryBillingStorage } from "../apps/api/src/billing.ts";
import { PersonalMemoryService, InMemoryPersonalMemoryStorage } from "../apps/api/src/personal-memory.ts";
import { InMemoryTelemetryStorage } from "../apps/api/src/telemetry.ts";
import { createDesktopMemoryClient } from "../apps/desktop/src/main/memory-client.ts";
import { createMemoryExtractionDispatcher } from "../apps/desktop/src/main/memory-extraction-dispatcher.ts";
import { createMemoryExtractionWindow } from "../apps/desktop/src/main/memory-extraction-window.ts";

const TEST_ORIGIN = "http://localhost:8787";
const textEncoder = new TextEncoder();

type ScheduledTimer = { readonly id: number; readonly delayMs: number; readonly callback: () => void };

function textByteLength(text: string): number {
  return textEncoder.encode(text).length;
}

function createManualScheduler() {
  let nextId = 1;
  const timers: ScheduledTimer[] = [];

  function findTimerIndex(delayMs?: number): number {
    return timers.findIndex((timer) => delayMs === undefined || timer.delayMs === delayMs);
  }

  function missingTimerMessage(delayMs?: number): string {
    if (delayMs === undefined) return "No timer scheduled";
    return `No timer scheduled for ${delayMs}ms`;
  }

  return {
    timers,
    setTimeout(callback: () => void, delayMs: number) {
      const id = nextId;
      nextId += 1;
      timers.push({ id, delayMs, callback });
      return id;
    },
    clearTimeout(id: number) {
      const index = timers.findIndex((timer) => timer.id === id);
      if (index >= 0) timers.splice(index, 1);
    },
    async run(delayMs?: number) {
      const index = findTimerIndex(delayMs);
      if (index < 0) throw new Error(missingTimerMessage(delayMs));
      const [timer] = timers.splice(index, 1);
      timer.callback();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

async function createApiFixture() {
  const database = new Database(":memory:");
  const auth = createAuthInstance({ database, baseURL: TEST_ORIGIN });
  await migrateAuth(auth);
  const deviceTokenService = new DeviceTokenService({ storage: new InMemoryDeviceTokenStorage() });
  const billingService = new BillingService({ storage: new InMemoryBillingStorage() });
  const personalMemoryStorage = new InMemoryPersonalMemoryStorage();
  const personalMemoryService = new PersonalMemoryService({ storage: personalMemoryStorage });
  const telemetryStorage = new InMemoryTelemetryStorage();
  const app = createApp({ auth, billingService, deviceTokenService, personalMemoryStorage, telemetryStorage });
  return { app, auth, billingService, deviceTokenService, personalMemoryService };
}

function makeFetch(app: ReturnType<typeof createApp>) {
  return async (input: string | URL | Request, init?: RequestInit) =>
    app.request(input, init) as unknown as Promise<Response>;
}

async function signUpAndAuthorize(
  app: ReturnType<typeof createApp>,
  deviceTokenService: DeviceTokenService,
  billingService: BillingService,
) {
  const email = `memory-${crypto.randomUUID()}@example.com`;
  const password = "password123456";

  await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: TEST_ORIGIN },
    body: JSON.stringify({ name: "Test User", email, password }),
  });

  const signInResponse = await app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: TEST_ORIGIN },
    body: JSON.stringify({ email, password, rememberMe: true }),
  });

  const cookie = signInResponse.headers.get("set-cookie");
  if (!cookie) throw new Error("Missing session cookie after sign in");

  const session = await app.request("/api/auth/get-session", {
    headers: { Cookie: cookie },
  });
  const sessionBody = (await session.json()) as { user?: { id?: string } } | null;
  const userId = sessionBody?.user?.id;
  if (!userId) throw new Error("Missing signed-in user id");
  await billingService.applyEntitlement({
    userId,
    planId: "free",
    polarCustomerId: "polar-customer-free",
    polarSubscriptionId: "polar-sub-free",
    status: "active",
    cachedAt: new Date(),
  });

  const authorizeResponse = await app.request("/api/auth/device/authorize", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
  });
  const { code } = (await authorizeResponse.json()) as { code: string };

  const exchangeResponse = await app.request("/api/auth/device/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, deviceId: "memory-device", platform: "darwin", appVersion: "0.0.1" }),
  });
  const { token } = (await exchangeResponse.json()) as { token: string };

  return { token, cookie };
}

describe("desktop memory client", () => {
  it("lists personal memories for the signed-in device", async () => {
    const { app, billingService, deviceTokenService, personalMemoryService } = await createApiFixture();
    const { token } = await signUpAndAuthorize(app, deviceTokenService, billingService);

    // Seed a memory through the service so we know the user id without exporting it.
    const statusResponse = await app.request("/api/status", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const userId = ((await statusResponse.json()) as { data: { userId?: string } }).data.userId ?? "unknown";

    await personalMemoryService.createMemory({
      userId,
      content: "I prefer concise emails",
      createdBy: "user",
    });

    const client = createDesktopMemoryClient({
      apiBaseUrl: TEST_ORIGIN,
      getAuthorizationHeader: async () => `Bearer ${token}`,
      fetch: makeFetch(app),
    });

    const memories = await client.listMemories();

    expect(memories).toHaveLength(1);
    expect(memories[0].content).toBe("I prefer concise emails");
  });

  it("deletes a personal memory", async () => {
    const { app, billingService, deviceTokenService, personalMemoryService } = await createApiFixture();
    const { token } = await signUpAndAuthorize(app, deviceTokenService, billingService);

    const statusResponse = await app.request("/api/status", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const userId = ((await statusResponse.json()) as { data: { userId?: string } }).data.userId ?? "unknown";

    const memory = await personalMemoryService.createMemory({
      userId,
      content: "My team uses Slack",
      createdBy: "user",
    });

    const client = createDesktopMemoryClient({
      apiBaseUrl: TEST_ORIGIN,
      getAuthorizationHeader: async () => `Bearer ${token}`,
      fetch: makeFetch(app),
    });

    const deleted = await client.deleteMemory(memory.id);

    expect(deleted).toBe(true);
    const remaining = await client.listMemories();
    expect(remaining).toHaveLength(0);
  });

  it("returns an empty list when the device is revoked", async () => {
    const { app, billingService, deviceTokenService } = await createApiFixture();
    const { token, cookie } = await signUpAndAuthorize(app, deviceTokenService, billingService);

    await app.request("/api/auth/device/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ deviceId: "memory-device" }),
    });

    const client = createDesktopMemoryClient({
      apiBaseUrl: TEST_ORIGIN,
      getAuthorizationHeader: async () => `Bearer ${token}`,
      fetch: makeFetch(app),
    });

    const memories = await client.listMemories();
    expect(memories).toEqual([]);
  });

  it("returns an empty list when not authenticated", async () => {
    const { app } = await createApiFixture();

    const client = createDesktopMemoryClient({
      apiBaseUrl: TEST_ORIGIN,
      getAuthorizationHeader: async () => null,
      fetch: makeFetch(app),
    });

    const memories = await client.listMemories();
    expect(memories).toEqual([]);
  });

  it("posts extraction batches and returns only operation counts", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = createDesktopMemoryClient({
      apiBaseUrl: TEST_ORIGIN,
      getAuthorizationHeader: async () => "Bearer device-token",
      fetch: async (input, init) => {
        requests.push({ url: String(input), init });
        return new Response(
          JSON.stringify({
            status: "ok",
            data: { counts: { created: 1, updated: 2, deleted: 0, rejected: 3 } },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    });

    const counts = await client.extractMemory({
      batchId: "batch-client",
      entries: [
        {
          id: "entry-client",
          text: "I prefer concise status updates",
          timestamp: "2026-07-08T12:00:00.000Z",
          contextSource: "typed_text",
          activeApplication: { bundleId: "com.example.editor" },
          redaction: { applied: false, redactionCount: 0, kinds: [] },
        },
      ],
    });

    expect(counts).toEqual({ created: 1, updated: 2, deleted: 0, rejected: 3 });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(`${TEST_ORIGIN}/api/memory/extract`);
    expect(requests[0].init?.method).toBe("POST");
    expect(requests[0].init?.headers).toMatchObject({
      Authorization: "Bearer device-token",
      Accept: "application/json",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(requests[0].init?.body))).toMatchObject({ batchId: "batch-client" });
  });
});

describe("desktop memory extraction window", () => {
  it("buffers only redacted eligible user-authored entries with minimal metadata", () => {
    let now = new Date("2026-07-08T10:00:00.000Z");
    let nextId = 1;
    const window = createMemoryExtractionWindow({
      memoryEnabled: () => true,
      now: () => now,
      createId: () => `entry-${nextId++}`,
    });

    expect(
      window.append({
        text: "My API key is api_key=1234567890abcdef and I prefer concise updates",
        source: "typed_text",
        activeApplication: { bundleId: "com.apple.TextEdit", name: "TextEdit", windowId: "ignored-window" },
      }),
    ).toBe(true);

    now = new Date("2026-07-08T10:00:01.000Z");
    expect(
      window.append({
        text: "npm test -- --watch",
        source: "terminal_input",
        activeApplication: { bundleId: "com.apple.Terminal", name: "Terminal" },
      }),
    ).toBe(true);

    expect(
      window.append({
        text: "Copied third-party document",
        source: "pasted_text",
        activeApplication: { bundleId: "com.apple.TextEdit" },
      }),
    ).toBe(false);
    expect(
      window.append({
        text: "server output line",
        source: "terminal_output",
        activeApplication: { bundleId: "com.apple.Terminal" },
      }),
    ).toBe(false);
    expect(
      window.append({
        text: "suggested completion",
        source: "suggestion_text",
        activeApplication: { bundleId: "com.apple.TextEdit" },
      }),
    ).toBe(false);
    expect(
      window.append({
        text: "accepted suggested completion",
        source: "accepted_suggestion_text",
        activeApplication: { bundleId: "com.apple.TextEdit" },
      }),
    ).toBe(false);

    const entries = window.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      id: "entry-1",
      timestamp: "2026-07-08T10:00:00.000Z",
      activeApplication: { bundleId: "com.apple.TextEdit" },
      contextSource: "typed_text",
      text: "My API key is api_key=[REDACTED_SECRET] and I prefer concise updates",
      redaction: { applied: true, redactionCount: 1, kinds: ["api_key"] },
    });
    expect(entries[0]).not.toHaveProperty("windowId");
    expect(entries[0]).not.toHaveProperty("activeApplicationName");
    expect(entries[1].contextSource).toBe("terminal_input");
  });

  it("enforces per-entry, total-size, and thirty-minute limits", () => {
    let currentTimeMs = Date.parse("2026-07-08T11:00:00.000Z");
    const window = createMemoryExtractionWindow({
      memoryEnabled: () => true,
      now: () => new Date(currentTimeMs),
    });

    expect(
      window.append({
        text: "normal typing ".repeat(120),
        source: "typed_text",
        activeApplication: { bundleId: "com.example.editor" },
      }),
    ).toBe(true);
    expect(textByteLength(window.getEntries()[0].text)).toBe(1_024);

    for (let i = 0; i < 8; i += 1) {
      currentTimeMs += 1_000;
      window.append({
        text: `entry ${i} `.repeat(160),
        source: "typed_text",
        activeApplication: { bundleId: "com.example.editor" },
      });
    }

    expect(window.getEntries().reduce((size, entry) => size + textByteLength(entry.text), 0)).toBeLessThanOrEqual(8_192);

    currentTimeMs += 31 * 60 * 1_000;
    window.append({
      text: "fresh fact after the rolling window expires",
      source: "typed_text",
      activeApplication: { bundleId: "com.example.editor" },
    });

    const entries = window.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toBe("fresh fact after the rolling window expires");
  });

  it("stops and clears local extraction buffering when memory is disabled", () => {
    let enabled = true;
    const window = createMemoryExtractionWindow({
      memoryEnabled: () => enabled,
      now: () => new Date("2026-07-08T12:00:00.000Z"),
    });

    window.append({
      text: "Remember that my team uses linear",
      source: "typed_text",
      activeApplication: { bundleId: "com.example.editor" },
    });

    enabled = false;
    expect(
      window.append({
        text: "Do not buffer while disabled",
        source: "typed_text",
        activeApplication: { bundleId: "com.example.editor" },
      }),
    ).toBe(false);

    expect(window.getEntries()).toEqual([]);
  });

  it("sends an eligible idle batch to the backend and clears only processed entries after success", async () => {
    let currentTimeMs = Date.parse("2026-07-08T13:00:00.000Z");
    let nextId = 1;
    const scheduler = createManualScheduler();
    const window = createMemoryExtractionWindow({
      memoryEnabled: true,
      now: () => new Date(currentTimeMs),
      createId: () => `entry-${nextId++}`,
    });
    const requests: unknown[] = [];
    const dispatcher = createMemoryExtractionDispatcher({
      window,
      client: {
        extractMemory: async (request) => {
          requests.push(request);
          return { created: 1, updated: 0, deleted: 0, rejected: 0 };
        },
      },
      now: () => new Date(currentTimeMs),
      setTimeout: scheduler.setTimeout,
      clearTimeout: scheduler.clearTimeout,
      createBatchId: () => "batch-success",
    });

    dispatcher.append({
      text: "I prefer concise launch planning updates. ".repeat(14),
      source: "typed_text",
      activeApplication: { bundleId: "com.example.editor", windowId: "ignored" },
    });
    dispatcher.append({
      text: "New entry typed while the first idle batch is pending",
      source: "typed_text",
      activeApplication: { bundleId: "com.example.editor" },
    });

    expect(requests).toHaveLength(0);
    expect(scheduler.timers.some((timer) => timer.delayMs === 60_000)).toBe(true);

    await scheduler.run(60_000);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      batchId: "batch-success",
      entries: [
        {
          id: "entry-1",
          activeApplication: { bundleId: "com.example.editor" },
          contextSource: "typed_text",
        },
        {
          id: "entry-2",
          activeApplication: { bundleId: "com.example.editor" },
          contextSource: "typed_text",
        },
      ],
    });
    expect(window.getEntries()).toEqual([]);
  });

  it("retries failed extraction batches and drops them after retry exhaustion", async () => {
    let currentTimeMs = Date.parse("2026-07-08T14:00:00.000Z");
    const scheduler = createManualScheduler();
    const window = createMemoryExtractionWindow({
      memoryEnabled: true,
      now: () => new Date(currentTimeMs),
      createId: () => "entry-retry",
    });
    let attempts = 0;
    const dispatcher = createMemoryExtractionDispatcher({
      window,
      client: {
        extractMemory: async () => {
          attempts += 1;
          throw new Error("backend unavailable");
        },
      },
      now: () => new Date(currentTimeMs),
      setTimeout: scheduler.setTimeout,
      clearTimeout: scheduler.clearTimeout,
      createBatchId: () => "batch-retry",
    });

    dispatcher.append({
      text: "remember this durable fact ".repeat(25),
      source: "typed_text",
      activeApplication: { bundleId: "com.example.editor" },
    });

    await scheduler.run(60_000);
    expect(attempts).toBe(1);
    expect(window.getEntries()).toHaveLength(1);
    expect(scheduler.timers.some((timer) => timer.delayMs === 1_000)).toBe(true);

    currentTimeMs += 1_000;
    await scheduler.run(1_000);
    expect(attempts).toBe(2);
    expect(window.getEntries()).toHaveLength(1);
    expect(scheduler.timers.some((timer) => timer.delayMs === 2_000)).toBe(true);

    currentTimeMs += 2_000;
    await scheduler.run(2_000);
    expect(attempts).toBe(3);
    expect(window.getEntries()).toEqual([]);
  });

  it("drops failed extraction batches after the failed-batch TTL expires", async () => {
    let currentTimeMs = Date.parse("2026-07-08T14:30:00.000Z");
    const scheduler = createManualScheduler();
    const window = createMemoryExtractionWindow({
      memoryEnabled: true,
      now: () => new Date(currentTimeMs),
      createId: () => "entry-ttl",
    });
    let attempts = 0;
    const dispatcher = createMemoryExtractionDispatcher({
      window,
      client: {
        extractMemory: async () => {
          attempts += 1;
          throw new Error("backend unavailable");
        },
      },
      now: () => new Date(currentTimeMs),
      setTimeout: scheduler.setTimeout,
      clearTimeout: scheduler.clearTimeout,
      createBatchId: () => "batch-ttl",
      maxRetries: 10,
      failedBatchTtlMs: 500,
    });

    dispatcher.append({
      text: "remember this temporary fact ".repeat(25),
      source: "typed_text",
      activeApplication: { bundleId: "com.example.editor" },
    });

    await scheduler.run(60_000);
    expect(attempts).toBe(1);
    expect(window.getEntries()).toHaveLength(1);

    currentTimeMs += 1_000;
    await scheduler.run(1_000);

    expect(attempts).toBe(2);
    expect(window.getEntries()).toEqual([]);
  });

  it("flushes a small batch when the thirty-minute extraction window limit is reached", async () => {
    let currentTimeMs = Date.parse("2026-07-08T15:00:00.000Z");
    const scheduler = createManualScheduler();
    const window = createMemoryExtractionWindow({
      memoryEnabled: true,
      now: () => new Date(currentTimeMs),
      createId: () => "entry-aged",
    });
    let sent = 0;
    const dispatcher = createMemoryExtractionDispatcher({
      window,
      client: {
        extractMemory: async () => {
          sent += 1;
          return { created: 0, updated: 0, deleted: 0, rejected: 0 };
        },
      },
      now: () => new Date(currentTimeMs),
      setTimeout: scheduler.setTimeout,
      clearTimeout: scheduler.clearTimeout,
      createBatchId: () => "batch-aged",
    });

    dispatcher.append({
      text: "small durable fact",
      source: "terminal_input",
      activeApplication: { bundleId: "com.apple.Terminal" },
    });

    expect(scheduler.timers.some((timer) => timer.delayMs === 30 * 60 * 1_000)).toBe(true);
    currentTimeMs += 30 * 60 * 1_000;
    await scheduler.run(30 * 60 * 1_000);

    expect(sent).toBe(1);
    expect(window.getEntries()).toEqual([]);
  });
});
