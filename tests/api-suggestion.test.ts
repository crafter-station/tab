import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { ApiResponseSchema } from "../packages/contracts/src/index.ts";
import {
  createApp,
  createSuggestionPrompt,
  MAX_SUGGESTION_LENGTH,
  normalizeGeneratedSuggestion,
} from "../apps/api/src/index.ts";
import { isSuggestionContractValid } from "../packages/suggestion-policy/src/index.ts";
import { normalizeGeneratedRewrite } from "../packages/suggestion-policy/src/index.ts";
import { BillingService, InMemoryBillingStorage, InMemoryUsageMeterClient, UsageMeterService } from "../apps/api/src/billing.ts";
import { createAuthInstance, migrateAuth } from "../apps/api/src/auth.ts";
import { DeviceTokenService, InMemoryDeviceTokenStorage } from "../apps/api/src/device-tokens.ts";
import { InMemoryPersonalMemoryStorage, PersonalMemoryService } from "../apps/api/src/personal-memory.ts";
import { InMemoryMemoryExtractionStorage } from "../apps/api/src/personal-memory-extraction.ts";
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
  const telemetryService = new TelemetryService({ storage: new InMemoryTelemetryStorage() });
  const personalMemoryStorage = new InMemoryPersonalMemoryStorage();
  const memoryExtractionStorage = new InMemoryMemoryExtractionStorage((input) =>
    personalMemoryStorage.applyExtractionOperationAtomically(input),
  );
  let memoryExtractionClaims = 0;
  const claimMemoryExtraction = memoryExtractionStorage.claim.bind(memoryExtractionStorage);
  memoryExtractionStorage.claim = async (input) => {
    memoryExtractionClaims += 1;
    return claimMemoryExtraction(input);
  };
  const app = createApp({ generateSuggestion, auth, deviceTokenService, billingService, telemetryService, personalMemoryStorage, memoryExtractionStorage });
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
  return { app, token, billingService, telemetryService, getMemoryExtractionClaims: () => memoryExtractionClaims };
}

async function parseApiResponse(response: Response) {
  return ApiResponseSchema.parse(await response.json());
}

const validRequest = {
  requestId: "req-1",
  deviceId: "device-1",
  mode: "deep_complete",
  typingContext: "Hello",
  contextSource: "typed_text",
  redaction: { applied: false, redactionCount: 0, kinds: [] },
  activeApplication: { bundleId: "com.apple.TextEdit" },
  memoryEnabled: true,
  contextHash: "com.apple.TextEdit:Hello:false",
  clientMetadata: { appVersion: "0.0.1", platform: "darwin" },
} as const;

const validRewriteRequest = {
  ...validRequest,
  requestId: "rewrite-1",
  mode: "rewrite",
  selectedText: "This sentence are unclear.",
  textBeforeSelection: "Introduction. ",
  textAfterSelection: " Conclusion.",
  selectedRange: { location: 14, length: 26 },
  focusedElementId: "field-1",
  textElementId: "text-1",
  contextIdentity: "rewrite-target-1",
  activeApplication: { bundleId: "com.apple.TextEdit", windowId: "window-1" },
} as const;

