import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { ApiResponseSchema } from "../packages/contracts/src/index.ts";
import {
  createApp,
  normalizeGeneratedSuggestion,
} from "../apps/api/src/index.ts";
import { BillingService, InMemoryBillingStorage, InMemoryUsageMeterClient, UsageMeterService } from "../apps/api/src/billing.ts";
import { createAuthInstance, migrateAuth } from "../apps/api/src/auth.ts";
import { DeviceTokenService, InMemoryDeviceTokenStorage } from "../apps/api/src/device-tokens.ts";
import { InMemoryMemoryJobQueue } from "../apps/api/src/memory-agent.ts";
import { InMemoryPersonalMemoryStorage, PersonalMemoryService } from "../apps/api/src/personal-memory.ts";
import { InMemoryTelemetryStorage, TelemetryService } from "../apps/api/src/telemetry.ts";
import { SuggestionUseCase } from "../apps/api/src/suggestion-use-case.ts";
import type { SuggestionGenerator, SuggestionInput } from "../apps/api/src/index.ts";

async function createAuthenticatedTestApp(generateSuggestion: SuggestionGenerator) {
  const database = new Database(":memory:");
  const auth = createAuthInstance({ database });
  await migrateAuth(auth);
  const deviceTokenStorage = new InMemoryDeviceTokenStorage();
  const deviceTokenService = new DeviceTokenService({ storage: deviceTokenStorage });
  const billingStorage = new InMemoryBillingStorage();
  const billingService = new BillingService({ storage: billingStorage });
  const app = createApp({ generateSuggestion, auth, deviceTokenService, billingService, telemetryStorage: new InMemoryTelemetryStorage(), personalMemoryStorage: new InMemoryPersonalMemoryStorage() });
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
  return { app, token };
}

async function parseApiResponse(response: Response) {
  return ApiResponseSchema.parse(await response.json());
}

const validRequest = {
  requestId: "req-1",
  deviceId: "device-1",
  typingContext: "Hello",
  contextSource: "typed_text",
  redaction: { applied: false, redactionCount: 0, kinds: [] },
  activeApplication: { bundleId: "com.apple.TextEdit" },
  memoryEnabled: true,
  contextHash: "com.apple.TextEdit:Hello:false",
  clientMetadata: { appVersion: "0.0.1", platform: "darwin" },
} as const;

const validDevice = {
  id: "dt-1",
  userId: "user-1",
  deviceId: "device-1",
  platform: "darwin",
  appVersion: "0.0.1",
  tokenHash: "token-hash",
  createdAt: new Date().toISOString(),
  lastUsedAt: new Date().toISOString(),
  revokedAt: null,
} as const;

function authHeaders(token: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

describe("Hono suggestion API", () => {
  it("normalizes generated suggestions without joining words", () => {
    expect(normalizeGeneratedSuggestion("Hello", "world")).toBe(" world");
    expect(normalizeGeneratedSuggestion("caf\u00e9", "recommendations")).toBe(
      " recommendations",
    );
    expect(normalizeGeneratedSuggestion("Hello ", "world")).toBe("world");
    expect(normalizeGeneratedSuggestion("Hello", "\nworld\n")).toBe(" world");
    expect(normalizeGeneratedSuggestion("Hello", "   ")).toBe("");
  });

  it("returns one suggestion when the provider generates text", async () => {
    const { app, token } = await createAuthenticatedTestApp(async () => ({ text: " world" }));

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(validRequest),
    });

    expect(response.status).toBe(200);
    const body = await parseApiResponse(response);
    expect(body.status).toBe("ok");
    if (body.status !== "ok") throw new Error("Expected ok response");
    expect(body.data.suggestions).toHaveLength(1);
    expect(body.data.suggestions[0].text).toBe(" world");
    expect(body.data.suggestions[0].id).toContain("req-1");
  });

  it("returns an empty suggestions array when the provider returns no confident suggestion", async () => {
    const { app, token } = await createAuthenticatedTestApp(async () => null);

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(validRequest),
    });

    expect(response.status).toBe(200);
    const body = await parseApiResponse(response);
    expect(body.status).toBe("ok");
    if (body.status !== "ok") throw new Error("Expected ok response");
    expect(body.data.suggestions).toHaveLength(0);
  });

  it("returns an invalid_request error for a missing field", async () => {
    const { app, token } = await createAuthenticatedTestApp(async () => ({ text: " world" }));

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ ...validRequest, typingContext: "" }),
    });

    expect(response.status).toBe(400);
    const body = await parseApiResponse(response);
    expect(body.status).toBe("error");
    if (body.status !== "error") throw new Error("Expected error response");
    expect(body.error.code).toBe("invalid_request");
  });

  it("returns a provider_failure error when generation throws", async () => {
    const { app, token } = await createAuthenticatedTestApp(async () => {
      throw new Error("model timeout");
    });

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(validRequest),
    });

    expect(response.status).toBe(503);
    const body = await parseApiResponse(response);
    expect(body.status).toBe("error");
    if (body.status !== "error") throw new Error("Expected error response");
    expect(body.error.code).toBe("provider_failure");
    expect(body.error.message).toContain("model timeout");
  });

  it("accepts context hash and client metadata", async () => {
    let capturedInput: SuggestionInput | null = null;
    const { app, token } = await createAuthenticatedTestApp(async (input) => {
      capturedInput = input;
      return { text: " there" };
    });

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(validRequest),
    });

    expect(response.status).toBe(200);
    expect(capturedInput).not.toBeNull();
    expect(capturedInput?.requestId).toBe("req-1");
    expect(capturedInput?.typingContext).toBe("Hello");
    expect(capturedInput?.activeApplication.bundleId).toBe("com.apple.TextEdit");
  });

  it("rejects unauthenticated suggestion requests", async () => {
    const database = new Database(":memory:");
    const auth = createAuthInstance({ database });
    await migrateAuth(auth);
    const app = createApp({
      generateSuggestion: async () => ({ text: " world" }),
      auth,
      deviceTokenService: new DeviceTokenService({ storage: new InMemoryDeviceTokenStorage() }),
      billingService: new BillingService({ storage: new InMemoryBillingStorage() }),
      telemetryStorage: new InMemoryTelemetryStorage(),
      personalMemoryStorage: new InMemoryPersonalMemoryStorage(),
    });

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validRequest),
    });

    expect(response.status).toBe(401);
    const body = await parseApiResponse(response);
    expect(body.status).toBe("error");
    if (body.status !== "error") throw new Error("Expected error response");
    expect(body.error.code).toBe("unauthenticated");
  });

  it("rejects revoked device tokens", async () => {
    const database = new Database(":memory:");
    const auth = createAuthInstance({ database });
    await migrateAuth(auth);
    const deviceTokenService = new DeviceTokenService({ storage: new InMemoryDeviceTokenStorage() });
    const app = createApp({
      generateSuggestion: async () => ({ text: " world" }),
      auth,
      deviceTokenService,
      billingService: new BillingService({ storage: new InMemoryBillingStorage() }),
      telemetryStorage: new InMemoryTelemetryStorage(),
      personalMemoryStorage: new InMemoryPersonalMemoryStorage(),
    });

    const { token, device } = await deviceTokenService.createDeviceToken("user-1", {
      deviceId: "device-revoked",
      platform: "darwin",
      appVersion: "0.0.1",
    });
    await deviceTokenService.revokeDevice("user-1", device.deviceId);

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(validRequest),
    });

    expect(response.status).toBe(401);
    const body = await parseApiResponse(response);
    expect(body.status).toBe("error");
    if (body.status !== "error") throw new Error("Expected error response");
    expect(body.error.code).toBe("revoked_device");
  });
});

