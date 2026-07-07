import { Polar } from "@polar-sh/sdk";
import { validateEvent } from "@polar-sh/sdk/webhooks";
import { planQuotas, type PlanId } from "@tabb/billing";

export type UserEntitlement = {
  readonly userId: string;
  readonly planId: PlanId;
  readonly polarCustomerId?: string;
  readonly polarSubscriptionId?: string;
  readonly status:
    | "active"
    | "canceled"
    | "past_due"
    | "unpaid"
    | "inactive";
  readonly currentPeriodEnd?: Date;
  readonly cachedAt: Date;
};

export type UsageRecord = {
  readonly userId: string;
  readonly month: string;
  readonly count: number;
  readonly updatedAt: Date;
};

export type QuotaCheckResult =
  | {
      readonly ok: true;
      readonly entitlement: UserEntitlement;
      readonly usage: number;
      readonly quota: number;
      readonly resetAt: Date;
    }
  | {
      readonly ok: false;
      readonly entitlement: UserEntitlement;
      readonly usage: number;
      readonly quota: number;
      readonly resetAt: Date;
    };

export interface BillingStorage {
  getEntitlement(userId: string): Promise<UserEntitlement | null>;
  setEntitlement(entitlement: UserEntitlement): Promise<void>;
  getUsage(userId: string, month: string): Promise<number>;
  incrementUsage(userId: string, month: string): Promise<number>;
}

export type PolarUsageEvent = {
  readonly userId: string;
  readonly requestId: string;
  readonly timestamp: Date;
};

export interface UsageMeterClient {
  ingest(event: PolarUsageEvent): Promise<void>;
}

export type CreatePolarUsageMeterClientOptions = {
  readonly accessToken?: string;
  readonly server?: "production" | "sandbox";
  readonly meterId?: string;
};

export class PolarUsageMeterClient implements UsageMeterClient {
  private readonly polar: Polar;
  private readonly meterId: string;

  constructor(options: CreatePolarUsageMeterClientOptions = {}) {
    const accessToken = options.accessToken ?? process.env.POLAR_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error("POLAR_ACCESS_TOKEN is not configured");
    }

    const meterId = options.meterId ?? process.env.POLAR_AUTOCOMPLETE_METER_ID;
    if (!meterId) {
      throw new Error("POLAR_AUTOCOMPLETE_METER_ID is not configured");
    }

    this.polar = new Polar({
      accessToken,
      server: options.server ?? "production",
    });
    this.meterId = meterId;
  }

  async ingest(event: PolarUsageEvent): Promise<void> {
    await this.polar.events.ingest({
      events: [
        {
          name: "autocomplete.used",
          externalCustomerId: event.userId,
          metadata: {
            requestId: event.requestId,
          },
          timestamp: event.timestamp,
        },
      ],
    });
  }
}

export class InMemoryUsageMeterClient implements UsageMeterClient {
  private events: PolarUsageEvent[] = [];
  private shouldFailNext = false;

  async ingest(event: PolarUsageEvent): Promise<void> {
    if (this.shouldFailNext) {
      this.shouldFailNext = false;
      throw new Error("Polar usage ingestion failed");
    }
    this.events.push(event);
  }

  getEvents(): readonly PolarUsageEvent[] {
    return this.events;
  }

  setFailNext(value: boolean): void {
    this.shouldFailNext = value;
  }
}

export interface BillingCheckoutClient {
  createCheckoutUrl(planId: PlanId, userId: string): Promise<string>;
  createPortalUrl(userId: string, customerId?: string): Promise<string>;
}

export type CreatePolarBillingCheckoutClientOptions = {
  accessToken?: string;
  server?: "production" | "sandbox";
  productIds?: Partial<Record<PlanId, string>>;
  successUrl?: string;
};

export class StubBillingCheckoutClient implements BillingCheckoutClient {
  async createCheckoutUrl(planId: PlanId, userId: string): Promise<string> {
    return `https://polar.sh/checkout/${planId}?customer=${encodeURIComponent(userId)}`;
  }