const appContext = {
  fragments: [
    {
      id: "fragment-1",
      provider: "synthetic-visible-thread",
      kind: "conversation",
      text: "Alex: Can you confirm the launch date?",
      confidence: 0.92,
      redaction: { applied: false, redactionCount: 0, kinds: [] },
      requestable: true,
      memoryEligible: false,
    },
  ],
  metadata: {
    provider: "synthetic-visible-thread",
    status: "available",
    confidence: 0.92,
  },
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
    expect(normalizeGeneratedSuggestion("Hello ", " world")).toBe("world");
    expect(normalizeGeneratedSuggestion("Hello", "\nworld\n")).toBe(" world");
    expect(normalizeGeneratedSuggestion("Hello", "   ")).toBe("");
  });

  it("removes duplicated draft text from generated suggestions", () => {
    expect(normalizeGeneratedSuggestion("Hello", "Hello world")).toBe(" world");
    expect(normalizeGeneratedSuggestion("Hello ", "Hello world")).toBe("world");
    expect(normalizeGeneratedSuggestion("Let's meet at", "at 3pm")).toBe(" 3pm");
    expect(normalizeGeneratedSuggestion("i want to see ", "see you soon")).toBe("you soon");
    expect(normalizeGeneratedSuggestion("Hello", "Hello")).toBe("");
  });

  it("continues partial words without inserting spaces", () => {
    expect(normalizeGeneratedSuggestion("The quick br", "brown fox")).toBe("own fox");
    expect(normalizeGeneratedSuggestion("recomm", "recommendations for dinner")).toBe(
      "endations for dinner",
    );
    expect(normalizeGeneratedSuggestion("See you tom", "orrow.")).toBe("orrow.");
    expect(normalizeGeneratedSuggestion("I bought a", "apple")).toBe(" apple");
  });

  it("caps generated suggestions at the maximum length", () => {
    const suggestion = normalizeGeneratedSuggestion(
      "Please analyze",
      "the debounce behavior and identify why duplicate requests are still being sent after input stops changing",
    );

    expect(suggestion.length).toBeLessThanOrEqual(MAX_SUGGESTION_LENGTH);
    expect(suggestion).toBe(" the debounce behavior");
  });

  it("caps suggestions at three words and rejects transcript framing", () => {
    expect(normalizeGeneratedSuggestion("Hello, ", "how are you doing today?")).toBe("how are you");
    expect(normalizeGeneratedSuggestion("Hello", "User: how are you?")).toBe(" User: how are");
    expect(isSuggestionContractValid("Hello", " User: how are")).toBe(false);
    expect(isSuggestionContractValid("Hello", " Assistant: hello")).toBe(false);
    expect(isSuggestionContractValid("Hello", " System: continue")).toBe(false);
  });

  it("does not strip valid next words with short matching prefixes", () => {
    expect(normalizeGeneratedSuggestion("I bought a", "apple")).toBe(" apple");
    expect(normalizeGeneratedSuggestion("I want to", "today")).toBe(" today");
    expect(normalizeGeneratedSuggestion("Vi el", "elefante")).toBe(" elefante");
    expect(normalizeGeneratedSuggestion("Voy de", "desayuno")).toBe(" desayuno");
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

  it("returns a validated replacement for an authenticated Rewrite", async () => {
    let input: SuggestionInput | null = null;
    const { app, token, billingService, telemetryService } = await createAuthenticatedTestApp(async (captured) => {
      input = captured;
      return { text: "This sentence is clear.", modelId: "rewrite-model", cloudCostUsdMicros: 12 };
    });
    const response = await app.request("/suggestions", {
      method: "POST", headers: authHeaders(token), body: JSON.stringify(validRewriteRequest),
    });
    expect(response.status).toBe(200);
    const body = await parseApiResponse(response);
    expect(body.status === "ok" && body.data.suggestions[0]?.text).toBe("This sentence is clear.");
    expect(input).toMatchObject({ mode: "rewrite", selectedText: validRewriteRequest.selectedText });
    expect(input && "typingContext" in input).toBe(false);
    expect((await billingService.checkDeepComplete("user-1")).usage).toBe(1);
    const events = await telemetryService.listEvents();
    expect(events[0]).toMatchObject({ suggestionMode: "rewrite", selectedTextLength: 26, surroundingTextLength: 26, cloudCostUsdMicros: 12 });
    const serialized = JSON.stringify(events);
    for (const raw of [validRewriteRequest.selectedText, validRewriteRequest.textBeforeSelection, validRewriteRequest.textAfterSelection, "This sentence is clear."]) expect(serialized).not.toContain(raw);

    const replay = await app.request("/suggestions", { method: "POST", headers: authHeaders(token), body: JSON.stringify(validRewriteRequest) });
    expect(replay.status).toBe(409);
    expect((await billingService.checkDeepComplete("user-1")).usage).toBe(1);
  });

  it("rejects malformed Rewrite targets and enforces the 2,000-character boundary", async () => {
    const { app, token } = await createAuthenticatedTestApp(async () => ({ text: "better" }));
    const cases = [
      { ...validRewriteRequest, selectedText: "", selectedRange: { location: 0, length: 0 } },
      { ...validRewriteRequest, selectedRange: { location: 14, length: 2 } },
      { ...validRewriteRequest, focusedElementId: "" },
      { ...validRewriteRequest, activeApplication: { bundleId: "com.apple.TextEdit" } },
      { ...validRewriteRequest, selectedText: "x".repeat(2_001), selectedRange: { location: 0, length: 2_001 } },
      { ...validRewriteRequest, redaction: { applied: true, redactionCount: 1, kinds: ["api_key"] } },
      { ...validRewriteRequest, selectedText: "api_key=abcdefghijklmnop", selectedRange: { location: 0, length: 24 } },
    ];
    for (const request of cases) {
      const response = await app.request("/suggestions", { method: "POST", headers: authHeaders(token), body: JSON.stringify(request) });
      expect(response.status).toBe(400);
    }
    const boundary = { ...validRewriteRequest, requestId: "rewrite-boundary", selectedText: "word ".repeat(400), selectedRange: { location: 0, length: 2_000 } };
    expect((await app.request("/suggestions", { method: "POST", headers: authHeaders(token), body: JSON.stringify(boundary) })).status).toBe(200);
  });

  it("suppresses unchanged, explanatory, quoted, empty, and oversized Rewrite output", async () => {
    for (const [index, output] of [
      validRewriteRequest.selectedText,
      "Here is a clearer version: text",
      "I rewrote it for clarity: This sentence is clear.",
      "Improved version: This sentence is clear.",
      "Corrected text: This sentence is clear.",
      '"This sentence is clear."',
      "'This sentence is clear.'",
      "‘This sentence is clear.’",
      "«This sentence is clear.»",
      "„This sentence is clear.“",
      "‚This sentence is clear.‘",
      "「This sentence is clear.」",
      "『This sentence is clear.』",
      "〝This sentence is clear.〞",
      " ",
      "x".repeat(2_001),
    ].entries()) {
      const { app, token } = await createAuthenticatedTestApp(async () => ({ text: output }));
      const response = await app.request("/suggestions", { method: "POST", headers: authHeaders(token), body: JSON.stringify({ ...validRewriteRequest, requestId: `invalid-output-${index}` }) });
      const body = await parseApiResponse(response);
      expect(body.status === "ok" && body.data.suggestions).toEqual([]);
    }
    expect(normalizeGeneratedRewrite(validRewriteRequest.selectedText, "This sentence is clear.")).toBe("This sentence is clear.");
  });

  it("records provider metadata for a suppressed Rewrite", async () => {
    const { app, token, billingService, telemetryService } = await createAuthenticatedTestApp(async () => ({
      text: "",
      modelId: "rewrite-model",
      cloudCostUsdMicros: 7,
    }));
    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ ...validRewriteRequest, requestId: "suppressed-metadata" }),
    });

    const body = await parseApiResponse(response);
    expect(body.status === "ok" && body.data.suggestions).toEqual([]);
    expect((await billingService.checkDeepComplete("user-1")).usage).toBe(0);
    expect((await telemetryService.listEvents())[0]).toMatchObject({
      eventType: "suggestion_generated",
      suggestionMode: "rewrite",
      suggestionLength: 0,
      modelId: "rewrite-model",
      cloudCostUsdMicros: 7,
    });
  });

  it("does not enqueue Rewrite text for Memory Extraction", async () => {
    const { app, token, getMemoryExtractionClaims } = await createAuthenticatedTestApp(async () => ({
      text: "This sentence is clear.",
    }));

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ ...validRewriteRequest, requestId: "rewrite-memory-exclusion" }),
    });

    expect(response.status).toBe(200);
    expect(getMemoryExtractionClaims()).toBe(0);
  });

  it("rate limits Rewrite before provider generation or allowance consumption", async () => {
    let generations = 0;
    const { app, token, billingService } = await createAuthenticatedTestApp(async () => {
      generations += 1;
      return null;
    });
    for (let index = 0; index < 60; index += 1) {
      const response = await app.request("/suggestions", { method: "POST", headers: authHeaders(token), body: JSON.stringify({ ...validRewriteRequest, requestId: `rate-${index}` }) });
      expect(response.status).toBe(200);
    }
    const limited = await app.request("/suggestions", { method: "POST", headers: authHeaders(token), body: JSON.stringify({ ...validRewriteRequest, requestId: "rate-limited" }) });
    expect(limited.status).toBe(429);
    expect(generations).toBe(60);
    expect((await billingService.checkDeepComplete("user-1")).usage).toBe(0);
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

  it("returns provider_failure for Rewrite without consuming allowance", async () => {
    const { app, token, billingService } = await createAuthenticatedTestApp(async () => {
      throw new Error("rewrite model timeout");
    });

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ ...validRewriteRequest, requestId: "rewrite-provider-failure" }),
    });

    expect(response.status).toBe(503);
    const body = await parseApiResponse(response);
    expect(body.status === "error" && body.error.code).toBe("provider_failure");
    expect((await billingService.checkDeepComplete("user-1")).usage).toBe(0);
  });

  it("returns the existing allowance exhaustion error for Rewrite", async () => {
    let generated = false;
    const { app, token, billingService } = await createAuthenticatedTestApp(async () => {
      generated = true;
      return { text: "This sentence is clear." };
    });
    for (let index = 0; index < 10; index += 1) {
      await billingService.consumeDeepComplete("user-1", `rewrite-seed-${index}`);
    }

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ ...validRewriteRequest, requestId: "rewrite-quota-exhausted" }),
    });

    expect(response.status).toBe(402);
    const body = await parseApiResponse(response);
    expect(body.status === "error" && body.error.code).toBe("quota_exhausted");
    expect(generated).toBe(false);
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

  it("accepts App Context separately from Typing Context", async () => {
    let capturedInput: SuggestionInput | null = null;
    const { app, token } = await createAuthenticatedTestApp(async (input) => {
      capturedInput = input;
      return { text: " tomorrow" };
    });

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ ...validRequest, appContext }),
    });

    expect(response.status).toBe(200);
    expect(capturedInput?.typingContext).toBe("Hello");
    expect(capturedInput?.appContext?.fragments[0].text).toBe("Alex: Can you confirm the launch date?");
    expect(capturedInput?.appContext?.fragments[0].memoryEligible).toBe(false);
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

    for (const request of [
      { ...validRequest, deviceId: "device-revoked" },
      { ...validRewriteRequest, requestId: "rewrite-revoked", deviceId: "device-revoked" },
    ]) {
      const response = await app.request("/suggestions", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify(request),
      });

      expect(response.status).toBe(401);
      const body = await parseApiResponse(response);
      expect(body.status === "error" && body.error.code).toBe("revoked_device");
    }
  });
});

