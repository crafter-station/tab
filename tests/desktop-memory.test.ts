import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { createApp } from "../apps/api/src/index.ts";
import { createAuthInstance, migrateAuth } from "../apps/api/src/auth.ts";
import { DeviceTokenService } from "../apps/api/src/device-tokens.ts";
import { PersonalMemoryService, InMemoryPersonalMemoryStorage } from "../apps/api/src/personal-memory.ts";
import { createDesktopMemoryClient } from "../apps/desktop/src/memory-client.ts";

const TEST_ORIGIN = "http://localhost:8787";

async function createApiFixture() {
  const database = new Database(":memory:");
  const auth = createAuthInstance({ database, baseURL: TEST_ORIGIN });
  await migrateAuth(auth);
  const deviceTokenService = new DeviceTokenService();
  const personalMemoryStorage = new InMemoryPersonalMemoryStorage();
  const personalMemoryService = new PersonalMemoryService({ storage: personalMemoryStorage });
  const app = createApp({ auth, deviceTokenService, personalMemoryStorage });
  return { app, auth, deviceTokenService, personalMemoryService };
}

function makeFetch(app: ReturnType<typeof createApp>) {
  return async (input: string | URL | Request, init?: RequestInit) =>
    app.request(input, init) as unknown as Promise<Response>;
}

async function signUpAndAuthorize(app: ReturnType<typeof createApp>, deviceTokenService: DeviceTokenService) {
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
    const { app, deviceTokenService, personalMemoryService } = await createApiFixture();
    const { token } = await signUpAndAuthorize(app, deviceTokenService);

    // Seed a memory through the service so we know the user id without exporting it.
    const statusResponse = await app.request("/api/status", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const userId = ((await statusResponse.json()) as { data: { userId?: string } }).data.userId ?? "unknown";

    await personalMemoryService.createMemory({
      userId,
      content: "I prefer concise emails",
      category: "preferences",
      source: "manual",
      sensitivity: "normal",
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
    const { app, deviceTokenService, personalMemoryService } = await createApiFixture();
    const { token } = await signUpAndAuthorize(app, deviceTokenService);

    const statusResponse = await app.request("/api/status", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const userId = ((await statusResponse.json()) as { data: { userId?: string } }).data.userId ?? "unknown";

    const memory = await personalMemoryService.createMemory({
      userId,
      content: "My team uses Slack",
      category: "work",
      source: "manual",
      sensitivity: "normal",
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
    const { app, deviceTokenService } = await createApiFixture();
    const { token, cookie } = await signUpAndAuthorize(app, deviceTokenService);

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
});
