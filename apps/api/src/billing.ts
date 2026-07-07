import { Polar } from "@polar-sh/sdk";
import { validateEvent } from "@polar-sh/sdk/webhooks";
import { planQuotas, type PlanId } from "@tabb/billing";
import { env } from "./env.ts";

type PolarServer = "production" | "sandbox";

function getPolarServer(server?: PolarServer): PolarServer {
  return server ?? env.POLAR_SERVER;
}

function optionalEnvString(value: string | undefined): string | undefined {
  return value && value.trim() ? value : undefined;
}

function isPolarInvalidCustomerEmailError(error: unknown): boolean {
  const details = (error as { detail?: unknown }).detail;
  if (!Array.isArray(details)) return false;

  return details.some((detail) => {
    const record = optionalObject(detail);
    const location = Array.isArray(record?.loc) ? record.loc : [];
    return (
      location.includes("customer_email") &&
      optionalString(record?.type) === "value_error"
    );
  });
}

function optionalObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

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
  readonly server?: PolarServer;
  readonly meterId?: string;
};

export class PolarUsageMeterClient implements UsageMeterClient {
  private readonly polar: Polar;
  private readonly meterId: string;

  constructor(options: CreatePolarUsageMeterClientOptions = {}) {
    const accessToken = options.accessToken ?? env.POLAR_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error("POLAR_ACCESS_TOKEN is not configured");
    }

    const meterId = options.meterId ?? env.POLAR_AUTOCOMPLETE_METER_ID;
    if (!meterId) {
      throw new Error("POLAR_AUTOCOMPLETE_METER_ID is not configured");
    }