  async createPortalUrl(userId: string, customerId?: string): Promise<string> {
    return `https://polar.sh/portal/${customerId ?? userId}`;
  }
}

export class PolarBillingCheckoutClient implements BillingCheckoutClient {
  private readonly polar: Polar;
  private readonly productIds: Record<PlanId, string>;
  private readonly successUrl: string | undefined;

  constructor(options: CreatePolarBillingCheckoutClientOptions = {}) {
    const accessToken = options.accessToken ?? process.env.POLAR_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error("POLAR_ACCESS_TOKEN is not configured");
    }

    const productIds: Partial<Record<PlanId, string>> = {
      free: process.env.POLAR_PRODUCT_ID_FREE,
      pro: process.env.POLAR_PRODUCT_ID_PRO,
      max: process.env.POLAR_PRODUCT_ID_MAX,
      ...options.productIds,
    };

    if (!productIds.free || !productIds.pro || !productIds.max) {
      throw new Error("Polar product ids are not configured");
    }

    this.polar = new Polar({
      accessToken,
      server: options.server ?? "production",
    });
    this.productIds = productIds as Record<PlanId, string>;
    this.successUrl = options.successUrl ?? process.env.POLAR_CHECKOUT_SUCCESS_URL;
  }

  async createCheckoutUrl(planId: PlanId, userId: string): Promise<string> {
    const checkout = await this.polar.checkouts.create({
      products: [this.productIds[planId]],
      externalCustomerId: userId,
      successUrl: this.successUrl,
    });

    return checkout.url;
  }

  async createPortalUrl(userId: string, customerId?: string): Promise<string> {
    if (!customerId) {
      throw new Error("No Polar customer associated with this account");
    }

    const session = await this.polar.customerSessions.create({
      customerId,
    });

    return session.customerPortalUrl;
  }
}

export function createBillingCheckoutClient(
  options?: CreatePolarBillingCheckoutClientOptions,
): BillingCheckoutClient {
  if (
    process.env.POLAR_ACCESS_TOKEN &&
    process.env.POLAR_PRODUCT_ID_FREE &&
    process.env.POLAR_PRODUCT_ID_PRO &&
    process.env.POLAR_PRODUCT_ID_MAX
  ) {
    return new PolarBillingCheckoutClient(options);
  }
  return new StubBillingCheckoutClient();
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function nextResetDate(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export type BillingServiceDependencies = {
  readonly storage?: BillingStorage;
};

export class BillingService {
  readonly storage: BillingStorage;

  constructor(deps: BillingServiceDependencies = {}) {
    this.storage = deps.storage ?? new InMemoryBillingStorage();
  }

  async getEntitlement(userId: string): Promise<UserEntitlement> {
    const cached = await this.storage.getEntitlement(userId);
    if (cached) return cached;

    const defaultEntitlement: UserEntitlement = {
      userId,
      planId: "free",
      status: "inactive",
      cachedAt: new Date(),
    };

    await this.storage.setEntitlement(defaultEntitlement);
    return defaultEntitlement;
  }

  async checkQuota(userId: string): Promise<QuotaCheckResult> {
    const entitlement = await this.getEntitlement(userId);
    const quota = planQuotas[entitlement.planId].monthlyAutocompleteSuggestions;
    const month = currentMonth();
    const usage = await this.storage.getUsage(userId, month);
    const resetAt = nextResetDate();

    if (usage >= quota) {
      return { ok: false, entitlement, usage, quota, resetAt };
    }

    return { ok: true, entitlement, usage, quota, resetAt };
  }

  async consumeSuggestion(userId: string): Promise<UsageRecord> {
    const month = currentMonth();
    const count = await this.storage.incrementUsage(userId, month);
    return { userId, month, count, updatedAt: new Date() };
  }

  async applyEntitlement(entitlement: UserEntitlement): Promise<void> {
    await this.storage.setEntitlement(entitlement);
  }
}

export type UsageMeterServiceDependencies = {
  readonly client?: UsageMeterClient;
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
};

export class UsageMeterService {
  private readonly client: UsageMeterClient;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(deps: UsageMeterServiceDependencies = {}) {
    this.client = deps.client ?? new InMemoryUsageMeterClient();
    this.maxRetries = deps.maxRetries ?? 3;
    this.retryDelayMs = deps.retryDelayMs ?? 500;
  }

  async recordUsage(event: PolarUsageEvent): Promise<void> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        await this.client.ingest(event);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < this.maxRetries) {
          await this.delay(this.retryDelayMs * 2 ** attempt);
        }
      }
    }

    throw lastError ?? new Error("Usage metering failed after retries");
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export class InMemoryBillingStorage implements BillingStorage {
  private entitlements = new Map<string, UserEntitlement>();
  private usage = new Map<string, number>();

  async getEntitlement(userId: string): Promise<UserEntitlement | null> {
    return this.entitlements.get(userId) ?? null;
  }

  async setEntitlement(entitlement: UserEntitlement): Promise<void> {
    this.entitlements.set(entitlement.userId, entitlement);
  }

  async getUsage(userId: string, month: string): Promise<number> {
    return this.usage.get(this.usageKey(userId, month)) ?? 0;
  }

  async incrementUsage(userId: string, month: string): Promise<number> {
    const key = this.usageKey(userId, month);
    const next = (this.usage.get(key) ?? 0) + 1;
    this.usage.set(key, next);
    return next;
  }

  private usageKey(userId: string, month: string): string {
    return `${userId}:${month}`;
  }
}