describe("SuggestionUseCase", () => {
  function createUseCase(generateSuggestion: SuggestionGenerator) {
    const billingService = new BillingService({ storage: new InMemoryBillingStorage() });
    const usageMeterClient = new InMemoryUsageMeterClient();
    const usageMeterService = new UsageMeterService({ client: usageMeterClient, retryDelayMs: 0 });
    const personalMemoryService = new PersonalMemoryService({ storage: new InMemoryPersonalMemoryStorage() });
    const memoryJobQueue = new InMemoryMemoryJobQueue();
    const telemetryService = new TelemetryService({ storage: new InMemoryTelemetryStorage() });
    const useCase = new SuggestionUseCase({
      billingService,
      usageMeterService,
      personalMemoryService,
      memoryJobQueue,
      telemetryService,
      generateSuggestion,
    });

    return {
      billingService,
      memoryJobQueue,
      personalMemoryService,
      telemetryService,
      usageMeterClient,
      useCase,
    };
  }

  async function activateFreePlan(billingService: BillingService) {
    await billingService.applyEntitlement({
      userId: "user-1",
      planId: "free",
      polarCustomerId: "polar-customer-free",
      polarSubscriptionId: "polar-sub-free",
      status: "active",
      cachedAt: new Date(),
    });
  }

  it("orchestrates quota, relevant memory, generation, telemetry, billing, and memory enqueueing", async () => {
    let capturedInput: SuggestionInput | null = null;
    const { billingService, memoryJobQueue, personalMemoryService, telemetryService, useCase } = createUseCase(async (input) => {
      capturedInput = input;
      return { text: " world", modelId: "test-model" };
    });
    await personalMemoryService.createMemory({
      userId: "user-1",
      content: "Hello messages should stay concise",
      createdBy: "user",
    });
    await activateFreePlan(billingService);

    const result = await useCase.handle(validDevice, validRequest);

    expect(result).toEqual({ ok: true, suggestions: [{ id: "sg-req-1", text: " world" }] });
    expect(capturedInput?.memories).toHaveLength(1);
    expect((await billingService.checkQuota("user-1")).usage).toBe(1);
    expect(memoryJobQueue.getJobs()).toHaveLength(1);
    expect(memoryJobQueue.getJobs()[0].typingContext).toBe("Hello");
    expect((await telemetryService.listEvents()).map((event) => event.eventType)).toEqual([
      "suggestion_shown",
      "memory_job_enqueued",
    ]);
  });

  it("returns quota exhaustion before generating suggestions", async () => {
    let generated = false;
    const { billingService, useCase } = createUseCase(async () => {
      generated = true;
      return { text: " world" };
    });
    await activateFreePlan(billingService);

    for (let i = 0; i < 100; i += 1) {
      await billingService.consumeSuggestion("user-1");
    }

    const result = await useCase.handle(validDevice, validRequest);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected quota error");
    expect(result.status).toBe(402);
    expect(result.code).toBe("quota_exhausted");
    expect(result.details?.quota).toBe(100);
    expect(generated).toBe(false);
  });

  it("records provider failures without enqueueing memory jobs", async () => {
    const { billingService, memoryJobQueue, telemetryService, useCase } = createUseCase(async () => {
      throw new Error("model timeout");
    });
    await activateFreePlan(billingService);

    const result = await useCase.handle(validDevice, validRequest);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected provider failure");
    expect(result.status).toBe(503);
    expect(result.code).toBe("provider_failure");
    expect(memoryJobQueue.getJobs()).toHaveLength(0);
    expect((await telemetryService.listEvents()).map((event) => event.eventType)).toEqual([
      "suggestion_error",
    ]);
  });
});