describe("SuggestionUseCase", () => {
  function createUseCase(generateSuggestion: SuggestionGenerator) {
    const billingStorage = new InMemoryBillingStorage();
    const billingService = new BillingService({ storage: billingStorage });
    const usageMeterClient = new InMemoryUsageMeterClient();
    const usageMeterService = new UsageMeterService({ client: usageMeterClient, retryDelayMs: 0 });
    const personalMemoryService = new PersonalMemoryService({ storage: new InMemoryPersonalMemoryStorage() });
    const telemetryService = new TelemetryService({ storage: new InMemoryTelemetryStorage() });
    const useCase = new SuggestionUseCase({
      billingService,
      personalMemoryService,
      telemetryService,
      generateSuggestion,
    });

    return {
      billingService,
      billingStorage,
      personalMemoryService,
      telemetryService,
      usageMeterClient,
      usageMeterService,
      useCase,
    };
  }

  async function activateFreePlan(billingService: BillingService) {
    await billingService.applyEntitlement({
      userId: "user-1",
      planId: "free",
      status: "inactive",
      cachedAt: new Date(),
    });
  }

  it("orchestrates quota, relevant memory, generation, telemetry, and billing without memory jobs", async () => {
    let capturedInput: SuggestionInput | null = null;
    const { billingService, personalMemoryService, telemetryService, useCase } = createUseCase(async (input) => {
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
    expect((await billingService.checkDeepComplete("user-1")).usage).toBe(1);
    expect((await telemetryService.listEvents()).map((event) => event.eventType)).toEqual([
      "suggestion_generated",
      "suggestion_shown",
    ]);
  });

  it("applies custom writing instructions only when the entitlement allows them", async () => {
    let freeInput: SuggestionInput | null = null;
    const free = createUseCase(async (input) => {
      freeInput = input;
      return { text: " world" };
    });
    await activateFreePlan(free.billingService);
    await free.useCase.handle(validDevice, {
      ...validRequest,
      customWritingInstructions: "Keep it concise.",
    });
    expect(freeInput?.customWritingInstructions).toBeUndefined();

    let trialInput: SuggestionInput | null = null;
    const trial = createUseCase(async (input) => {
      trialInput = input;
      return { text: " world" };
    });
    await trial.billingService.applyEntitlement({
      userId: "user-1",
      planId: "pro",
      polarCustomerId: "polar-customer-trial",
      polarSubscriptionId: "polar-subscription-trial",
      status: "trialing",
      trialStartedAt: new Date("2026-07-01T00:00:00.000Z"),
      trialEndsAt: new Date("2099-08-01T00:00:00.000Z"),
      cachedAt: new Date(),
    });
    await trial.useCase.handle(validDevice, {
      ...validRequest,
      requestId: "req-trial-instructions",
      customWritingInstructions: "Keep it concise.",
    });
    expect(trialInput?.customWritingInstructions).toBe("Keep it concise.");
  });

  it("passes App Context to generation without performing memory jobs", async () => {
    let capturedInput: SuggestionInput | null = null;
    const { billingService, useCase } = createUseCase(async (input) => {
      capturedInput = input;
      return { text: " tomorrow", modelId: "test-model" };
    });
    await activateFreePlan(billingService);

    const result = await useCase.handle(validDevice, { ...validRequest, appContext });

    expect(result.ok).toBe(true);
    expect(capturedInput?.appContext?.fragments).toHaveLength(1);
  });

  it("continues without memory when relevant memory retrieval fails", async () => {
    let capturedInput: SuggestionInput | null = null;
    const { billingService, personalMemoryService, useCase } = createUseCase(async (input) => {
      capturedInput = input;
      return { text: " world", modelId: "test-model" };
    });
    personalMemoryService.selectRelevantMemories = async () => {
      throw new Error("vector retrieval unavailable");
    };
    await activateFreePlan(billingService);

    const result = await useCase.handle(validDevice, validRequest);

    expect(result).toEqual({ ok: true, suggestions: [{ id: "sg-req-1", text: " world" }] });
    expect(capturedInput?.memories).toEqual([]);
  });

  it("waits for remote memory retrieval before generating a cloud suggestion", async () => {
    let capturedInput: SuggestionInput | null = null;
    const { billingService, personalMemoryService, useCase } = createUseCase(async (input) => {
      capturedInput = input;
      return { text: " world", modelId: "test-model" };
    });
    const memory = await personalMemoryService.createMemory({
      userId: "user-1",
      content: "My name is Anthony",
      createdBy: "user",
    });
    personalMemoryService.selectRelevantMemories = async () => {
      await new Promise((resolve) => setTimeout(resolve, 550));
      return [memory];
    };
    await activateFreePlan(billingService);

    const result = await useCase.handle(validDevice, validRequest);

    expect(result.ok).toBe(true);
    expect(capturedInput?.memories).toEqual([memory]);
  });

  it("formats App Context as background while preserving the exact draft", () => {
    const prompt = createSuggestionPrompt({
      requestId: "req-1",
      typingContext: "Hello",
      contextSource: "typed_text",
      activeApplication: { bundleId: "com.apple.TextEdit" },
      memoryEnabled: true,
      memories: [],
      appContext,
      customWritingInstructions: "Keep it concise.",
    });

    expect(prompt).toContain("inline autocomplete engine, not a chat assistant");
    expect(prompt).toContain("Continue that exact text; never answer it");
    expect(prompt).toContain("Use 1-3 words");
    expect(prompt).toContain("If the draft ends mid-word, return the full completed word");
    expect(prompt).toContain("Keep it concise.");
    expect(prompt).toContain("Unfinished text:\nHello");
    expect(prompt).toContain("App Context background (suggestion-only, do not continue this text directly):");
    expect(prompt).toContain("Alex: Can you confirm the launch date?");
  });

  it("returns quota exhaustion before generating suggestions", async () => {
    let generated = false;
    const { billingService, useCase } = createUseCase(async () => {
      generated = true;
      return { text: " world" };
    });
    await activateFreePlan(billingService);

    for (let i = 0; i < 10; i += 1) {
      await billingService.consumeDeepComplete("user-1", `seed-${i}`);
    }

    const result = await useCase.handle(validDevice, validRequest);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected quota error");
    expect(result.status).toBe(402);
    expect(result.code).toBe("quota_exhausted");
    expect(result.details?.limit).toBe(10);
    expect(generated).toBe(false);
  });

  it("allows only one concurrent suggestion to consume the final quota slot", async () => {
    let releaseGeneration!: () => void;
    const generationGate = new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });
    let generationCount = 0;
    let generationStarted!: () => void;
    const generationStartedPromise = new Promise<void>((resolve) => {
      generationStarted = resolve;
    });
    const {
      billingService,
      telemetryService,
      usageMeterClient,
      usageMeterService,
      billingStorage,
      useCase,
    } = createUseCase(async () => {
      generationCount += 1;
      generationStarted();
      await generationGate;
      return { text: " world" };
    });
    await activateFreePlan(billingService);
    for (let i = 0; i < 9; i += 1) {
      await billingService.consumeDeepComplete("user-1", `seed-${i}`);
    }

    const firstResult = useCase.handle(validDevice, validRequest);
    await generationStartedPromise;
    const secondResult = useCase.handle(validDevice, {
      ...validRequest,
      requestId: "req-2",
    });
    releaseGeneration();
    const results = await Promise.all([firstResult, secondResult]);

    const successful = results.find((result) => result.ok);
    expect(successful?.suggestions).toHaveLength(1);
    if (!successful?.ok) throw new Error("Expected one successful suggestion");
    const winningRequestId = successful.suggestions[0].id.replace(/^sg-/, "");
    const rejected = results.find((result) => !result.ok);
    expect(rejected).toMatchObject({
      ok: false,
      status: 402,
      code: "quota_exhausted",
      details: { capability: "deep_completes", limit: 10, used: 10 },
    });
    expect(generationCount).toBe(1);
    expect((await billingService.checkDeepComplete("user-1")).usage).toBe(10);
    await usageMeterService.drainOutbox(billingStorage);
    expect(usageMeterClient.getEvents()).toEqual([
      expect.objectContaining({ eventId: winningRequestId }),
    ]);
    const shownEvents = (await telemetryService.listEvents()).filter(
      (event) => event.eventType === "suggestion_shown",
    );
    expect(shownEvents).toEqual([
      expect.objectContaining({ requestId: winningRequestId }),
    ]);
  });

  it("rejects a concurrent duplicate request without sharing its reservation", async () => {
    let releaseGeneration!: () => void;
    const generationGate = new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });
    let generationStarted!: () => void;
    const generationStartedPromise = new Promise<void>((resolve) => {
      generationStarted = resolve;
    });
    let generationCount = 0;
    const {
      billingService,
      telemetryService,
      usageMeterClient,
      usageMeterService,
      billingStorage,
      useCase,
    } = createUseCase(async () => {
      generationCount += 1;
      generationStarted();
      await generationGate;
      return { text: " world" };
    });
    await activateFreePlan(billingService);

    const firstResultPromise = useCase.handle(validDevice, validRequest);
    await generationStartedPromise;
    const duplicateResult = await useCase.handle(validDevice, validRequest);

    expect(duplicateResult).toMatchObject({
      ok: false,
      status: 409,
      code: "invalid_request",
    });
    expect(generationCount).toBe(1);

    releaseGeneration();
    const firstResult = await firstResultPromise;

    expect(firstResult).toEqual({
      ok: true,
      suggestions: [{ id: "sg-req-1", text: " world" }],
    });
    expect((await billingService.checkDeepComplete("user-1")).usage).toBe(1);
    await usageMeterService.drainOutbox(billingStorage);
    expect(usageMeterClient.getEvents()).toEqual([
      expect.objectContaining({ eventId: "req-1" }),
    ]);
    expect(
      (await telemetryService.listEvents()).filter(
        (event) => event.eventType === "suggestion_shown",
      ),
    ).toEqual([expect.objectContaining({ requestId: "req-1" })]);
  });

  it("records provider failures without enqueueing memory jobs", async () => {
    const { billingService, telemetryService, useCase } = createUseCase(async () => {
      throw new Error("model timeout");
    });
    await activateFreePlan(billingService);

    const result = await useCase.handle(validDevice, validRequest);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected provider failure");
    expect(result.status).toBe(503);
    expect(result.code).toBe("provider_failure");
    expect((await telemetryService.listEvents()).map((event) => event.eventType)).toEqual([
      "suggestion_error",
    ]);
  });
});
