import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { getPlatformProxy } from "wrangler";
import type { D1Database } from "@cloudflare/workers-types";
import { ApiResponseSchema } from "../packages/contracts/src/index.ts";
import { createApp } from "../apps/api/src/index.ts";
import { createAuthInstance, migrateAuth } from "../apps/api/src/auth.ts";
import { createDatabase } from "../apps/api/src/db/index.ts";
import { DeviceTokenService, InMemoryDeviceTokenStorage } from "../apps/api/src/device-tokens.ts";
import {
  BillingService,
  D1BillingStorage,
  InMemoryBillingStorage,
  InMemoryUsageMeterClient,
  PolarUsageMeterClient,
  PolarBillingCheckoutClient,
  UsageMeterService,
  createBillingCheckoutClient,
  type BillingProvisioningClient,
} from "../apps/api/src/billing.ts";
import { InMemoryPersonalMemoryStorage } from "../apps/api/src/personal-memory.ts";
import { InMemoryTelemetryStorage } from "../apps/api/src/telemetry.ts";
import { createTestDatabase } from "./test-db.ts";
import type { SuggestionGenerator } from "../apps/api/src/index.ts";

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

function authHeaders(token: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

async function createBillingTestApp(generateSuggestion: SuggestionGenerator) {
  const database = new Database(":memory:");
  const auth = createAuthInstance({ database });
  await migrateAuth(auth);
  const deviceTokenStorage = new InMemoryDeviceTokenStorage();
  const deviceTokenService = new DeviceTokenService({ storage: deviceTokenStorage });
  const billingStorage = new InMemoryBillingStorage();
  const billingService = new BillingService({ storage: billingStorage });
  const usageMeterClient = new InMemoryUsageMeterClient();
  const usageMeterService = new UsageMeterService({
    client: usageMeterClient,
    retryDelayMs: 10,
  });
  const app = createApp({
    generateSuggestion,
    auth,
    deviceTokenService,
    billingService,
    personalMemoryStorage: new InMemoryPersonalMemoryStorage(),
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
    status: "inactive",
    cachedAt: new Date(),
  });
  return {
    app,
    token,
    billingService,
    billingStorage,
    usageMeterClient,
    usageMeterService,
  };
}

async function parseApiResponse(response: Response) {
  return ApiResponseSchema.parse(await response.json());
}

describe("Billing and allowance enforcement", () => {
  it("starts on Free and grants trial access only from a Polar subscription", async () => {
    const now = new Date("2026-07-01T00:00:00.000Z");
    const storage = new InMemoryBillingStorage();
    const billing = new BillingService({ storage, now: () => now });

    const free = await billing.getStatus("trial-user");
    expect(free.planId).toBe("free");
    expect(free.entitlementSource).toBe("free");
    expect(free.trial).toEqual({ active: false });

    await billing.applyPaidEntitlementEvent({
      type: "subscription.created",
      data: {
        customer: { external_id: "trial-user" },
        customer_id: "polar-customer-1",
        id: "polar-subscription-1",
        status: "trialing",
        product: { name: "Tab Pro" },
        trial_start: "2026-07-01T00:00:00.000Z",
        trial_end: "2026-08-01T00:00:00.000Z",
      },
    });

    const trial = await billing.getStatus("trial-user");
    expect(trial.planId).toBe("pro");
    expect(trial.entitlementSource).toBe("trial");
    expect(trial.trial).toEqual({
      active: true,
      startedAt: "2026-07-01T00:00:00.000Z",
      endsAt: "2026-08-01T00:00:00.000Z",
    });
  });

  it("keeps local and Deep Complete usage independent and reconciles duplicates", async () => {
    const storage = new InMemoryBillingStorage();
    const billing = new BillingService({
      storage,
      now: () => new Date("2026-07-12T12:00:00.000Z"),
    });
    await billing.applyEntitlement({
      userId: "free-user",
      planId: "free",
      status: "inactive",
      cachedAt: new Date(),
    });

    await billing.recordLocalAcceptedWords({
      userId: "free-user",
      acceptanceId: "accept-1",
      localDay: "2026-07-12",
      words: 102,
    });
    await billing.recordLocalAcceptedWords({
      userId: "free-user",
      acceptanceId: "accept-1",
      localDay: "2026-07-12",
      words: 102,
    });
    await billing.consumeDeepComplete("free-user", "deep-1");
    await billing.consumeDeepComplete("free-user", "deep-1");

    const status = await billing.getStatus("free-user", {
      localDay: "2026-07-12",
    });
    expect(status.localAcceptedWords.used).toBe(102);
    expect(status.localAcceptedWords.exhausted).toBe(true);
    expect(status.deepCompletes.used).toBe(1);
    expect(status.deepCompletes.exhausted).toBe(false);
  });

  it("keeps canceled paid benefits through currentPeriodEnd", async () => {
    const now = new Date("2026-07-12T12:00:00.000Z");
    const billing = new BillingService({
      storage: new InMemoryBillingStorage(),
      now: () => now,
    });
    await billing.applyEntitlement({
      userId: "paid-user",
      planId: "pro",
      polarCustomerId: "customer-1",
      polarSubscriptionId: "subscription-1",
      status: "canceled",
      currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
      billingInterval: "monthly",
      cachedAt: now,
    });

    const status = await billing.getStatus("paid-user");
    expect(status.planId).toBe("pro");
    expect(status.entitlementSource).toBe("paid");
    expect(status.billingInterval).toBe("monthly");
  });

  it("enforces the Max allowance at 1,000 Deep Completes", async () => {
    const now = new Date("2026-07-12T12:00:00.000Z");
    const storage = new InMemoryBillingStorage();
    const billing = new BillingService({ storage, now: () => now });
    await billing.applyEntitlement({
      userId: "max-user",
      planId: "max",
      polarCustomerId: "customer-max",
      polarSubscriptionId: "subscription-max",
      status: "active",
      billingInterval: "monthly",
      cachedAt: now,
    });
    await storage.recordAllowanceUsage(
      "max-user",
      "deep_completes",
      (await billing.getStatus("max-user")).deepCompletes.period!,
      "max-usage",
      1_000,
    );

    const status = await billing.getStatus("max-user");
    expect(status.planId).toBe("max");
    expect(status.deepCompletes.limit).toBe(1_000);
    expect(status.deepCompletes.exhausted).toBe(true);
  });

  it("counts only returned Deep Completes against allowance", async () => {
    const { app, token, billingStorage } = await createBillingTestApp(
      async () => ({ text: " world" }),
    );

    const first = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(validRequest),
    });
    expect(first.status).toBe(200);

    const second = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ ...validRequest, requestId: "req-2" }),
    });
    expect(second.status).toBe(200);

    const usage = await billingStorage.getUsage(
      "user-1",
      (await billingServicePeriod(billingStorage, "user-1")),
    );
    expect(usage).toBe(2);
  });

  it("does not regenerate a Deep Complete for a consumed request id", async () => {
    let generationCount = 0;
    const { app, token, billingStorage } = await createBillingTestApp(
      async () => {
        generationCount += 1;
        return { text: " world" };
      },
    );

    const first = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(validRequest),
    });
    const replay = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(validRequest),
    });

    expect(first.status).toBe(200);
    expect(replay.status).toBe(409);
    expect(generationCount).toBe(1);
    expect(
      await billingStorage.getUsage("user-1", await billingServicePeriod(billingStorage, "user-1")),
    ).toBe(1);
  });

  it("does not consume allowance for empty Deep Completes", async () => {
    const { app, token, billingStorage } = await createBillingTestApp(
      async () => null,
    );

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

    const usage = await billingStorage.getUsage("user-1", currentMonth());
    expect(usage).toBe(0);
  });

  it("does not consume allowance when generation fails", async () => {
    const { app, token, billingStorage } = await createBillingTestApp(async () => {
      throw new Error("model timeout");
    });

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(validRequest),
    });

    expect(response.status).toBe(503);
    const usage = await billingStorage.getUsage("user-1", currentMonth());
    expect(usage).toBe(0);
  });

  it("returns quota_exhausted after ten Free Deep Completes", async () => {
    const { app, token, billingService } = await createBillingTestApp(
      async () => ({ text: " world" }),
    );

    await billingService.applyEntitlement({
      userId: "user-1",
      planId: "free",
      status: "inactive",
      cachedAt: new Date(),
    });

    for (let i = 0; i < 10; i++) {
      const response = await app.request("/suggestions", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ ...validRequest, requestId: `req-${i}` }),
      });
      expect(response.status).toBe(200);
    }

    const exhausted = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ ...validRequest, requestId: "req-exhausted" }),
    });

    expect(exhausted.status).toBe(402);
    const body = await parseApiResponse(exhausted);
    expect(body.status).toBe("error");
    if (body.status !== "error") throw new Error("Expected error response");
    expect(body.error.code).toBe("quota_exhausted");
    expect(body.error.details).toBeDefined();
    expect(body.error.details?.capability).toBe("deep_completes");
    expect(body.error.details?.limit).toBe(10);
    expect(body.error.details?.used).toBe(10);
    expect(body.error.details?.resetAt).toBeDefined();
  });

  it("records a Polar usage event when a suggestion is returned", async () => {
    const { app, token, billingStorage, usageMeterClient, usageMeterService } = await createBillingTestApp(
      async () => ({ text: " world" }),
    );

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(validRequest),
    });

    expect(response.status).toBe(200);
    await usageMeterService.drainOutbox(billingStorage);
    const events = usageMeterClient.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].userId).toBe("user-1");
    expect(events[0].eventId).toBe("req-1");
    expect(events[0].eventName).toBe("deep_complete.used");
    expect(events[0].metadata.creditsSpent).toBe(1);
  });

  it("does not record a Polar usage event for empty suggestions", async () => {
    const { app, token, billingStorage, usageMeterClient, usageMeterService } = await createBillingTestApp(
      async () => null,
    );

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(validRequest),
    });

    expect(response.status).toBe(200);
    await usageMeterService.drainOutbox(billingStorage);
    expect(usageMeterClient.getEvents()).toHaveLength(0);
  });

  it("retries Polar usage ingestion and eventually succeeds", async () => {
    const { app, token, billingStorage, usageMeterClient, usageMeterService } = await createBillingTestApp(
      async () => ({ text: " world" }),
    );

    usageMeterClient.setFailNext(true);

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(validRequest),
    });

    expect(response.status).toBe(200);
    const firstDrain = await usageMeterService.drainOutbox(billingStorage);
    expect(firstDrain.retried).toBe(1);
    await usageMeterService.drainOutbox(billingStorage, {
      now: new Date(Date.now() + 10_000),
    });
    expect(usageMeterClient.getEvents()).toHaveLength(1);
  });

  it("does not fall back to hardcoded checkout URLs when Polar is partially configured", () => {
    expect(() =>
      createBillingCheckoutClient({
        accessToken: "polar-token",
        productIds: { pro: "prod-pro-monthly", max: "" },
      }),
    ).toThrow("Polar checkout is partially configured");
  });

  it("serves Free without a Polar subscription after the trial", async () => {
    const { app, token, billingService } = await createBillingTestApp(
      async () => ({ text: " world" }),
    );

    await billingService.applyEntitlement({
      userId: "user-1",
      planId: "free",
      status: "inactive",
      cachedAt: new Date(),
    });

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(validRequest),
    });

    expect(response.status).toBe(200);
    const body = await parseApiResponse(response);
    expect(body.status).toBe("ok");
  });

  it("rejects webhook requests with an invalid signature", async () => {
    const database = new Database(":memory:");
    const auth = createAuthInstance({ database });
    await migrateAuth(auth);
    const billingStorage = new InMemoryBillingStorage();
    const billingService = new BillingService({ storage: billingStorage });
    const app = createApp({
      auth,
      deviceTokenService: new DeviceTokenService({ storage: new InMemoryDeviceTokenStorage() }),
      billingService,
      personalMemoryStorage: new InMemoryPersonalMemoryStorage(),
      telemetryStorage: new InMemoryTelemetryStorage(),
    });

    const response = await app.request("/api/billing/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "webhook-id": "webhook-id-1",
        "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
        "webhook-signature": "v1,invalid-signature",
      },
      body: JSON.stringify({ type: "subscription.created", data: {} }),
    });

    expect(response.status).toBe(400);
    const body = await parseApiResponse(response);
    expect(body.status).toBe("error");
    if (body.status !== "error") throw new Error("Expected error response");
    expect(body.error.code).toBe("invalid_request");
  });

  it("upgrades plan quota through Polar webhook entitlement updates", async () => {
    const { app, token, billingService } = await createBillingTestApp(
      async () => ({ text: " world" }),
    );

    await billingService.applyEntitlement({
      userId: "user-1",
      planId: "free",
      polarCustomerId: "polar-customer-free",
      polarSubscriptionId: "polar-sub-free",
      status: "active",
      cachedAt: new Date(),
    });

    await billingService.applyPaidEntitlementEvent({
      type: "subscription.created",
      data: {
        customer: { external_id: "user-1" },
        customer_id: "polar-customer-1",
        id: "polar-sub-free",
        status: "active",
        product: { name: "Tab Pro" },
        current_period_end: new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      },
    });

    const entitlement = await billingService.getEntitlement("user-1");
    expect(entitlement.planId).toBe("pro");
    expect(entitlement.polarSubscriptionId).toBe("polar-sub-free");

    for (let i = 0; i < 300; i++) {
      const response = await app.request("/suggestions", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ ...validRequest, requestId: `req-pro-${i}` }),
      });
      if (response.status !== 200) {
        const body = await parseApiResponse(response);
        throw new Error(`Unexpected status ${response.status}: ${JSON.stringify(body)}`);
      }
    }

    const exhausted = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ ...validRequest, requestId: "req-pro-exhausted" }),
    });
    expect(exhausted.status).toBe(402);
  });

  it("updates the cached plan when Polar sends a subscription.updated product change", async () => {
    const { billingService } = await createBillingTestApp(async () => ({
      text: " world",
    }));

    await billingService.applyEntitlement({
      userId: "user-1",
      planId: "pro",
      polarCustomerId: "polar-customer-1",
      polarSubscriptionId: "polar-sub-1",
      status: "active",
      cachedAt: new Date(),
    });

    await billingService.applyPaidEntitlementEvent({
      type: "subscription.updated",
      data: {
        customer: { external_id: "user-1" },
        customer_id: "polar-customer-1",
        id: "polar-sub-1",
        status: "active",
        product: { name: "Tab Max" },
        current_period_end: "2026-08-01T00:00:00.000Z",
      },
    });

    const entitlement = await billingService.getEntitlement("user-1");
    expect(entitlement.planId).toBe("max");
    expect(entitlement.status).toBe("active");
    expect(entitlement.polarCustomerId).toBe("polar-customer-1");
    expect(entitlement.polarSubscriptionId).toBe("polar-sub-1");
    expect(entitlement.currentPeriodEnd).toEqual(
      new Date("2026-08-01T00:00:00.000Z"),
    );
  });

  it("prefers the current Polar subscription product over stale checkout metadata", async () => {
    const { billingService } = await createBillingTestApp(async () => ({
      text: " world",
    }));

    await billingService.applyEntitlement({
      userId: "user-1",
      planId: "free",
      polarCustomerId: "polar-customer-1",
      polarSubscriptionId: "polar-sub-1",
      status: "active",
      cachedAt: new Date(),
    });

    await billingService.applyPaidEntitlementEvent({
      type: "subscription.updated",
      data: {
        customer: {
          id: "polar-customer-1",
          externalId: "user-1",
        },
        customerId: "polar-customer-1",
        id: "polar-sub-1",
        status: "active",
        metadata: { planId: "free" },
        productId: "polar-product-max",
        product: {
          id: "polar-product-max",
          name: "Tab Max",
          metadata: { planId: "max" },
        },
        currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
      },
    });

    const entitlement = await billingService.getEntitlement("user-1");
    expect(entitlement.planId).toBe("max");
    expect(entitlement.status).toBe("active");
    expect(entitlement.polarCustomerId).toBe("polar-customer-1");
    expect(entitlement.polarSubscriptionId).toBe("polar-sub-1");
  });

  it("stores entitlements and atomically consumes usage in local D1", async () => {
    const platform = await getPlatformProxy<{ DB: D1Database }>({
      configPath: "wrangler.jsonc",
      persist: false,
      remoteBindings: false,
    });

    try {
      await applyGeneratedMigrations(platform.env.DB);
      const now = Date.now();
      await platform.env.DB.prepare(
        "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
        .bind("user-d1", "Test User", "user-d1@example.com", 1, now, now)
        .run();
      const storage = new D1BillingStorage(createDatabase(platform.env.DB));

      await storage.setEntitlement({
        userId: "user-d1",
        planId: "max",
        status: "active",
        cachedAt: new Date(),
      });

      const entitlement = await storage.getEntitlement("user-d1");
      expect(entitlement?.planId).toBe("max");
      expect(entitlement?.trialStartedAt).toBeUndefined();
      expect(entitlement?.trialEndsAt).toBeUndefined();

      const initialContenders = await Promise.all([
        storage.consumeUsageWithinLimit("user-d1", currentMonth(), 1),
        storage.consumeUsageWithinLimit("user-d1", currentMonth(), 1),
      ]);
      expect(initialContenders).toContain(1);
      expect(initialContenders).toContain(null);
      await platform.env.DB.prepare(
        "DELETE FROM allowance_usage_events WHERE user_id = ? AND metric = ? AND period = ?",
      )
        .bind("user-d1", "deep_completes", currentMonth())
        .run();

      const first = await storage.consumeUsageWithinLimit(
        "user-d1",
        currentMonth(),
        2,
      );
      const contenders = await Promise.all([
        storage.consumeUsageWithinLimit("user-d1", currentMonth(), 2),
        storage.consumeUsageWithinLimit("user-d1", currentMonth(), 2),
      ]);
      expect(first).toBe(1);
      expect(contenders).toContain(2);
      expect(contenders).toContain(null);

      const usage = await storage.getUsage("user-d1", currentMonth());
      expect(usage).toBe(2);

      await storage.recordLocalAcceptedWordsWithUsage({
        userId: "user-d1",
        acceptanceId: "accept-d1",
        localDay: "2026-07-14",
        acceptedAt: new Date("2026-07-14T00:00:00.000Z"),
        words: 2,
      });
      const claimNow = new Date(Date.now() + 1_000);
      const firstClaim = await storage.claimPolarUsageOutbox({
        now: claimNow,
        leaseOwner: "worker-1",
        leaseDurationMs: 60_000,
        limit: 10,
      });
      expect(firstClaim).toHaveLength(1);
      expect(await storage.claimPolarUsageOutbox({
        now: new Date(claimNow.getTime() + 30_000),
        leaseOwner: "worker-2",
        leaseDurationMs: 60_000,
        limit: 10,
      })).toHaveLength(0);
      expect(await storage.claimPolarUsageOutbox({
        now: new Date(claimNow.getTime() + 61_000),
        leaseOwner: "worker-2",
        leaseDurationMs: 60_000,
        limit: 10,
      })).toHaveLength(1);
    } finally {
      await platform.dispose();
    }
  });

  it("ignores Polar webhook entitlement updates for unknown D1 users", async () => {
    const db = new Database(":memory:");
    bootstrapBillingTestSchema(db);
    const storage = new D1BillingStorage(createTestDatabase(db));
    const billingService = new BillingService({ storage });

    await billingService.applyPaidEntitlementEvent({
      type: "subscription.created",
      data: {
        customer: { external_id: "missing-user" },
        customer_id: "polar-customer-1",
        id: "polar-sub-1",
        status: "active",
        product: { name: "Tab Pro" },
      },
    });

    await billingService.applyPaidEntitlementEvent({
      type: "subscription.canceled",
      data: {
        customer: { external_id: "missing-user" },
      },
    });

    expect(await storage.getEntitlement("missing-user")).toBeNull();
  });

  it("provisions Free idempotently and retries without blocking local access", async () => {
    let attempts = 0;
    const provisioningClient: BillingProvisioningClient = {
      async provisionFreeSubscription() {
        attempts += 1;
        if (attempts === 1) throw new Error("Polar unavailable");
        return {
          customerId: "customer-free",
          subscriptionId: "subscription-free",
          productId: "product-free",
          status: "active",
          currentPeriodStart: new Date("2026-07-14T15:00:00.000Z"),
          currentPeriodEnd: new Date("2026-08-14T15:00:00.000Z"),
          cancelAtPeriodEnd: false,
        };
      },
      async getSubscription() {
        throw new Error("not used");
      },
    };
    const billing = new BillingService({
      storage: new InMemoryBillingStorage(),
      provisioningClient,
      now: () => new Date("2026-07-14T15:00:00.000Z"),
    });

    const unavailable = await billing.provisionAccount({
      id: "new-user",
      email: "new@example.com",
    });
    expect(unavailable.planId).toBe("free");
    expect(unavailable.provisioningState).toBe("retrying");
    expect((await billing.getStatus("new-user")).planId).toBe("free");
    await billing.consumeDeepComplete("new-user", "pending-deep-complete");

    const ready = await billing.provisionAccount({
      id: "new-user",
      email: "new@example.com",
    });
    expect(ready.provisioningState).toBe("ready");
    expect(ready.currentPeriodStart).toEqual(new Date("2026-07-14T15:00:00.000Z"));
    const readyStatus = await billing.getStatus("new-user");
    expect(readyStatus.deepCompletes.period).toBe(
      "subscription-free:2026-07-14T15:00:00.000Z",
    );
    expect(readyStatus.deepCompletes.used).toBe(1);

    await billing.provisionAccount({ id: "new-user", email: "new@example.com" });
    expect(attempts).toBe(2);
  });

  it("provisions a verified Free account when the dashboard requests billing status", async () => {
    const database = new Database(":memory:");
    const auth = createAuthInstance({ database, baseURL: "http://localhost:8787" });
    await migrateAuth(auth);
    const storage = new InMemoryBillingStorage();
    let provisioned = 0;
    const billingService = new BillingService({
      storage,
      provisioningClient: {
        async provisionFreeSubscription() {
          provisioned += 1;
          return {
            customerId: "customer-dashboard",
            subscriptionId: "subscription-dashboard",
            productId: "product-free",
            status: "active",
            currentPeriodStart: new Date("2026-07-14T16:00:00.000Z"),
            currentPeriodEnd: new Date("2026-08-14T16:00:00.000Z"),
            cancelAtPeriodEnd: false,
          };
        },
        async getSubscription() { throw new Error("not used"); },
      },
    });
    const app = createApp({
      auth,
      billingService,
      deviceTokenService: new DeviceTokenService({
        storage: new InMemoryDeviceTokenStorage(),
      }),
      personalMemoryStorage: new InMemoryPersonalMemoryStorage(),
      telemetryStorage: new InMemoryTelemetryStorage(),
    });
    const signUp = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:8787" },
      body: JSON.stringify({
        name: "Dashboard User",
        email: "dashboard@example.com",
        password: "password123456",
      }),
    });
    const signUpBody = await signUp.json() as { user: { id: string } };
    database.query("UPDATE user SET emailVerified = 1 WHERE id = ?").run(
      signUpBody.user.id,
    );
    const signIn = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:8787" },
      body: JSON.stringify({
        email: "dashboard@example.com",
        password: "password123456",
      }),
    });
    const cookie = signIn.headers.get("set-cookie");
    if (!cookie) throw new Error("Missing session cookie");

    const response = await app.request("/api/billing/status", {
      headers: { cookie },
    });

    expect(response.status).toBe(200);
    expect(provisioned).toBe(1);
    expect(await billingService.getEntitlement(signUpBody.user.id)).toMatchObject({
      provisioningState: "ready",
      polarCustomerId: "customer-dashboard",
      polarSubscriptionId: "subscription-dashboard",
    });
  });

  it("allows only one concurrent Free provisioning attempt", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    let attempts = 0;
    const provisioningClient: BillingProvisioningClient = {
      async provisionFreeSubscription() {
        attempts += 1;
        started();
        await gate;
        return {
          customerId: "customer-one",
          subscriptionId: "subscription-one",
          productId: "product-free",
          status: "active",
          currentPeriodStart: new Date("2026-07-14T15:00:00.000Z"),
          currentPeriodEnd: new Date("2026-08-14T15:00:00.000Z"),
          cancelAtPeriodEnd: false,
        };
      },
      async getSubscription() { throw new Error("not used"); },
    };
    const billing = new BillingService({
      storage: new InMemoryBillingStorage(),
      provisioningClient,
    });

    const first = billing.provisionAccount({ id: "race-user", email: "race@example.com" });
    await startedPromise;
    const second = await billing.provisionAccount({ id: "race-user", email: "race@example.com" });
    expect(second.provisioningState).not.toBe("ready");
    release();
    expect((await first).provisioningState).toBe("ready");
    expect(attempts).toBe(1);
  });

  it("does not overwrite a paid webhook that arrives during Free provisioning", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    const billing = new BillingService({
      storage: new InMemoryBillingStorage(),
      provisioningClient: {
        async provisionFreeSubscription() {
          started();
          await gate;
          return {
            customerId: "customer-1",
            subscriptionId: "subscription-free",
            productId: "product-free",
            status: "active",
            currentPeriodStart: new Date("2026-07-14T15:00:00.000Z"),
            currentPeriodEnd: new Date("2026-08-14T15:00:00.000Z"),
            cancelAtPeriodEnd: false,
          };
        },
        async getSubscription() { throw new Error("not used"); },
      },
    });
    const provisioning = billing.provisionAccount({
      id: "upgrade-race",
      email: "upgrade@example.com",
    });
    await startedPromise;
    await billing.applyPaidEntitlementEvent({
      id: "paid-webhook",
      type: "subscription.updated",
      data: {
        customer: { external_id: "upgrade-race" },
        customer_id: "customer-1",
        id: "subscription-paid",
        status: "active",
        product: { name: "Tab Pro" },
        current_period_start: "2026-07-14T15:00:00.000Z",
        current_period_end: "2026-08-14T15:00:00.000Z",
      },
    });
    release();

    expect(await provisioning).toMatchObject({
      planId: "pro",
      polarSubscriptionId: "subscription-paid",
      provisioningState: "ready",
    });
  });

  it("ignores lifecycle events from a replaced subscription", async () => {
    const billing = new BillingService({ storage: new InMemoryBillingStorage() });
    await billing.applyEntitlement({
      userId: "replacement-user",
      planId: "max",
      polarCustomerId: "customer-1",
      polarSubscriptionId: "subscription-current",
      status: "active",
      currentPeriodStart: new Date("2026-07-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
      cachedAt: new Date("2026-07-14T00:00:00.000Z"),
    });
    await billing.applyPaidEntitlementEvent({
      id: "late-old-subscription",
      timestamp: "2026-07-15T00:00:00.000Z",
      type: "subscription.active",
      data: {
        customer: { external_id: "replacement-user" },
        customer_id: "customer-1",
        id: "subscription-old",
        status: "active",
        product: { name: "Tab Pro" },
      },
    });
    expect(await billing.getEntitlement("replacement-user")).toMatchObject({
      planId: "max",
      polarSubscriptionId: "subscription-current",
    });
  });

  it("returns a revoked paid subscription to pending Free", async () => {
    const billing = new BillingService({ storage: new InMemoryBillingStorage() });
    await billing.applyEntitlement({
      userId: "revoked-user",
      planId: "pro",
      polarCustomerId: "customer-1",
      polarSubscriptionId: "subscription-paid",
      status: "active",
      currentPeriodStart: new Date("2026-07-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
      cachedAt: new Date(),
    });
    await billing.applyPaidEntitlementEvent({
      id: "revoke-paid",
      type: "subscription.revoked",
      data: {
        customer: { external_id: "revoked-user" },
        customer_id: "customer-1",
        id: "subscription-paid",
        status: "canceled",
        product: { name: "Tab Pro" },
      },
    });
    expect(await billing.getEntitlement("revoked-user")).toMatchObject({
      planId: "free",
      provisioningState: "retrying",
    });
  });

  it("recovers a missed revocation during subscription reconciliation", async () => {
    const storage = new InMemoryBillingStorage();
    const billing = new BillingService({
      storage,
      provisioningClient: {
        async provisionFreeSubscription() { throw new Error("not used"); },
        async getSubscription() {
          return {
            customerId: "customer-1",
            subscriptionId: "subscription-paid",
            productId: "product-pro",
            status: "canceled",
            currentPeriodStart: new Date("2026-07-01T00:00:00.000Z"),
            currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
            cancelAtPeriodEnd: false,
          };
        },
      },
      now: () => new Date("2026-08-01T00:00:01.000Z"),
    });
    await billing.applyEntitlement({
      userId: "missed-revoke",
      planId: "pro",
      polarCustomerId: "customer-1",
      polarSubscriptionId: "subscription-paid",
      status: "active",
      currentPeriodStart: new Date("2026-07-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
      provisioningState: "ready",
      cachedAt: new Date("2026-07-31T00:00:00.000Z"),
    });

    expect(await billing.reconcileEntitlement("missed-revoke")).toMatchObject({
      planId: "free",
      provisioningState: "retrying",
    });
  });

  it("starts fresh exact periods at mid-month renewal and trial conversion", async () => {
    let now = new Date("2026-08-13T23:59:00.000Z");
    const storage = new InMemoryBillingStorage();
    const billing = new BillingService({ storage, now: () => now });
    await billing.applyEntitlement({
      userId: "period-user",
      planId: "pro",
      polarCustomerId: "customer-1",
      polarSubscriptionId: "subscription-1",
      status: "trialing",
      currentPeriodStart: new Date("2026-07-14T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-08-14T00:00:00.000Z"),
      trialStartedAt: new Date("2026-07-14T00:00:00.000Z"),
      trialEndsAt: new Date("2026-08-14T00:00:00.000Z"),
      cachedAt: now,
    });
    const oldPeriod = (await billing.getStatus("period-user")).deepCompletes.period!;
    await storage.recordAllowanceUsage(
      "period-user",
      "deep_completes",
      oldPeriod,
      "trial-usage",
      12,
    );
    now = new Date("2026-08-14T00:00:01.000Z");
    await billing.applyPaidEntitlementEvent({
      id: "trial-converted",
      timestamp: now.toISOString(),
      type: "subscription.updated",
      data: {
        customer: { external_id: "period-user" },
        customer_id: "customer-1",
        id: "subscription-1",
        status: "active",
        product: { name: "Tab Pro" },
        current_period_start: "2026-08-14T00:00:00.000Z",
        current_period_end: "2026-09-14T00:00:00.000Z",
      },
    });
    const converted = await billing.getStatus("period-user");
    expect(converted.trial).toEqual({ active: false });
    expect(converted.deepCompletes.period).toBe(
      "subscription-1:2026-08-14T00:00:00.000Z",
    );
    expect(converted.deepCompletes.used).toBe(0);
  });

  it("creates an entitlement when a known-user webhook arrives before lazy initialization", async () => {
    const storage = new InMemoryBillingStorage();
    const billing = new BillingService({ storage });
    await billing.applyPaidEntitlementEvent({
      id: "event-before-read",
      type: "subscription.created",
      data: {
        customer: { external_id: "webhook-user" },
        customer_id: "customer-1",
        id: "subscription-1",
        status: "active",
        product: { name: "Tab Free" },
        current_period_start: "2026-07-14T15:00:00.000Z",
        current_period_end: "2026-08-14T15:00:00.000Z",
      },
    });

    expect(await storage.getEntitlement("webhook-user")).toMatchObject({
      planId: "free",
      polarSubscriptionId: "subscription-1",
      currentPeriodStart: new Date("2026-07-14T15:00:00.000Z"),
      currentPeriodEnd: new Date("2026-08-14T15:00:00.000Z"),
      provisioningState: "ready",
    });
  });

  it("deduplicates Local Accepted Words and durably delivers the original timestamp", async () => {
    const storage = new InMemoryBillingStorage();
    const billing = new BillingService({ storage });
    const client = new InMemoryUsageMeterClient();
    const meter = new UsageMeterService({ client });
    const acceptedAt = new Date("2026-07-14T06:30:00.000Z");

    await billing.recordLocalAcceptedWords({
      userId: "accept-user",
      acceptanceId: "acceptance-1",
      localDay: "2026-07-13",
      acceptedAt,
      words: 7,
    });
    await billing.recordLocalAcceptedWords({
      userId: "accept-user",
      acceptanceId: "acceptance-1",
      localDay: "2026-07-13",
      acceptedAt,
      words: 7,
    });
    expect((await meter.drainOutbox(storage)).delivered).toBe(1);
    expect(client.getEvents()).toEqual([{
      userId: "accept-user",
      eventId: "acceptance-1",
      eventName: "local_accepted_words.used",
      timestamp: acceptedAt,
      metadata: { words: 7, localDay: "2026-07-13" },
    }]);
  });

  it("stops retrying a permanently failing outbox event after eight attempts", async () => {
    const storage = new InMemoryBillingStorage();
    const billing = new BillingService({ storage });
    const meter = new UsageMeterService({
      client: { async ingest() { throw new Error("Polar unavailable"); } },
    });
    await billing.recordLocalAcceptedWords({
      userId: "failed-user",
      acceptanceId: "failed-acceptance",
      localDay: "2026-07-14",
      acceptedAt: new Date("2026-07-14T00:00:00.000Z"),
      words: 1,
    });

    let failed = 0;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const result = await meter.drainOutbox(storage, {
        now: new Date(Date.UTC(2026, 6, 14, attempt + 1)),
      });
      failed += result.failed;
    }
    expect(failed).toBe(1);
    expect((await meter.drainOutbox(storage, {
      now: new Date("2026-07-15T00:00:00.000Z"),
    })).delivered).toBe(0);
  });

  it("passes the existing Free subscription to paid checkout", async () => {
    const captured: unknown[] = [];
    const updates: unknown[] = [];
    const polar = {
      checkouts: {
        async create(input: unknown) {
          captured.push(input);
          return { url: "https://checkout.example/session" };
        },
      },
      subscriptions: {
        async update(input: unknown) { updates.push(input); },
      },
    } as unknown as import("@polar-sh/sdk").Polar;
    const checkout = new PolarBillingCheckoutClient({
      polar,
      productIds: { pro: "product-pro", max: "product-max" },
    });

    await checkout.createCheckoutUrl(
      "pro",
      "monthly",
      { id: "user-1", email: "user@example.com" },
      "subscription-free",
    );
    expect(captured[0]).toMatchObject({
      products: ["product-pro"],
      externalCustomerId: "user-1",
      subscriptionId: "subscription-free",
    });
    await checkout.changePlan("max", "subscription-free", "next_period");
    expect(updates[0]).toEqual({
      id: "subscription-free",
      subscriptionUpdate: {
        productId: "product-max",
        prorationBehavior: "next_period",
      },
    });
  });
});

