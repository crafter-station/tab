import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { ApiResponseSchema } from "../packages/contracts/src/index.ts";
import { createApp } from "../apps/api/src/index.ts";
import { createAuthInstance, migrateAuth } from "../apps/api/src/auth.ts";
import { DeviceTokenService } from "../apps/api/src/device-tokens.ts";
import type { SuggestionGenerator, SuggestionInput } from "../apps/api/src/index.ts";

async function createAuthenticatedTestApp(generateSuggestion: SuggestionGenerator) {
  const database = new Database(":memory:");
  const auth = createAuthInstance({ database });
  await migrateAuth(auth);
  const deviceTokenService = new DeviceTokenService();
  const app = createApp({ generateSuggestion, auth, deviceTokenService });
  const { token } = await deviceTokenService.createDeviceToken("user-1", {
    deviceId: "device-1",
    platform: "darwin",
    appVersion: "0.0.1",
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

function authHeaders(token: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

describe("Hono suggestion API", () => {
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

  it("rejects unauthenticated requests", async () => {
    const database = new Database(":memory:");
    const auth = createAuthInstance({ database });
    await migrateAuth(auth);
    const app = createApp({
      generateSuggestion: async () => ({ text: " world" }),
      auth,
      deviceTokenService: new DeviceTokenService(),
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
    const deviceTokenService = new DeviceTokenService();
    const app = createApp({
      generateSuggestion: async () => ({ text: " world" }),
      auth,
      deviceTokenService,
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
