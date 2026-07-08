import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { createApp } from "../apps/api/src/index.ts";
import { createAuthInstance, migrateAuth } from "../apps/api/src/auth.ts";
import { DeviceTokenService, InMemoryDeviceTokenStorage } from "../apps/api/src/device-tokens.ts";
import { InMemoryPersonalMemoryStorage } from "../apps/api/src/personal-memory.ts";
import { BillingService, InMemoryBillingStorage } from "../apps/api/src/billing.ts";
import {
  ApiResponseSchema,
  MemoryDeleteResponseSchema,
  MemoryListResponseSchema,
} from "../packages/contracts/src/index.ts";
import { InMemoryTelemetryStorage } from "../apps/api/src/telemetry.ts";
import type {
  SuggestionGenerator,
  SuggestionInput,
} from "../apps/api/src/index.ts";

async function createAuthenticatedTestApp(
  generateSuggestion?: SuggestionGenerator,
) {
  const database = new Database(":memory:");
  const auth = createAuthInstance({ database });
  await migrateAuth(auth);
  const deviceTokenStorage = new InMemoryDeviceTokenStorage();
  const deviceTokenService = new DeviceTokenService({ storage: deviceTokenStorage });
  const billingStorage = new InMemoryBillingStorage();
  const billingService = new BillingService({ storage: billingStorage });
  const personalMemoryStorage = new InMemoryPersonalMemoryStorage();
  const app = createApp({
    generateSuggestion,
    auth,
    billingService,
    deviceTokenService,
    personalMemoryStorage,
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
  return { app, token, personalMemoryStorage, deviceTokenService };
}

async function createSecondUserToken(deviceTokenService: DeviceTokenService) {
  const { token } = await deviceTokenService.createDeviceToken("user-2", {
    deviceId: "device-2",
    platform: "darwin",
    appVersion: "0.0.1",
  });
  return token;
}

function authHeaders(token: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

const validSuggestionRequest = {
  requestId: "req-memory",
  deviceId: "device-1",
  typingContext: "Hello Acme",
  contextSource: "typed_text" as const,
  redaction: { applied: false, redactionCount: 0, kinds: [] as string[] },
  activeApplication: { bundleId: "com.apple.TextEdit" },
  memoryEnabled: true,
};

describe("Personal Memory API", () => {
  it("lists only the authenticated user's memories", async () => {
    const { app, token, personalMemoryStorage } =
      await createAuthenticatedTestApp();

    await personalMemoryStorage.createMemory({
      userId: "user-1",
      content: "Uses Tabb for work",
      category: "work",
      source: "typed_text",
      sensitivity: "normal",
    });
    await personalMemoryStorage.createMemory({
      userId: "user-1",
      content: "Lives in Portland",
      category: "personal",
      source: "typed_text",
      sensitivity: "normal",
    });
    await personalMemoryStorage.createMemory({
      userId: "user-2",
      content: "User two memory",
      category: "work",
      source: "typed_text",
      sensitivity: "normal",
    });

    const response = await app.request("/api/memory", {
      headers: authHeaders(token),
    });

    expect(response.status).toBe(200);
    const body = MemoryListResponseSchema.parse(await response.json());
    expect(body.data.memories).toHaveLength(2);
    expect(
      body.data.memories.every((memory) => memory.userId === "user-1"),
    ).toBe(true);
  });

  it("deletes the user's own memory", async () => {
    const { app, token, personalMemoryStorage } =
      await createAuthenticatedTestApp();

    const memory = await personalMemoryStorage.createMemory({
      userId: "user-1",
      content: "Temporary note",
      category: "notes",
      source: "typed_text",
      sensitivity: "normal",
    });

    const response = await app.request(`/api/memory/${memory.id}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });

    expect(response.status).toBe(200);
    const body = MemoryDeleteResponseSchema.parse(await response.json());
    expect(body.data.deleted).toBe(true);

    const listResponse = await app.request("/api/memory", {
      headers: authHeaders(token),
    });
    const listBody = MemoryListResponseSchema.parse(await listResponse.json());
    expect(listBody.data.memories).toHaveLength(0);
  });

  it("rejects deletion of another user's memory", async () => {
    const { app, token, personalMemoryStorage, deviceTokenService } =
      await createAuthenticatedTestApp();
    const otherToken = await createSecondUserToken(deviceTokenService);

    const otherMemory = await personalMemoryStorage.createMemory({
      userId: "user-2",
      content: "Private user two note",
      category: "personal",
      source: "typed_text",
      sensitivity: "normal",
    });

    const response = await app.request(`/api/memory/${otherMemory.id}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });

    expect(response.status).toBe(404);
    const body = ApiResponseSchema.parse(await response.json());
    expect(body.status).toBe("error");
    if (body.status !== "error") throw new Error("Expected error response");
    expect(body.error.code).toBe("invalid_request");

    const otherListResponse = await app.request("/api/memory", {
      headers: authHeaders(otherToken),
    });
    const otherListBody = MemoryListResponseSchema.parse(
      await otherListResponse.json(),
    );
    expect(otherListBody.data.memories).toHaveLength(1);
  });

  it("rejects unauthenticated list requests", async () => {
    const { app } = await createAuthenticatedTestApp();

    const response = await app.request("/api/memory");

    expect(response.status).toBe(401);
    const body = ApiResponseSchema.parse(await response.json());
    expect(body.status).toBe("error");
    if (body.status !== "error") throw new Error("Expected error response");
    expect(body.error.code).toBe("unauthenticated");
  });

  it("includes relevant memories in the suggestion prompt", async () => {
    let capturedInput: SuggestionInput | null = null;
    const { app, token, personalMemoryStorage } =
      await createAuthenticatedTestApp(async (input) => {
        capturedInput = input;
        return { text: " suggestion" };
      });

    await personalMemoryStorage.createMemory({
      userId: "user-1",
      content: "Acme Corp is a customer",
      category: "work",
      source: "typed_text",
      sensitivity: "normal",
    });

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(validSuggestionRequest),
    });

    expect(response.status).toBe(200);
    expect(capturedInput).not.toBeNull();
    expect(capturedInput?.memories).toHaveLength(1);
    expect(capturedInput?.memories[0].content).toBe("Acme Corp is a customer");
  });

  it("matches relevant memories without requiring exact accent marks", async () => {
    let capturedInput: SuggestionInput | null = null;
    const { app, token, personalMemoryStorage } =
      await createAuthenticatedTestApp(async (input) => {
        capturedInput = input;
        return { text: " suggestion" };
      });

    await personalMemoryStorage.createMemory({
      userId: "user-1",
      content: "Jos\u00e9 prefers caf\u00e9 meetings",
      category: "personal",
      source: "typed_text",
      sensitivity: "normal",
    });

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        ...validSuggestionRequest,
        typingContext: "Ask Jose about cafe plans",
      }),
    });

    expect(response.status).toBe(200);
    expect(capturedInput).not.toBeNull();
    expect(capturedInput?.memories).toHaveLength(1);
    expect(capturedInput?.memories[0].content).toBe(
      "Jos\u00e9 prefers caf\u00e9 meetings",
    );
  });

  it("does not include irrelevant memories in the suggestion prompt", async () => {
    let capturedInput: SuggestionInput | null = null;
    const { app, token, personalMemoryStorage } =
      await createAuthenticatedTestApp(async (input) => {
        capturedInput = input;
        return { text: " suggestion" };
      });

    await personalMemoryStorage.createMemory({
      userId: "user-1",
      content: "Zephyr internals",
      category: "engineering",
      source: "typed_text",
      sensitivity: "normal",
    });

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        ...validSuggestionRequest,
        typingContext: "Hello world",
      }),
    });

    expect(response.status).toBe(200);
    expect(capturedInput).not.toBeNull();
    expect(capturedInput?.memories).toHaveLength(0);
  });

  it("does not include inactive memories even when relevant", async () => {
    let capturedInput: SuggestionInput | null = null;
    const { app, token, personalMemoryStorage } =
      await createAuthenticatedTestApp(async (input) => {
        capturedInput = input;
        return { text: " suggestion" };
      });

    await personalMemoryStorage.createMemory({
      userId: "user-1",
      content: "Acme Corp is a customer",
      category: "work",
      source: "typed_text",
      sensitivity: "normal",
      active: false,
    });

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(validSuggestionRequest),
    });

    expect(response.status).toBe(200);
    expect(capturedInput).not.toBeNull();
    expect(capturedInput?.memories).toHaveLength(0);
  });

  it("skips memory lookup when memoryEnabled is false", async () => {
    let capturedInput: SuggestionInput | null = null;
    const { app, token, personalMemoryStorage } =
      await createAuthenticatedTestApp(async (input) => {
        capturedInput = input;
        return { text: " suggestion" };
      });

    await personalMemoryStorage.createMemory({
      userId: "user-1",
      content: "Acme Corp is a customer",
      category: "work",
      source: "typed_text",
      sensitivity: "normal",
    });

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        ...validSuggestionRequest,
        memoryEnabled: false,
      }),
    });

    expect(response.status).toBe(200);
    expect(capturedInput).not.toBeNull();
    expect(capturedInput?.memories).toHaveLength(0);
  });
});