describe("PolarUsageMeterClient", () => {
  it("ingests an event with organization id, external customer id and request id", async () => {
    const captured: { events: unknown[] }[] = [];
    const mockPolar = {
      events: {
        ingest: async (request: { events: unknown[] }) => {
          captured.push(request);
        },
      },
    } as unknown as import("@polar-sh/sdk").Polar;

    const client = new PolarUsageMeterClient({
      meterId: "meter-123",
      polar: mockPolar,
      organizationId: "org-123",
    });

    await client.ingest({
      userId: "user-1",
      eventId: "req-1",
      eventName: "deep_complete.used",
      timestamp: new Date("2026-07-07T00:00:00.000Z"),
      metadata: { requestId: "req-1", creditsSpent: 1 },
    });

    expect(captured).toHaveLength(1);
    const event = captured[0].events[0] as {
      name: string;
      externalCustomerId: string;
      externalId: string;
      organizationId: string;
      metadata: { requestId: string; creditsSpent: number };
      timestamp: Date;
    };
    expect(event.name).toBe("deep_complete.used");
    expect(event.externalCustomerId).toBe("user-1");
    expect(event.externalId).toBe("req-1");
    expect(event.organizationId).toBe("org-123");
    expect(event.metadata.requestId).toBe("req-1");
    expect(event.metadata.creditsSpent).toBe(1);
    expect(event.timestamp).toEqual(new Date("2026-07-07T00:00:00.000Z"));
  });
});

