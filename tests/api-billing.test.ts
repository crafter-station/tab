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
  UsageMeterService,
  createBillingCheckoutClient,
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
    usageMeterService,
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
  return { app, token, billingService, billingStorage, usageMeterClient };
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
      "2026-07",
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

    const usage = await billingStorage.getUsage("user-1", currentMonth());
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
      await billingStorage.getUsage("user-1", currentMonth()),
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
    const { app, token, usageMeterClient } = await createBillingTestApp(
      async () => ({ text: " world" }),
    );

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(validRequest),
    });

    expect(response.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const events = usageMeterClient.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].userId).toBe("user-1");
    expect(events[0].requestId).toBe("req-1");
    expect(events[0].creditsSpent).toBe(1);
  });

  it("does not record a Polar usage event for empty suggestions", async () => {
    const { app, token, usageMeterClient } = await createBillingTestApp(
      async () => null,
    );

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(validRequest),
    });

    expect(response.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(usageMeterClient.getEvents()).toHaveLength(0);
  });

  it("retries Polar usage ingestion and eventually succeeds", async () => {
    const { app, token, usageMeterClient } = await createBillingTestApp(
      async () => ({ text: " world" }),
    );

    usageMeterClient.setFailNext(true);

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(validRequest),
    });

    expect(response.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 150));
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
        id: "polar-sub-1",
        status: "active",
        product: { name: "Tab Pro" },
        current_period_end: new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      },
    });

    const entitlement = await billingService.getEntitlement("user-1");
    expect(entitlement.planId).toBe("pro");
    expect(entitlement.polarSubscriptionId).toBe("polar-sub-1");

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
      requestId: "req-1",
      timestamp: new Date("2026-07-07T00:00:00.000Z"),
      creditsSpent: 1,
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
