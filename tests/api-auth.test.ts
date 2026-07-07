import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { createApp } from "../apps/api/src/index.ts";
import { createAuthInstance, migrateAuth } from "../apps/api/src/auth.ts";
import { DeviceTokenService } from "../apps/api/src/device-tokens.ts";
import {
  ApiResponseSchema,
  DeviceAuthorizeResponseSchema,
  DeviceTokenExchangeResponseSchema,
} from "../packages/contracts/src/index.ts";

const TEST_ORIGIN = "http://localhost:8787";

async function createAuthApp() {
  const database = new Database(":memory:");
  const auth = createAuthInstance({
    database,
    baseURL: TEST_ORIGIN,
    requireEmailVerification: false,
  });
  await migrateAuth(auth);
  const deviceTokenService = new DeviceTokenService();
  const app = createApp({ auth, deviceTokenService });
  return { app, auth, deviceTokenService };
}

async function signUpAndSignIn(app: ReturnType<typeof createApp>) {
  const email = `user-${crypto.randomUUID()}@example.com`;
  const password = "password123456";

  const signUpResponse = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      origin: TEST_ORIGIN,
    },
    body: JSON.stringify({
      name: "Test User",
      email,
      password,
    }),
  });

  expect(signUpResponse.status).toBe(200);
  const signUpBody = (await signUpResponse.json()) as { user?: { id: string } };
  expect(signUpBody.user?.id).toBeDefined();

  const signInResponse = await app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      origin: TEST_ORIGIN,
    },
    body: JSON.stringify({ email, password, rememberMe: true }),
  });

  expect(signInResponse.status).toBe(200);
  const cookie = signInResponse.headers.get("set-cookie");
  expect(cookie).toBeTruthy();

  return { cookie: cookie!, userId: signUpBody.user!.id };
}

describe("Better Auth browser handoff and device tokens", () => {
  it("mounts Better Auth sign-up and sign-in endpoints", async () => {
    const { app } = await createAuthApp();

    const response = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: TEST_ORIGIN,
      },
      body: JSON.stringify({
        name: "Test User",
        email: `signup-${crypto.randomUUID()}@example.com`,
        password: "password123456",
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { user?: { id: string; email: string } };
    expect(body.user?.email).toBeDefined();
  });

  it("issues an exchange code to a signed-in browser", async () => {
    const { app } = await createAuthApp();
    const { cookie } = await signUpAndSignIn(app);

    const response = await app.request("/api/auth/device/authorize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
    });

    expect(response.status).toBe(200);
    const body = DeviceAuthorizeResponseSchema.parse(await response.json());
    expect(body.code).toBeDefined();
    expect(body.code.length).toBeGreaterThan(0);
  });

  it("rejects device authorization when not signed in", async () => {
    const { app } = await createAuthApp();

    const response = await app.request("/api/auth/device/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(401);
    const body = ApiResponseSchema.parse(await response.json());
    expect(body.status).toBe("error");
    if (body.status !== "error") throw new Error("Expected error response");
    expect(body.error.code).toBe("unauthenticated");
  });

  it("exchanges a callback code for a device token", async () => {
    const { app, deviceTokenService } = await createAuthApp();
    const { cookie, userId } = await signUpAndSignIn(app);

    const authorizeResponse = await app.request("/api/auth/device/authorize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
    });

    const { code } = DeviceAuthorizeResponseSchema.parse(
      await authorizeResponse.json(),
    );

    const exchangeResponse = await app.request("/api/auth/device/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        deviceId: "desktop-device-1",
        platform: "darwin",
        appVersion: "0.0.1",
      }),
    });

    expect(exchangeResponse.status).toBe(200);
    const body = DeviceTokenExchangeResponseSchema.parse(
      await exchangeResponse.json(),
    );
    expect(body.token).toBeDefined();
    expect(body.token.length).toBeGreaterThan(0);

    // The service stores a hash, not the raw token.
    const devices = await deviceTokenService.listDevices(userId);
    expect(devices).toHaveLength(1);
    expect(devices[0].tokenHash).not.toBe(body.token);
    expect(devices[0].tokenHash.length).toBeGreaterThan(0);
    expect(devices[0].revoked).toBe(false);
  });

  it("rejects an invalid or expired exchange code", async () => {
    const { app } = await createAuthApp();

    const response = await app.request("/api/auth/device/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: "invalid-code",
        deviceId: "desktop-device-1",
        platform: "darwin",
        appVersion: "0.0.1",
      }),
    });

    expect(response.status).toBe(400);
    const body = ApiResponseSchema.parse(await response.json());
    expect(body.status).toBe("error");
    if (body.status !== "error") throw new Error("Expected error response");
    expect(body.error.code).toBe("invalid_request");
  });

  it("revokes a device and rejects its token at the suggestion API", async () => {
    const { app, deviceTokenService } = await createAuthApp();
    const { cookie, userId } = await signUpAndSignIn(app);

    const authorizeResponse = await app.request("/api/auth/device/authorize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
    });
    const { code } = DeviceAuthorizeResponseSchema.parse(
      await authorizeResponse.json(),
    );

    const exchangeResponse = await app.request("/api/auth/device/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        deviceId: "desktop-device-2",
        platform: "darwin",
        appVersion: "0.0.1",
      }),
    });
    const { token } = DeviceTokenExchangeResponseSchema.parse(
      await exchangeResponse.json(),
    );

    const revokeResponse = await app.request("/api/auth/device/revoke", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({ deviceId: "desktop-device-2" }),
    });
    expect(revokeResponse.status).toBe(200);

    const suggestionResponse = await app.request("/suggestions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        requestId: "req-auth",
        deviceId: "desktop-device-2",
        typingContext: "Hello",
        contextSource: "typed_text",
        redaction: { applied: false, redactionCount: 0, kinds: [] },
        activeApplication: { bundleId: "com.apple.TextEdit" },
        memoryEnabled: true,
      }),
    });

    expect(suggestionResponse.status).toBe(401);
    const body = ApiResponseSchema.parse(await suggestionResponse.json());
    expect(body.status).toBe("error");
    if (body.status !== "error") throw new Error("Expected error response");
    expect(body.error.code).toBe("revoked_device");

    const devices = await deviceTokenService.listDevices(userId);
    expect(devices[0].revoked).toBe(true);
  });
});
