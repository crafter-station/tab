import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { createApp } from "../apps/api/src/index.ts";
import { createAuthInstance, migrateAuth } from "../apps/api/src/auth.ts";
import { DeviceTokenService, InMemoryDeviceTokenStorage } from "../apps/api/src/device-tokens.ts";
import {
  TelemetryService,
  InMemoryTelemetryStorage,
} from "../apps/api/src/telemetry.ts";
import { BillingService, InMemoryBillingStorage } from "../apps/api/src/billing.ts";
import { InMemoryPersonalMemoryStorage } from "../apps/api/src/personal-memory.ts";
import type { SuggestionGenerator } from "../apps/api/src/index.ts";
import type { MemoryAgentModel } from "../apps/api/src/personal-memory-extraction.ts";

async function createAuthenticatedTestApp(
  generateSuggestion: SuggestionGenerator,
  memoryExtractionModel?: MemoryAgentModel,
) {
  const database = new Database(":memory:");
  const auth = createAuthInstance({ database });
  await migrateAuth(auth);
  const deviceTokenStorage = new InMemoryDeviceTokenStorage();
  const deviceTokenService = new DeviceTokenService({ storage: deviceTokenStorage });
  const billingStorage = new InMemoryBillingStorage();
  const billingService = new BillingService({ storage: billingStorage });
  const telemetryService = new TelemetryService({
    storage: new InMemoryTelemetryStorage(),
  });
  const app = createApp({
    generateSuggestion,
    auth,
    billingService,
    deviceTokenService,
    telemetryService,
    personalMemoryStorage: new InMemoryPersonalMemoryStorage(),
    memoryExtractionModel,
  });
  const { token } = await deviceTokenService.createDeviceToken("user-1", {
    deviceId: "device-1",
    platform: "darwin",
    appVersion: "0.0.1",
  });
  await billingService.applyEntitlement({
    userId: "user-1",
    planId: "pro",
    polarCustomerId: "polar-customer-pro",
    polarSubscriptionId: "polar-sub-pro",
    status: "active",
    cachedAt: new Date(),
  });
  return { app, token, telemetryService, billingService };
}

