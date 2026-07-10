import { describe, it, expect, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import { createApp } from "../apps/api/src/index.ts";
import { createAuthInstance, migrateAuth } from "../apps/api/src/auth.ts";
import { DeviceTokenService, InMemoryDeviceTokenStorage } from "../apps/api/src/device-tokens.ts";
import { BillingService, InMemoryBillingStorage } from "../apps/api/src/billing.ts";
import { InMemoryPersonalMemoryStorage } from "../apps/api/src/personal-memory.ts";
import { InMemoryTelemetryStorage } from "../apps/api/src/telemetry.ts";
import {
  createDesktopAuthClient,
  createDesktopAuthSession,
  type CredentialGeneration,
  type ObservedCredentialState,
} from "../apps/desktop/src/main/auth.ts";
import { createMemoryKeychain } from "../apps/desktop/src/main/keychain.ts";
import { createApiSuggestionClient } from "../apps/desktop/src/main/suggestion-client.ts";
import {
  createSafeTypingContextSnapshot,
  type RequestableTypingContextSnapshot,
  type TypingContextState,
} from "../apps/desktop/src/main/typing-context.ts";

const TEST_ORIGIN = "http://localhost:8787";

function generation(value: number): CredentialGeneration {
  return value as CredentialGeneration;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

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
    const observation = await client.getAuthorizationObservation();
    expect(await client.getCredentialState(observation.credentialGeneration)).toBe(
      "current_present",
    );
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
    const observation = await client.getAuthorizationObservation();
    expect(await client.getCredentialState(observation.credentialGeneration)).toBe(
      "current_absent",
    );
  });

  it("serializes replacement storage behind a generation-conditional removal", async () => {
    let token: string | null = "token-a";
    const removeStarted = createDeferred<void>();
    const finishRemove = createDeferred<void>();
    const operations: string[] = [];
    const client = createDesktopAuthClient({
      apiBaseUrl: TEST_ORIGIN,
      webBaseUrl: "http://localhost:3000",
      deviceId: "desktop-device-mutation-order",
      appVersion: "0.0.1",
      platform: "darwin",
      keychain: {
        set: async (_service, _account, value) => {
          operations.push(`set:${value}`);
          token = value;
        },
        get: async () => token,
        remove: async () => {
          operations.push("remove:start");
          removeStarted.resolve();
          await finishRemove.promise;
          token = null;
          operations.push("remove:end");
        },
      },
      fetch: async () => Response.json({ token: "token-b" }),
    });
    const oldObservation = await client.getAuthorizationObservation();

    const clear = client.clearTokenForGeneration(oldObservation.credentialGeneration);
    await removeStarted.promise;
    const replace = client.handleCallback("tab://auth/callback?code=replace");
    await Promise.resolve();

    expect(operations).toEqual(["remove:start"]);
    finishRemove.resolve();
    expect(await clear).toBe(true);
    await replace;

    expect(operations).toEqual(["remove:start", "remove:end", "set:token-b"]);
    expect(await client.getToken()).toBe("token-b");
  });
});

