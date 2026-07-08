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

async function createAuthenticatedTestApp(generateSuggestion: SuggestionGenerator) {
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
  return { app, token, telemetryService };
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
    typingContext,
    contextSource: "typed_text" as const,
    redaction: { applied: false, redactionCount: 0, kinds: [] as string[] },
    activeApplication: { bundleId: "com.apple.TextEdit" },
    memoryEnabled: true,
    contextHash: `com.apple.TextEdit:${typingContext}:false`,
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
    expect(shown?.activeApplicationBundleId).toBe("com.apple.TextEdit");
    expect(shown?.suggestionLength).toBe(suggestionText.length);
    expect(shown?.planId).toBe("free");
    expect(shown?.modelId).toBe("gpt-4o-mini");
    expect(typeof shown?.latencyMs).toBe("number");
    expect((shown?.latencyMs ?? -1)).toBeGreaterThanOrEqual(0);
    expect(() => new Date(shown!.timestamp)).not.toThrow();
    assertNoRawText(events, rawContext);
    assertNoRawText(events, suggestionText);
  });

  it("records shown metadata for an empty suggestion without raw text", async () => {
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
    const shown = events.find((e) => e.eventType === "suggestion_shown");
    expect(shown).toBeDefined();
    expect(shown?.suggestionLength).toBe(0);
    expect(shown?.modelId).toBe("gpt-4o-mini");
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
    expect(errorEvent?.activeApplicationBundleId).toBe("com.apple.TextEdit");
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
          requestId: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          activeApplicationBundleId: "com.apple.Mail",
          suggestionLength: 5,
          latencyMs: 12,
        }),
      });

      expect(response.status).toBe(200);
    }

    const events = await telemetryService.listEvents();
    expect(events.some((e) => e.eventType === "suggestion_accepted")).toBe(true);
    expect(events.some((e) => e.eventType === "suggestion_dismissed")).toBe(true);
    expect(events.some((e) => e.eventType === "suggestion_stale")).toBe(true);
    expect(events.every((e) => e.latencyMs === 12)).toBe(true);
    assertNoRawText(events, "accepted suggestion text");
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
        requestId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        activeApplicationBundleId: "com.apple.Mail",
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