function authHeaders(token: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

function buildRequest(typingContext: string) {
  return {
    requestId: `req-${crypto.randomUUID()}`,
    deviceId: "device-1",
    mode: "deep_complete",
    typingContext,
    contextSource: "typed_text" as const,
    redaction: { applied: false, redactionCount: 0, kinds: [] as string[] },
    activeApplication: { bundleId: "com.apple.TextEdit" },
    memoryEnabled: true,
    contextHash: `com.apple.TextEdit:${typingContext}:false`,
    clientMetadata: { appVersion: "0.0.1", platform: "darwin" },
  };
}

function buildExtractionRequest(batchId: string, rawText: string) {
  return {
    batchId,
    entries: [
      {
        id: `${batchId}-entry-1`,
        text: rawText,
        timestamp: new Date().toISOString(),
        activeApplication: { bundleId: "com.apple.TextEdit" },
        contextSource: "typed_text" as const,
        redaction: { applied: false, redactionCount: 0, kinds: [] as string[] },
      },
    ],
    clientMetadata: { appVersion: "0.0.1", platform: "darwin" },
  };
}

function assertNoRawText(events: readonly Record<string, unknown>[], rawContext: string) {
  const json = JSON.stringify(events);
  expect(json).not.toContain(rawContext);
  expect(json).not.toContain("rawTypingContext");
  expect(json).not.toContain("suggestionText");
  expect(json).not.toContain("acceptedText");
  expect(json).not.toContain("finalInsertedText");
  expect(json).not.toContain("surroundingText");

  const allowedKeys = new Set([
    "id",
    "requestId",
    "userId",
    "deviceId",
    "eventType",
    "timestamp",
    "activeApplicationBundleId",
    "contextSource",
    "suggestionLength",
    "planId",
    "modelId",
    "latencyMs",
    "errorCode",
    "memoryEligible",
    "redactionApplied",
    "redactionCount",
    "clientAppVersion",
    "clientPlatform",
    "memoryCreatedCount",
    "memoryUpdatedCount",
    "memoryDeletedCount",
    "memoryRejectedCount",
    "inferenceSource",
    "trigger",
    "acceptedWordCount",
    "acceptedCharacterCount",
    "applicationCategory",
    "memoryUsed",
    "memoryCount",
    "providerId",
    "cloudCostUsdMicros",
  ]);

  for (const event of events) {
    for (const key of Object.keys(event)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
  }
}

describe("Metadata-only suggestion telemetry", () => {
  it("records shown metadata for a successful suggestion without raw text", async () => {
    const rawContext = "Hello telemetry-success-raw-context";
    const suggestionText = " world";
    const { app, token, telemetryService } = await createAuthenticatedTestApp(
      async () => ({ text: suggestionText, modelId: "gpt-4o-mini" }),
    );

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(buildRequest(rawContext)),
    });

    expect(response.status).toBe(200);
    const events = await telemetryService.listEvents();
    const shown = events.find((e) => e.eventType === "suggestion_shown");
    expect(shown).toBeDefined();
    expect(shown?.activeApplicationBundleId).toBeUndefined();
    expect(shown?.suggestionLength).toBe(suggestionText.length);
    expect(shown?.planId).toBe("pro");
    expect(shown?.inferenceSource).toBe("deep_complete");
    expect(shown?.trigger).toBe("explicit");
    expect(shown?.modelId).toBe("gpt-4o-mini");
    expect(typeof shown?.latencyMs).toBe("number");
    expect((shown?.latencyMs ?? -1)).toBeGreaterThanOrEqual(0);
    expect(() => new Date(shown!.timestamp)).not.toThrow();
    assertNoRawText(events, rawContext);
    assertNoRawText(events, suggestionText);
  });

  it("records generated metadata without shown metadata for an empty suggestion", async () => {
    const rawContext = "Hello telemetry-empty-raw-context";
    const { app, token, telemetryService } = await createAuthenticatedTestApp(
      async () => ({ text: "", modelId: "gpt-4o-mini" }),
    );

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(buildRequest(rawContext)),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { suggestions: unknown[] } };
    expect(body.data.suggestions).toHaveLength(0);
    const events = await telemetryService.listEvents();
    const generated = events.find(
      (event) => event.eventType === "suggestion_generated",
    );
    expect(generated).toBeDefined();
    expect(generated?.suggestionLength).toBe(0);
    expect(generated?.modelId).toBe("gpt-4o-mini");
    expect(events.some((event) => event.eventType === "suggestion_shown")).toBe(
      false,
    );
    assertNoRawText(events, rawContext);
  });

  it("records error metadata when suggestion generation fails", async () => {
    const rawContext = "Hello telemetry-error-raw-context";
    const { app, token, telemetryService } = await createAuthenticatedTestApp(
      async () => {
        throw new Error("model timeout");
      },
    );

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(buildRequest(rawContext)),
    });

    expect(response.status).toBe(503);
    const events = await telemetryService.listEvents();
    const errorEvent = events.find((e) => e.eventType === "suggestion_error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.errorCode).toBe("provider_failure");
    expect(errorEvent?.activeApplicationBundleId).toBeUndefined();
    expect(typeof errorEvent?.latencyMs).toBe("number");
    assertNoRawText(events, rawContext);
  });

  it("does not record memory job telemetry from suggestions", async () => {
    const rawContext = "Hello telemetry-no-memory-job-raw-context";
    const { app, token, telemetryService } = await createAuthenticatedTestApp(
      async () => ({ text: " world" }),
    );

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(buildRequest(rawContext)),
    });

    expect(response.status).toBe(200);
    const events = await telemetryService.listEvents();
    const memoryEvent = events.find((e) => e.eventType === "memory_job_enqueued");
    expect(memoryEvent).toBeUndefined();
    assertNoRawText(events, rawContext);
  });

  it("records accepted, dismissed, and stale client events without raw text", async () => {
    const { app, token, telemetryService } = await createAuthenticatedTestApp(
      async () => ({ text: " world" }),
    );

    for (const eventType of [
      "suggestion_accepted",
      "suggestion_dismissed",
      "suggestion_stale",
    ] as const) {
      const response = await app.request("/telemetry/events", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          eventType,
          eventId: crypto.randomUUID(),
          requestId: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          inferenceSource: "local",
          trigger: "automatic",
          applicationCategory: "communication",
          suggestionLength: 5,
          latencyMs: 12,
          ...(eventType === "suggestion_accepted"
            ? {
                modelId: "qwen2.5-3b-instruct-q4_k_m",
                acceptedWordCount: 2,
                acceptedCharacterCount: 11,
              }
            : {}),
        }),
      });

      expect(response.status).toBe(200);
    }

    const events = await telemetryService.listEvents();
    expect(events.some((e) => e.eventType === "suggestion_accepted")).toBe(true);
    expect(events.some((e) => e.eventType === "suggestion_dismissed")).toBe(true);
    expect(events.some((e) => e.eventType === "suggestion_stale")).toBe(true);
    expect(events.every((e) => e.latencyMs === 12)).toBe(true);
    expect(await telemetryService.getLocalSuggestionActivity("user-1")).toEqual({
      acceptedSuggestions: 1,
      acceptedWords: 2,
      acceptedCharacters: 11,
      activeWritingDays: 1,
      averageAcceptanceLatencyMs: 12,
    });
    assertNoRawText(events, "accepted suggestion text");
  });

  it("records client suggestion failure error codes", async () => {
    const { app, token, telemetryService } = await createAuthenticatedTestApp(
      async () => ({ text: " world" }),
    );

    const response = await app.request("/telemetry/events", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        eventType: "suggestion_error",
        eventId: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        inferenceSource: "local",
        trigger: "automatic",
        errorCode: "provider_failure",
      }),
    });

    expect(response.status).toBe(200);
    expect(await telemetryService.listEvents()).toEqual([
      expect.objectContaining({
        eventType: "suggestion_error",
        errorCode: "provider_failure",
      }),
    ]);
  });

  it("rejects client telemetry payloads that include raw suggestion text", async () => {
    const { app, token } = await createAuthenticatedTestApp(
      async () => ({ text: " world" }),
    );

    const response = await app.request("/telemetry/events", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        eventType: "suggestion_accepted",
        eventId: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        inferenceSource: "local",
        trigger: "automatic",
        applicationCategory: "communication",
        suggestionLength: 5,
        rawSuggestionText: "super secret suggestion",
      }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { status: string; error: { code: string } };
    expect(body.status).toBe("error");
    expect(body.error.code).toBe("invalid_request");
  });
});