type D1Statement = {
  bind(...values: unknown[]): {
    first<T = unknown>(): Promise<T | null>;
    run(): Promise<{ success: boolean; error?: string }>;
    all<T = unknown>(): Promise<{ results: T[] }>;
  };
};

type D1DatabaseLike = {
  prepare(sql: string): D1Statement;
  exec(sql: string): Promise<void>;
};

function entitlementRowToEntitlement(row: Record<string, unknown>): UserEntitlement {
  return {
    userId: String(row.user_id),
    planId: String(row.plan_id) as PlanId,
    polarCustomerId: row.polar_customer_id ? String(row.polar_customer_id) : undefined,
    polarSubscriptionId: row.polar_subscription_id
      ? String(row.polar_subscription_id)
      : undefined,
    status: String(row.status) as UserEntitlement["status"],
    currentPeriodEnd: row.current_period_end
      ? new Date(String(row.current_period_end))
      : undefined,
    cachedAt: new Date(String(row.cached_at)),
  };
}

export class D1BillingStorage implements BillingStorage {
  private readonly db: D1DatabaseLike;

  constructor(db: unknown) {
    this.db = db as D1DatabaseLike;
  }

  async ensureTables(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_entitlements (
        user_id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        polar_customer_id TEXT,
        polar_subscription_id TEXT,
        status TEXT NOT NULL,
        current_period_end TEXT,
        cached_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS usage_records (
        user_id TEXT NOT NULL,
        month TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, month)
      );
    `);
  }

  async getEntitlement(userId: string): Promise<UserEntitlement | null> {
    const row = (await this.db
      .prepare("SELECT * FROM user_entitlements WHERE user_id = ?")
      .bind(userId)
      .first()) as Record<string, unknown> | null;
    return row ? entitlementRowToEntitlement(row) : null;
  }

  async setEntitlement(entitlement: UserEntitlement): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO user_entitlements (user_id, plan_id, polar_customer_id, polar_subscription_id, status, current_period_end, cached_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           plan_id = excluded.plan_id,
           polar_customer_id = excluded.polar_customer_id,
           polar_subscription_id = excluded.polar_subscription_id,
           status = excluded.status,
           current_period_end = excluded.current_period_end,
           cached_at = excluded.cached_at`,
      )
      .bind(
        entitlement.userId,
        entitlement.planId,
        entitlement.polarCustomerId ?? null,
        entitlement.polarSubscriptionId ?? null,
        entitlement.status,
        entitlement.currentPeriodEnd?.toISOString() ?? null,
        entitlement.cachedAt.toISOString(),
      )
      .run();
  }

  async getUsage(userId: string, month: string): Promise<number> {
    const row = (await this.db
      .prepare("SELECT count FROM usage_records WHERE user_id = ? AND month = ?")
      .bind(userId, month)
      .first()) as { count: number } | null;
    return row ? Number(row.count) : 0;
  }

  async incrementUsage(userId: string, month: string): Promise<number> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO usage_records (user_id, month, count, updated_at)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(user_id, month) DO UPDATE SET
           count = count + 1,
           updated_at = excluded.updated_at`,
      )
      .bind(userId, month, now)
      .run();

    const row = (await this.db
      .prepare("SELECT count FROM usage_records WHERE user_id = ? AND month = ?")
      .bind(userId, month)
      .first()) as { count: number } | null;
    return row ? Number(row.count) : 1;
  }
}

type PolarWebhookPayload = {
  readonly type: string;
  readonly data: Record<string, unknown>;
};

function optionalString(value: unknown): string | undefined {
  return value ? String(value) : undefined;
}

function optionalDate(value: unknown): Date | undefined {
  return value ? new Date(String(value)) : undefined;
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value as Record<string, unknown> | undefined;
}

function planIdFromProductName(name: string): PlanId | null {
  const lower = name.toLowerCase();
  if (lower.includes("max")) return "max";
  if (lower.includes("pro")) return "pro";
  if (lower.includes("free")) return "free";
  return null;
}

export type WebhookValidationResult =
  | { readonly valid: true; readonly payload: PolarWebhookPayload }
  | { readonly valid: false; readonly reason: string };

export type WebhookHandlerDependencies = {
  readonly storage?: BillingStorage;
  readonly secret?: string;
};

export class BillingWebhookHandler {
  private readonly storage: BillingStorage;
  private readonly secret: string | undefined;

  constructor(deps: WebhookHandlerDependencies = {}) {
    this.storage = deps.storage ?? new InMemoryBillingStorage();
    this.secret = deps.secret ?? process.env.POLAR_WEBHOOK_SECRET;
  }

  validateRequest(
    body: string,
    headers: Record<string, string | undefined>,
  ): WebhookValidationResult {
    if (!this.secret) {
      return { valid: false, reason: "Webhook secret is not configured" };
    }

    const validatedHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined) {
        validatedHeaders[key] = value;
      }
    }

    try {
      const event = validateEvent(body, validatedHeaders, this.secret);
      return { valid: true, payload: event as PolarWebhookPayload };
    } catch {
      return { valid: false, reason: "Invalid webhook signature" };
    }
  }

  async handle(payload: PolarWebhookPayload): Promise<void> {
    const data = payload.data;

    switch (payload.type) {
      case "subscription.created":
      case "subscription.updated": {
        const customer = optionalRecord(data.customer);
        const product = optionalRecord(data.product);
        const userId = optionalString(customer?.external_id);
        const customerId = optionalString(data.customer_id);
        const subscriptionId = optionalString(data.id);
        const status = optionalString(data.status) ?? "inactive";
        const productName = optionalString(product?.name);
        const currentPeriodEnd = optionalDate(data.current_period_end);

        if (!userId || !customerId || !subscriptionId || !productName) {
          return;
        }

        const planId = planIdFromProductName(productName) ?? "free";

        await this.storage.setEntitlement({
          userId,
          planId,
          polarCustomerId: customerId,
          polarSubscriptionId: subscriptionId,
          status: status as UserEntitlement["status"],
          currentPeriodEnd,
          cachedAt: new Date(),
        });
        break;
      }

      case "subscription.canceled":
      case "subscription.uncanceled": {
        const customer = optionalRecord(data.customer);
        const userId = optionalString(customer?.external_id);
        if (!userId) return;

        const existing = await this.storage.getEntitlement(userId);
        const status =
          payload.type === "subscription.canceled" ? "canceled" : "active";

        await this.storage.setEntitlement({
          userId,
          planId: existing?.planId ?? "free",
          polarCustomerId: existing?.polarCustomerId,
          polarSubscriptionId: existing?.polarSubscriptionId,
          status,
          currentPeriodEnd: existing?.currentPeriodEnd,
          cachedAt: new Date(),
        });
        break;
      }

      default:
        break;
    }
  }
}
