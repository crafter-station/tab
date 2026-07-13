import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { createApp } from "../apps/api/src/index.ts";
import { createAuthInstance, migrateAuth } from "../apps/api/src/auth.ts";
import { DeviceTokenService, InMemoryDeviceTokenStorage } from "../apps/api/src/device-tokens.ts";
import { BillingService, InMemoryBillingStorage } from "../apps/api/src/billing.ts";
import { InMemoryTelemetryStorage } from "../apps/api/src/telemetry.ts";
import { InMemoryPersonalMemoryStorage } from "../apps/api/src/personal-memory.ts";

const TEST_ORIGIN = "http://localhost:8787";

async function createApiFixture() {
  const database = new Database(":memory:");
  const auth = createAuthInstance({ database, baseURL: TEST_ORIGIN });
  await migrateAuth(auth);
  const deviceTokenStorage = new InMemoryDeviceTokenStorage();
  const deviceTokenService = new DeviceTokenService({ storage: deviceTokenStorage });
  const billingStorage = new InMemoryBillingStorage();
  const billingService = new BillingService({ storage: billingStorage });
  const app = createApp({
    auth,
    deviceTokenService,
    billingService,
    personalMemoryStorage: new InMemoryPersonalMemoryStorage(),
    telemetryStorage: new InMemoryTelemetryStorage(),
  });
  return { app, auth, deviceTokenService, billingStorage, billingService };
}

async function signUpAndAuthorize(
  app: ReturnType<typeof createApp>,
  deviceTokenService: DeviceTokenService,
  billingService: BillingService,
) {
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
  it("returns trial capabilities and independent allowances for an authenticated device", async () => {
    const { app, deviceTokenService, billingStorage, billingService } = await createApiFixture();
    const { token } = await signUpAndAuthorize(app, deviceTokenService, billingService);

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
    const entitlement = body.data.entitlement as Record<string, any>;
    expect(entitlement.planId).toBe("pro");
    expect(entitlement.entitlementSource).toBe("trial");
    expect(entitlement.localAcceptedWords.limit).toBeNull();
    expect(entitlement.deepCompletes.limit).toBe(300);
    expect(entitlement.devices.limit).toBe(3);
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
    const { app, billingService, deviceTokenService } = await createApiFixture();
    const { token, email } = await signUpAndAuthorize(app, deviceTokenService, billingService);

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
