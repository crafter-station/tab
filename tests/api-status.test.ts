import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { createApp } from "../apps/api/src/index.ts";
import { createAuthInstance, migrateAuth } from "../apps/api/src/auth.ts";
import { DeviceTokenService } from "../apps/api/src/device-tokens.ts";
import { BillingService, InMemoryBillingStorage } from "../apps/api/src/billing.ts";

const TEST_ORIGIN = "http://localhost:8787";

async function createApiFixture() {
  const database = new Database(":memory:");
  const auth = createAuthInstance({ database, baseURL: TEST_ORIGIN });
  await migrateAuth(auth);
  const deviceTokenService = new DeviceTokenService();
  const billingStorage = new InMemoryBillingStorage();
  const billingService = new BillingService({ storage: billingStorage });
  const app = createApp({ auth, deviceTokenService, billingService });
  return { app, auth, deviceTokenService, billingStorage, billingService };
}

async function signUpAndAuthorize(app: ReturnType<typeof createApp>, deviceTokenService: DeviceTokenService) {
  const email = `status-${crypto.randomUUID()}@example.com`;
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
    body: JSON.stringify({ code, deviceId: "status-device", platform: "darwin", appVersion: "0.0.1" }),
  });
  const { token } = (await exchangeResponse.json()) as { token: string };

  return { token, email };
}

describe("API status endpoint", () => {
  it("returns signed-in status with quota for an authenticated device", async () => {
    const { app, deviceTokenService, billingStorage } = await createApiFixture();
    const { token } = await signUpAndAuthorize(app, deviceTokenService);

    const response = await app.request("/api/status", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; data: Record<string, unknown> };
    expect(body.status).toBe("ok");
    expect(body.data.authenticated).toBe(true);
    expect(body.data.deviceRevoked).toBe(false);
    expect(typeof body.data.userId).toBe("string");
    expect(body.data.userId.length).toBeGreaterThan(0);
    expect(body.data.planId).toBe("free");
    expect(body.data.quota).toBe(100);
    expect(body.data.usage).toBe(0);
    expect(typeof body.data.resetAt).toBe("string");
  });

  it("returns unauthenticated without a device token", async () => {
    const { app } = await createApiFixture();

    const response = await app.request("/api/status");

    expect(response.status).toBe(401);
    const body = (await response.json()) as { status: string; error: { code: string } };
    expect(body.status).toBe("error");
    expect(body.error.code).toBe("unauthenticated");
  });

  it("returns revoked_device when the device token has been revoked", async () => {
    const { app, deviceTokenService } = await createApiFixture();
    const { token, email } = await signUpAndAuthorize(app, deviceTokenService);

    // Re-sign in to obtain a session cookie for revocation.
    const signInResponse = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: TEST_ORIGIN },
      body: JSON.stringify({ email, password: "password123456", rememberMe: true }),
    });
    const cookie = signInResponse.headers.get("set-cookie");
    if (!cookie) throw new Error("Missing session cookie");

    await app.request("/api/auth/device/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ deviceId: "status-device" }),
    });

    const response = await app.request("/api/status", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(401);
    const body = (await response.json()) as { status: string; error: { code: string } };
    expect(body.status).toBe("error");
    expect(body.error.code).toBe("revoked_device");
  });
});