function bootstrapBillingTestSchema(db: Database): void {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE user (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      email_verified INTEGER NOT NULL DEFAULT 0,
      image TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE user_entitlements (
      user_id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      polar_customer_id TEXT,
      polar_subscription_id TEXT,
      status TEXT NOT NULL,
      current_period_end TEXT,
      cached_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
    );

    CREATE TABLE usage_records (
      user_id TEXT NOT NULL,
      month TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, month),
      FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
    );
  `);
}

async function applyGeneratedMigrations(db: D1Database): Promise<void> {
  const journal = (await Bun.file(
    "apps/api/drizzle/meta/_journal.json",
  ).json()) as { entries: { tag: string }[] };

  for (const { tag } of journal.entries) {
    const sql = await Bun.file(`apps/api/drizzle/${tag}.sql`).text();
    const statements = sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    await db.batch(statements.map((statement) => db.prepare(statement)));
  }
}

function insertBillingTestUser(db: Database, userId: string): void {
  const now = Date.now();
  db.query(
    "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(userId, "Test User", `${userId}@example.com`, 1, now, now);
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function billingServicePeriod(
  storage: InMemoryBillingStorage,
  userId: string,
): Promise<string> {
  const entitlement = await storage.getEntitlement(userId);
  if (!entitlement?.polarSubscriptionId || !entitlement.currentPeriodStart) {
    throw new Error("Expected an initialized billing period");
  }
  return `${entitlement.polarSubscriptionId}:${entitlement.currentPeriodStart.toISOString()}`;
}