describe("desktop auth session", () => {
  function createFixture(authenticated = true) {
    let hasToken = authenticated;
    let generationValue = 1;
    let clearCount = 0;
    let signedOutCount = 0;
    const session = createDesktopAuthSession({
      authClient: {
        getCredentialState: async (observedGeneration) => {
          if (observedGeneration !== generation(generationValue)) return "stale";
          return hasToken ? "current_present" : "current_absent";
        },
        clearTokenForGeneration: async (observedGeneration) => {
          if (!hasToken || observedGeneration !== generation(generationValue)) return false;
          hasToken = false;
          clearCount += 1;
          generationValue += 1;
          return true;
        },
      },
      onSignedOut: () => {
        signedOutCount += 1;
      },
    });

    return {
      session,
      setAuthenticated(value: boolean) {
        if (hasToken !== value) generationValue += 1;
        hasToken = value;
      },
      get generation() {
        return generation(generationValue);
      },
      get clearCount() {
        return clearCount;
      },
      get signedOutCount() {
        return signedOutCount;
      },
    };
  }

  it("clears a present credential immediately when the device is revoked", async () => {
    const fixture = createFixture();

    await fixture.session.handleStatus("revoked_device", fixture.generation);

    expect(fixture.clearCount).toBe(1);
    expect(fixture.signedOutCount).toBe(1);
  });

  it("clears a credential after three consecutive sign-in-required statuses", async () => {
    const fixture = createFixture();

    await fixture.session.handleStatus("sign_in_required", fixture.generation);
    await fixture.session.handleStatus("sign_in_required", fixture.generation);
    expect(fixture.clearCount).toBe(0);

    await fixture.session.handleStatus("sign_in_required", fixture.generation);

    expect(fixture.clearCount).toBe(1);
    expect(fixture.signedOutCount).toBe(1);
  });

  it("resets consecutive failures when authentication recovers", async () => {
    const fixture = createFixture();

    await fixture.session.handleStatus("sign_in_required", fixture.generation);
    await fixture.session.handleStatus("sign_in_required", fixture.generation);
    await fixture.session.handleStatus("signed_in", fixture.generation);
    await fixture.session.handleStatus("sign_in_required", fixture.generation);

    expect(fixture.clearCount).toBe(0);
  });

  it("does not count sign-in-required statuses without a stored credential", async () => {
    const fixture = createFixture(false);

    await fixture.session.handleStatus("sign_in_required", fixture.generation);
    await fixture.session.handleStatus("sign_in_required", fixture.generation);
    fixture.setAuthenticated(true);
    await fixture.session.handleStatus("sign_in_required", fixture.generation);
    await fixture.session.handleStatus("sign_in_required", fixture.generation);

    expect(fixture.clearCount).toBe(0);
  });

  it("resets failures when the observed current generation has no credential", async () => {
    const firstGeneration = generation(5);
    const restoredGeneration = generation(6);
    let currentGeneration = firstGeneration;
    let hasToken = true;
    let clearCount = 0;
    const session = createDesktopAuthSession({
      authClient: {
        getCredentialState: async (observedGeneration) => {
          if (observedGeneration !== currentGeneration) return "stale";
          return hasToken ? "current_present" : "current_absent";
        },
        clearTokenForGeneration: async () => {
          clearCount += 1;
          return true;
        },
      },
      onSignedOut: () => {},
    });

    await session.handleStatus("sign_in_required", firstGeneration);
    await session.handleStatus("sign_in_required", firstGeneration);
    hasToken = false;
    await session.handleStatus("sign_in_required", firstGeneration);
    currentGeneration = restoredGeneration;
    hasToken = true;
    await session.handleStatus("sign_in_required", restoredGeneration);

    expect(clearCount).toBe(0);
  });

  it("serializes overlapping failures and clears the current credential once", async () => {
    const firstRead = createDeferred<ObservedCredentialState>();
    const credentialGeneration = generation(7);
    let readCount = 0;
    let hasToken = true;
    let clearCount = 0;
    let signedOutCount = 0;
    const session = createDesktopAuthSession({
      authClient: {
        getCredentialState: async () => {
          readCount += 1;
          if (readCount === 1) return firstRead.promise;
          return hasToken ? "current_present" : "current_absent";
        },
        clearTokenForGeneration: async (observedGeneration) => {
          if (!hasToken || observedGeneration !== credentialGeneration) return false;
          hasToken = false;
          clearCount += 1;
          return true;
        },
      },
      onSignedOut: () => {
        signedOutCount += 1;
      },
    });

    const first = session.handleStatus("sign_in_required", credentialGeneration);
    const second = session.handleStatus("sign_in_required", credentialGeneration);
    const third = session.handleStatus("sign_in_required", credentialGeneration);
    let thirdResolved = false;
    void third.then(() => {
      thirdResolved = true;
    });

    await Promise.resolve();
    expect(readCount).toBe(1);
    expect(thirdResolved).toBe(false);
    firstRead.resolve("current_present");
    await Promise.all([first, second, third]);

    expect(clearCount).toBe(1);
    expect(signedOutCount).toBe(1);
    expect(thirdResolved).toBe(true);
  });

  it("applies queued recovery before a later failure while an earlier read is pending", async () => {
    const firstRead = createDeferred<ObservedCredentialState>();
    const credentialGeneration = generation(8);
    let readCount = 0;
    let clearCount = 0;
    const session = createDesktopAuthSession({
      authClient: {
        getCredentialState: async () => {
          readCount += 1;
          return readCount === 1 ? firstRead.promise : "current_present";
        },
        clearTokenForGeneration: async () => {
          clearCount += 1;
          return true;
        },
      },
      onSignedOut: () => {},
    });

    const failure = session.handleStatus("sign_in_required", credentialGeneration);
    const recovery = session.handleStatus("signed_in", credentialGeneration);
    const laterFailure = session.handleStatus("sign_in_required", credentialGeneration);

    await Promise.resolve();
    expect(readCount).toBe(1);
    firstRead.resolve("current_present");
    await Promise.all([failure, recovery, laterFailure]);

    expect(readCount).toBe(3);
    expect(clearCount).toBe(0);
  });

  it("applies queued revocation after an earlier credential read completes", async () => {
    const firstRead = createDeferred<ObservedCredentialState>();
    const credentialGeneration = generation(9);
    let readCount = 0;
    let clearCount = 0;
    const session = createDesktopAuthSession({
      authClient: {
        getCredentialState: async () => {
          readCount += 1;
          return readCount === 1 ? firstRead.promise : "current_present";
        },
        clearTokenForGeneration: async () => {
          clearCount += 1;
          return true;
        },
      },
      onSignedOut: () => {},
    });

    const failure = session.handleStatus("sign_in_required", credentialGeneration);
    const revocation = session.handleStatus("revoked_device", credentialGeneration);

    await Promise.resolve();
    expect(readCount).toBe(1);
    expect(clearCount).toBe(0);
    firstRead.resolve("current_present");
    await Promise.all([failure, revocation]);

    expect(clearCount).toBe(1);
  });

  it("ignores old-token failures and revocation after reauthentication", async () => {
    const keychain = createMemoryKeychain();
    await keychain.set("tab", "device-token", "token-a");
    const authClient = createDesktopAuthClient({
      apiBaseUrl: TEST_ORIGIN,
      webBaseUrl: "http://localhost:3000",
      deviceId: "desktop-device-reauthenticated",
      appVersion: "0.0.1",
      platform: "darwin",
      keychain,
      fetch: async () => Response.json({ token: "token-b" }),
    });
    const oldObservation = await authClient.getAuthorizationObservation();
    await authClient.handleCallback("tab://auth/callback?code=re-authenticate");
    const newObservation = await authClient.getAuthorizationObservation();
    let signedOutCount = 0;
    const session = createDesktopAuthSession({
      authClient,
      onSignedOut: () => {
        signedOutCount += 1;
      },
    });

    expect(await authClient.getCredentialState(oldObservation.credentialGeneration)).toBe(
      "stale",
    );
    await session.handleStatus("sign_in_required", oldObservation.credentialGeneration);
    await session.handleStatus("sign_in_required", oldObservation.credentialGeneration);
    await session.handleStatus("sign_in_required", oldObservation.credentialGeneration);
    await session.handleStatus("revoked_device", oldObservation.credentialGeneration);

    expect(newObservation.credentialGeneration).not.toBe(oldObservation.credentialGeneration);
    expect(await authClient.getToken()).toBe("token-b");
    expect(signedOutCount).toBe(0);
  });

  it("contains authentication-state read failures", async () => {
    const readError = new Error("keychain read failed");
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    let signedOutCount = 0;
    const session = createDesktopAuthSession({
      authClient: {
        getCredentialState: async () => {
          throw readError;
        },
        clearTokenForGeneration: async () => true,
      },
      onSignedOut: () => {
        signedOutCount += 1;
      },
    });

    try {
      await session.handleStatus("revoked_device", generation(10));
      expect(signedOutCount).toBe(0);
      expect(errorLog).toHaveBeenCalledWith(
        "Failed to read desktop authentication state:",
        readError,
      );
    } finally {
      errorLog.mockRestore();
    }
  });

  it("contains conditional-clear failures without notifying signed out", async () => {
    const clearError = new Error("keychain clear failed");
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    let signedOutCount = 0;
    const session = createDesktopAuthSession({
      authClient: {
        getCredentialState: async () => "current_present",
        clearTokenForGeneration: async () => {
          throw clearError;
        },
      },
      onSignedOut: () => {
        signedOutCount += 1;
      },
    });

    try {
      await session.handleStatus("revoked_device", generation(11));
      expect(signedOutCount).toBe(0);
      expect(errorLog).toHaveBeenCalledWith(
        "Failed to clear revoked device token:",
        clearError,
      );
    } finally {
      errorLog.mockRestore();
    }
  });

  it("contains and separately logs signed-out surface failures", async () => {
    const surfaceError = new Error("surface failed");
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    const session = createDesktopAuthSession({
      authClient: {
        getCredentialState: async () => "current_present",
        clearTokenForGeneration: async () => true,
      },
      onSignedOut: () => {
        throw surfaceError;
      },
    });

    try {
      await session.handleStatus("revoked_device", generation(12));
      expect(errorLog).toHaveBeenCalledWith(
        "Failed to show signed-out surface:",
        surfaceError,
      );
      expect(
        errorLog.mock.calls.some(([message]) => message === "Failed to clear revoked device token:"),
      ).toBe(false);
    } finally {
      errorLog.mockRestore();
    }
  });
});