describe("Metadata-only memory extraction telemetry", () => {
  it("denies only continuous extraction on Free", async () => {
    const { app, token, billingService } = await createAuthenticatedTestApp(
      async () => ({ text: " world" }),
    );
    await billingService.applyEntitlement({
      userId: "user-1",
      planId: "free",
      status: "inactive",
      cachedAt: new Date(),
    });

    const extraction = await app.request("/api/memory/extract", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(buildExtractionRequest("free-batch", "Eligible writing")),
    });
    expect(extraction.status).toBe(403);
    expect((await extraction.json()).error.details.capability).toBe(
      "memory_extraction",
    );

    const create = await app.request("/api/memory", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ content: "A memory I control" }),
    });
    expect(create.status).toBe(200);
    const exportResponse = await app.request("/api/memory/export", {
      headers: authHeaders(token),
    });
    expect(exportResponse.status).toBe(200);
    expect((await exportResponse.json()).data.memories).toHaveLength(1);
  });

  it("records attempts and successful operation counts without memory or window content", async () => {
    const rawWindowText = "My memory extraction raw window text is private";
    const createdMemoryContent = "Prefers concise launch updates";
    const { app, token, telemetryService } = await createAuthenticatedTestApp(
      async () => ({ text: " world" }),
      {
        async proposeOperations() {
          return [{ type: "create", content: createdMemoryContent }];
        },
      },
    );

    const response = await app.request("/api/memory/extract", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(buildExtractionRequest("batch-telemetry", rawWindowText)),
    });

    expect(response.status).toBe(200);
    const events = await telemetryService.listEvents();
    expect(events.map((event) => event.eventType)).toEqual([
      "memory_extraction_attempted",
      "memory_extraction_succeeded",
    ]);
    expect(events[0]).toMatchObject({
      requestId: "batch-telemetry",
      contextSource: "typed_text",
      modelId: "openai/gpt-5.5",
      clientAppVersion: "0.0.1",
      clientPlatform: "darwin",
    });
    expect(events[1]).toMatchObject({
      requestId: "batch-telemetry",
      eventType: "memory_extraction_succeeded",
      memoryCreatedCount: 1,
      memoryUpdatedCount: 0,
      memoryDeletedCount: 0,
      memoryRejectedCount: 0,
    });
    expect(typeof events[1].latencyMs).toBe("number");
    assertNoRawText(events, rawWindowText);
    assertNoRawText(events, createdMemoryContent);
  });

  it("records failed extraction metadata without raw window content", async () => {
    const rawWindowText = "My failed extraction raw window text is private";
    const { app, token, telemetryService } = await createAuthenticatedTestApp(
      async () => ({ text: " world" }),
      {
        async proposeOperations() {
          throw new Error("model unavailable");
        },
      },
    );

    const response = await app.request("/api/memory/extract", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(buildExtractionRequest("batch-telemetry-fail", rawWindowText)),
    });

    expect(response.status).toBe(500);
    const events = await telemetryService.listEvents();
    expect(events.map((event) => event.eventType)).toEqual([
      "memory_extraction_attempted",
      "memory_extraction_failed",
    ]);
    expect(events[1]).toMatchObject({
      requestId: "batch-telemetry-fail",
      eventType: "memory_extraction_failed",
      modelId: "openai/gpt-5.5",
      errorCode: "provider_failure",
    });
    expect(typeof events[1].latencyMs).toBe("number");
    assertNoRawText(events, rawWindowText);
  });
});
