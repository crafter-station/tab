import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { createApp } from "../apps/api/src/index.ts";
import { createAuthInstance, migrateAuth } from "../apps/api/src/auth.ts";
import { DeviceTokenService } from "../apps/api/src/device-tokens.ts";
import { createDesktopAuthClient } from "../apps/desktop/src/main/auth.ts";
import { createMemoryKeychain } from "../apps/desktop/src/main/keychain.ts";
import { createApiSuggestionClient } from "../apps/desktop/src/main/suggestion-client.ts";
import type { TypingContextState } from "../apps/desktop/src/main/typing-context.ts";

const TEST_ORIGIN = "http://localhost:8787";

async function createApiFixture() {
  const database = new Database(":memory:");
  const auth = createAuthInstance({ database, baseURL: TEST_ORIGIN });
  await migrateAuth(auth);
  const deviceTokenService = new DeviceTokenService();
  const app = createApp({ auth, deviceTokenService });
  return { app, auth, deviceTokenService };
}

async function signUpAndSignIn(app: ReturnType<typeof createApp>) {
  const email = `desktop-${crypto.randomUUID()}@example.com`;
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
  return { cookie };
}

function makeFetch(app: ReturnType<typeof createApp>) {
  return async (input: string | URL | Request, init?: RequestInit) =>
    app.request(input, init) as unknown as Promise<Response>;
}

function makeState(overrides: Partial<TypingContextState> = {}): TypingContextState {
  return {
    context: "hello",
    activeApplication: { bundleId: "com.apple.TextEdit" },
    secureInput: false,
    paused: false,
    privateContext: false,
    contextSource: "typed_text",
    memoryEligible: true,
    ...overrides,
  };
}

describe("desktop auth client", () => {
  it("builds a browser login URL with device id and callback scheme", async () => {
    const opened: string[] = [];
    const client = createDesktopAuthClient({
      apiBaseUrl: TEST_ORIGIN,
      webBaseUrl: "http://localhost:3000",
      deviceId: "desktop-device-1",
      appVersion: "0.0.1",
      platform: "darwin",
      keychain: createMemoryKeychain(),
      openExternal: (url) => {
        opened.push(url);
      },
    });

    const url = await client.openBrowserLogin();

    expect(url).toContain("desktop-device-1");
    expect(decodeURIComponent(url)).toContain("tabb://auth/callback");
    expect(opened).toEqual([url]);
  });

  it("exchanges a callback code for a device token and stores it in keychain", async () => {
    const { app } = await createApiFixture();
    const { cookie } = await signUpAndSignIn(app);

    const authorizeResponse = await app.request("/api/auth/device/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
    });
    const { code } = (await authorizeResponse.json()) as { code: string };

    const keychain = createMemoryKeychain();
    const client = createDesktopAuthClient({
      apiBaseUrl: TEST_ORIGIN,
      webBaseUrl: "http://localhost:3000",
      deviceId: "desktop-device-1",
      appVersion: "0.0.1",
      platform: "darwin",
      keychain,
      fetch: makeFetch(app),
    });

    const token = await client.handleCallback(`tabb://auth/callback?code=${code}`);

    expect(token.length).toBeGreaterThan(0);
    expect(await keychain.get("tabb", "device-token")).toBe(token);
    expect(await client.getAuthorizationHeader()).toBe(`Bearer ${token}`);
    expect(await client.isAuthenticated()).toBe(true);
  });

  it("uses the stored device token when calling the suggestion API", async () => {
    const { app } = await createApiFixture();
    const { cookie } = await signUpAndSignIn(app);

    const authorizeResponse = await app.request("/api/auth/device/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
    });
    const { code } = (await authorizeResponse.json()) as { code: string };

    const keychain = createMemoryKeychain();
    const authClient = createDesktopAuthClient({
      apiBaseUrl: TEST_ORIGIN,
      webBaseUrl: "http://localhost:3000",
      deviceId: "desktop-device-1",
      appVersion: "0.0.1",
      platform: "darwin",
      keychain,
      fetch: makeFetch(app),
    });
    await authClient.handleCallback(`tabb://auth/callback?code=${code}`);

    const suggestionClient = createApiSuggestionClient({
      apiBaseUrl: TEST_ORIGIN,
      deviceId: "desktop-device-1",
      appVersion: "0.0.1",
      platform: "darwin",
      getState: () => makeState(),
      fetch: makeFetch(app),
      getAuthorizationHeader: () => authClient.getAuthorizationHeader(),
    });

    const suggestion = await suggestionClient("hello");
    expect(suggestion).toBeNull();
  });

  it("fails silently when the device token is revoked", async () => {
    const { app, deviceTokenService } = await createApiFixture();
    const { cookie } = await signUpAndSignIn(app);

    const authorizeResponse = await app.request("/api/auth/device/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
    });
    const { code } = (await authorizeResponse.json()) as { code: string };

    const keychain = createMemoryKeychain();
    const authClient = createDesktopAuthClient({
      apiBaseUrl: TEST_ORIGIN,
      webBaseUrl: "http://localhost:3000",
      deviceId: "desktop-device-revoked",
      appVersion: "0.0.1",
      platform: "darwin",
      keychain,
      fetch: makeFetch(app),
    });
    await authClient.handleCallback(`tabb://auth/callback?code=${code}`);

    await app.request("/api/auth/device/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ deviceId: "desktop-device-revoked" }),
    });

    const suggestionClient = createApiSuggestionClient({
      apiBaseUrl: TEST_ORIGIN,
      deviceId: "desktop-device-revoked",
      appVersion: "0.0.1",
      platform: "darwin",
      getState: () => makeState(),
      fetch: makeFetch(app),
      getAuthorizationHeader: () => authClient.getAuthorizationHeader(),
    });

    const suggestion = await suggestionClient("hello");
    expect(suggestion).toBeNull();
  });

  it("reports sign-in-required when no token is stored", async () => {
    const keychain = createMemoryKeychain();
    const client = createDesktopAuthClient({
      apiBaseUrl: TEST_ORIGIN,
      webBaseUrl: "http://localhost:3000",
      deviceId: "desktop-device-unsigned",
      appVersion: "0.0.1",
      platform: "darwin",
      keychain,
    });

    expect(await client.isAuthenticated()).toBe(false);
    expect(await client.getAuthorizationHeader()).toBeNull();
  });
});