    this.polar = new Polar({
      accessToken,
      server: getPolarServer(options.server),
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

export function createUsageMeterClient(
  options?: CreatePolarUsageMeterClientOptions,
): UsageMeterClient {
  const accessToken = options?.accessToken ?? env.POLAR_ACCESS_TOKEN;
  const meterId = options?.meterId ?? env.POLAR_AUTOCOMPLETE_METER_ID;

  if (accessToken && meterId) {
    return new PolarUsageMeterClient(options);
  }

  if (accessToken || meterId) {
    throw new Error(
      "Polar usage metering is partially configured. Set POLAR_ACCESS_TOKEN and POLAR_AUTOCOMPLETE_METER_ID.",
    );
  }

  return new InMemoryUsageMeterClient();
}

export interface BillingCheckoutClient {
  createCheckoutUrl(
    planId: PlanId,
    user: { id: string; email?: string; name?: string },
  ): Promise<string>;
  createPortalUrl(userId: string, customerId?: string): Promise<string>;
}

export type CreatePolarBillingCheckoutClientOptions = {
  accessToken?: string;
  server?: PolarServer;
  productIds?: Partial<Record<PlanId, string>>;
  successUrl?: string;
};

export class StubBillingCheckoutClient implements BillingCheckoutClient {
  async createCheckoutUrl(
    planId: PlanId,
    user: { id: string; email?: string; name?: string },
  ): Promise<string> {
    void planId;
    void user;
    throw new Error("Polar checkout is not configured");
  }

  async createPortalUrl(userId: string, customerId?: string): Promise<string> {
    void userId;
    void customerId;
    throw new Error("Polar customer portal is not configured");
  }
}

export class PolarBillingCheckoutClient implements BillingCheckoutClient {
  private readonly polar: Polar;
  private readonly productIds: Record<PlanId, string>;
  private readonly successUrl: string | undefined;

  constructor(options: CreatePolarBillingCheckoutClientOptions = {}) {
    const accessToken = options.accessToken ?? env.POLAR_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error("POLAR_ACCESS_TOKEN is not configured");
    }

    const productIds: Partial<Record<PlanId, string>> = {
      free: env.POLAR_PRODUCT_ID_FREE,
      pro: env.POLAR_PRODUCT_ID_PRO,
      max: env.POLAR_PRODUCT_ID_MAX,
      ...options.productIds,
    };

    if (!productIds.free || !productIds.pro || !productIds.max) {
      throw new Error("Polar product ids are not configured");
    }

    this.polar = new Polar({
      accessToken,
      server: getPolarServer(options.server),
    });
    this.productIds = productIds as Record<PlanId, string>;
    this.successUrl = optionalEnvString(
      options.successUrl ?? env.POLAR_CHECKOUT_SUCCESS_URL,
    );
  }

  async createCheckoutUrl(
    planId: PlanId,
    user: { id: string; email?: string; name?: string },
  ): Promise<string> {
    try {
      return await this.createCheckoutUrlWithEmail(planId, user);
    } catch (error) {
      if (!user.email || !isPolarInvalidCustomerEmailError(error)) {
        throw error;
      }

      return this.createCheckoutUrlWithEmail(planId, {
        ...user,
        email: undefined,
      });
    }
  }

  private async createCheckoutUrlWithEmail(
    planId: PlanId,
    user: { id: string; email?: string; name?: string },
  ): Promise<string> {
    const checkout = await this.polar.checkouts.create({
      products: [this.productIds[planId]],
      externalCustomerId: user.id,
      customerEmail: user.email,
      customerName: user.name,
      customerMetadata: {
        tabbUserId: user.id,
      },
      metadata: {
        planId,
        tabbUserId: user.id,
      },
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
  const productIds = {
    free: env.POLAR_PRODUCT_ID_FREE,
    pro: env.POLAR_PRODUCT_ID_PRO,
    max: env.POLAR_PRODUCT_ID_MAX,
    ...options?.productIds,
  };
  const accessToken = options?.accessToken ?? env.POLAR_ACCESS_TOKEN;

  if (accessToken && productIds.free && productIds.pro && productIds.max) {
    return new PolarBillingCheckoutClient(options);
  }

  if (accessToken || productIds.free || productIds.pro || productIds.max) {
    throw new Error(
      "Polar checkout is partially configured. Set POLAR_ACCESS_TOKEN, POLAR_PRODUCT_ID_FREE, POLAR_PRODUCT_ID_PRO, and POLAR_PRODUCT_ID_MAX.",
    );
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
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const stringValue = optionalString(value);
    if (stringValue) return stringValue;
  }
  return undefined;
}

function normalizeStatus(value: string | undefined): UserEntitlement["status"] {
  switch (value) {
    case "active":
    case "canceled":
    case "past_due":
    case "unpaid":
    case "inactive":
      return value;
    case "revoked":
      return "inactive";
    default:
      return "inactive";
  }
}

function planIdFromProductName(name: string): PlanId | null {
  const lower = name.toLowerCase();
  if (lower.includes("max")) return "max";
  if (lower.includes("pro")) return "pro";
  if (lower.includes("free")) return "free";
  return null;
}

function planIdFromProductId(
  productId: string | undefined,
): PlanId | null {
  if (!productId) return null;
  if (productId === env.POLAR_PRODUCT_ID_FREE) return "free";
  if (productId === env.POLAR_PRODUCT_ID_PRO) return "pro";
  if (productId === env.POLAR_PRODUCT_ID_MAX) return "max";
  return null;
}

function planIdFromMetadata(
  metadata: Record<string, unknown> | undefined,
): PlanId | null {
  const planId = optionalString(metadata?.planId ?? metadata?.plan_id);
  return planId && planId in planQuotas ? (planId as PlanId) : null;
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
    this.secret = deps.secret ?? env.POLAR_WEBHOOK_SECRET;
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
      case "subscription.active":
      case "subscription.created":
      case "subscription.updated":
      case "subscription.past_due":
      case "subscription.revoked": {
        const customer = optionalRecord(data.customer);
        const product = optionalRecord(data.product);
        const metadata = optionalRecord(data.metadata);
        const customerMetadata = optionalRecord(customer?.metadata);
        const productMetadata = optionalRecord(product?.metadata);
        const userId = firstString(
          customer?.external_id,
          customer?.externalCustomerId,
          data.external_customer_id,
          data.externalCustomerId,
          metadata?.tabbUserId,
          metadata?.tabb_user_id,
          customerMetadata?.tabbUserId,
          customerMetadata?.tabb_user_id,
        );
        const customerId = firstString(data.customer_id, data.customerId, customer?.id);
        const subscriptionId = optionalString(data.id);
        const status =
          payload.type === "subscription.active"
            ? "active"
            : payload.type === "subscription.past_due"
              ? "past_due"
              : payload.type === "subscription.revoked"
                ? "inactive"
                : normalizeStatus(optionalString(data.status));
        const productName = optionalString(product?.name);
        const productId = firstString(data.product_id, data.productId, product?.id);
        const currentPeriodEnd = optionalDate(
          data.current_period_end ?? data.currentPeriodEnd,
        );

        if (!userId || !customerId || !subscriptionId) {
          return;
        }

        const existing = await this.storage.getEntitlement(userId);
        const planId =
          planIdFromMetadata(metadata) ??
          planIdFromMetadata(productMetadata) ??
          planIdFromProductId(productId) ??
          (productName ? planIdFromProductName(productName) : null) ??
          existing?.planId ??
          "free";

        await this.storage.setEntitlement({
          userId,
          planId,
          polarCustomerId: customerId,
          polarSubscriptionId: subscriptionId,
          status,
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
