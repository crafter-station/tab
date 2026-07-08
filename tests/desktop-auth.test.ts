import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { createApp } from "../apps/api/src/index.ts";
import { createAuthInstance, migrateAuth } from "../apps/api/src/auth.ts";
import { DeviceTokenService, InMemoryDeviceTokenStorage } from "../apps/api/src/device-tokens.ts";
import { BillingService, InMemoryBillingStorage } from "../apps/api/src/billing.ts";
import { InMemoryPersonalMemoryStorage } from "../apps/api/src/personal-memory.ts";
import { InMemoryTelemetryStorage } from "../apps/api/src/telemetry.ts";
import { createDesktopAuthClient } from "../apps/desktop/src/main/auth.ts";
import { createMemoryKeychain } from "../apps/desktop/src/main/keychain.ts";
import { createApiSuggestionClient } from "../apps/desktop/src/main/suggestion-client.ts";
import {
  createSafeTypingContextSnapshot,
  type RequestableTypingContextSnapshot,
  type TypingContextState,
} from "../apps/desktop/src/main/typing-context.ts";

const TEST_ORIGIN = "http://localhost:8787";

async function createApiFixture(generateSuggestion?: Parameters<typeof createApp>[0]["generateSuggestion"]) {
  const database = new Database(":memory:");
  const auth = createAuthInstance({ database, baseURL: TEST_ORIGIN });
  await migrateAuth(auth);
  const deviceTokenService = new DeviceTokenService({ storage: new InMemoryDeviceTokenStorage() });
  const billingService = new BillingService({ storage: new InMemoryBillingStorage() });
  const personalMemoryStorage = new InMemoryPersonalMemoryStorage();
  const telemetryStorage = new InMemoryTelemetryStorage();
  const app = createApp({
    auth,
    billingService,
    deviceTokenService,
    generateSuggestion,
    personalMemoryStorage,
    telemetryStorage,
  });
  return { app, auth, billingService, deviceTokenService };
}

async function signUpAndSignIn(app: ReturnType<typeof createApp>, billingService: BillingService) {
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

function makeSnapshot(
  overrides: Partial<TypingContextState> = {},
): RequestableTypingContextSnapshot {
  const snapshot = createSafeTypingContextSnapshot(makeState(overrides));
  if (!snapshot.requestable || !snapshot.activeApplication) {
    throw new Error("test snapshot must be requestable");
  }
  return snapshot as RequestableTypingContextSnapshot;
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
    expect(decodeURIComponent(url)).toContain("tab://auth/callback");
    expect(opened).toEqual([url]);
  });

  it("exchanges a callback code for a device token and stores it in keychain", async () => {
    const { app, billingService } = await createApiFixture();
    const { cookie } = await signUpAndSignIn(app, billingService);

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

    const token = await client.handleCallback(`tab://auth/callback?code=${code}`);

    expect(token.length).toBeGreaterThan(0);
    expect(await keychain.get("tab", "device-token")).toBe(token);
    expect(await client.getAuthorizationHeader()).toBe(`Bearer ${token}`);
    expect(await client.isAuthenticated()).toBe(true);
  });

  it("uses the stored device token when calling the suggestion API", async () => {
    const { app, billingService } = await createApiFixture(async () => ({ text: " world" }));
    const { cookie } = await signUpAndSignIn(app, billingService);

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
    await authClient.handleCallback(`tab://auth/callback?code=${code}`);

    const suggestionClient = createApiSuggestionClient({
      apiBaseUrl: TEST_ORIGIN,
      deviceId: "desktop-device-1",
      appVersion: "0.0.1",
      platform: "darwin",
      fetch: makeFetch(app),
      getAuthorizationHeader: () => authClient.getAuthorizationHeader(),
    });

    const suggestion = await suggestionClient(makeSnapshot());
    expect(suggestion?.text).toBe(" world");
  });

  it("fails silently when the device token is revoked", async () => {
    const { app, billingService, deviceTokenService } = await createApiFixture(async () => ({ text: " world" }));
    const { cookie } = await signUpAndSignIn(app, billingService);

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
    await authClient.handleCallback(`tab://auth/callback?code=${code}`);

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
      fetch: makeFetch(app),
      getAuthorizationHeader: () => authClient.getAuthorizationHeader(),
    });

    const suggestion = await suggestionClient(makeSnapshot());
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
