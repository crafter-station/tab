import { Polar } from "@polar-sh/sdk";
import { validateEvent } from "@polar-sh/sdk/webhooks";
import { and, eq, lt, sql } from "drizzle-orm";
import { planQuotas, type PlanId } from "@tab/billing";
import type { AppDatabase } from "./db/index.ts";
import { usageRecords, user, userEntitlements } from "./db/schema.ts";
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
      readonly reason: "billing_required" | "quota_exhausted";
      readonly entitlement: UserEntitlement;
      readonly usage: number;
      readonly quota: number;
      readonly resetAt: Date;
    };

export interface BillingStorage {
  hasUser?(userId: string): Promise<boolean>;
  getEntitlement(userId: string): Promise<UserEntitlement | null>;
  setEntitlement(entitlement: UserEntitlement): Promise<void>;
  getUsage(userId: string, month: string): Promise<number>;
  consumeUsageWithinLimit(
    userId: string,
    month: string,
    limit: number,
  ): Promise<number | null>;
}

export type PolarUsageEvent = {
  readonly userId: string;
  readonly requestId: string;
  readonly timestamp: Date;
  readonly creditsSpent?: number;
};

export interface UsageMeterClient {
  ingest(event: PolarUsageEvent): Promise<void>;
}

export type CreatePolarUsageMeterClientOptions = {
  readonly accessToken?: string;
  readonly server?: PolarServer;
  readonly meterId?: string;
  readonly organizationId?: string;
  readonly polar?: Polar;
};

export class PolarUsageMeterClient implements UsageMeterClient {
  private readonly polar: Polar;
  private readonly meterId: string;
  private readonly organizationId: string | undefined;

  constructor(options: CreatePolarUsageMeterClientOptions = {}) {
    const meterId = options.meterId ?? env.POLAR_AUTOCOMPLETE_METER_ID;
    if (!meterId) {
      throw new Error("POLAR_AUTOCOMPLETE_METER_ID is not configured");
    }

    const organizationId =
      options.organizationId ??
      (env.POLAR_SEND_ORGANIZATION_ID ? env.POLAR_ORGANIZATION_ID : undefined);
    if (env.POLAR_SEND_ORGANIZATION_ID && !organizationId) {
      throw new Error("POLAR_ORGANIZATION_ID is not configured");
    }

    if (options.polar) {
      this.polar = options.polar;
    } else {
      const accessToken = options.accessToken ?? env.POLAR_ACCESS_TOKEN;
      if (!accessToken) {
        throw new Error("POLAR_ACCESS_TOKEN is not configured");
      }
      this.polar = new Polar({
        accessToken,
        server: getPolarServer(options.server),
      });
    }

    this.meterId = meterId;
    this.organizationId = organizationId;
  }

  async ingest(event: PolarUsageEvent): Promise<void> {
    const creditsSpent = event.creditsSpent ?? 1;

    await this.polar.events.ingest({
      events: [
        {
          name: "autocomplete.used",
          externalCustomerId: event.userId,
          externalId: event.requestId,
          organizationId: this.organizationId,
          metadata: {
            requestId: event.requestId,
            creditsSpent,
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
    return new PolarUsageMeterClient({
      accessToken,
      meterId,
      server: options?.server,
      organizationId: options?.organizationId,
    });
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
        tabUserId: user.id,
      },
      metadata: {
        planId,
        tabUserId: user.id,
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

export function hasActivePolarEntitlement(entitlement: UserEntitlement): boolean {
  return Boolean(
    entitlement.status === "active" &&
      entitlement.polarCustomerId &&
      entitlement.polarSubscriptionId,
  );
}

export type BillingServiceDependencies = {
  readonly storage?: BillingStorage;
};

export class BillingService {
  readonly storage: BillingStorage;

  constructor(deps: BillingServiceDependencies = {}) {
    if (!deps.storage) {
      throw new Error("BillingService requires a storage implementation");
    }
    this.storage = deps.storage;
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
    return this.checkQuotaForMonth(userId, currentMonth());
  }

  async consumeSuggestion(userId: string): Promise<QuotaCheckResult> {
    const month = currentMonth();
    const quotaCheck = await this.checkQuotaForMonth(userId, month);
    if (!quotaCheck.ok) return quotaCheck;

    const count = await this.storage.consumeUsageWithinLimit(
      userId,
      month,
      quotaCheck.quota,
    );
    if (count === null) {
      return {
        ...quotaCheck,
        ok: false,
        reason: "quota_exhausted",
        usage: await this.storage.getUsage(userId, month),
      };
    }

    return { ...quotaCheck, usage: count };
  }

  async applyEntitlement(entitlement: UserEntitlement): Promise<void> {
    await this.storage.setEntitlement(entitlement);
  }

  private async checkQuotaForMonth(
    userId: string,
    month: string,
  ): Promise<QuotaCheckResult> {
    const entitlement = await this.getEntitlement(userId);
    const quota = planQuotas[entitlement.planId].monthlyAutocompleteSuggestions;
    const usage = await this.storage.getUsage(userId, month);
    const resetAt = nextResetDate();

    if (!hasActivePolarEntitlement(entitlement)) {
      return {
        ok: false,
        reason: "billing_required",
        entitlement,
        usage,
        quota,
        resetAt,
      };
    }

    if (usage >= quota) {
      return {
        ok: false,
        reason: "quota_exhausted",
        entitlement,
        usage,
        quota,
        resetAt,
      };
    }

    return { ok: true, entitlement, usage, quota, resetAt };
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
    if (!deps.client) {
      throw new Error("UsageMeterService requires a client implementation");
    }
    this.client = deps.client;
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

    console.error("Polar usage metering failed after retries:", {
      userId: event.userId,
      requestId: event.requestId,
      error: lastError?.message,
    });

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

  async consumeUsageWithinLimit(
    userId: string,
    month: string,
    limit: number,
  ): Promise<number | null> {
    if (limit <= 0) return null;

    const key = this.usageKey(userId, month);
    const current = this.usage.get(key) ?? 0;
    if (current >= limit) return null;

    const next = current + 1;
    this.usage.set(key, next);
    return next;
  }

  private usageKey(userId: string, month: string): string {
    return `${userId}:${month}`;
  }
}

function entitlementRowToEntitlement(
  row: typeof userEntitlements.$inferSelect,
): UserEntitlement {
  return {
    userId: row.userId,
    planId: row.planId as PlanId,
    polarCustomerId: row.polarCustomerId ?? undefined,
    polarSubscriptionId: row.polarSubscriptionId ?? undefined,
    status: row.status as UserEntitlement["status"],
    currentPeriodEnd: row.currentPeriodEnd
      ? new Date(row.currentPeriodEnd)
      : undefined,
    cachedAt: new Date(row.cachedAt),
  };
}

export class D1BillingStorage implements BillingStorage {
  private readonly db: AppDatabase;

  constructor(db: AppDatabase) {
    this.db = db;
  }

  async hasUser(userId: string): Promise<boolean> {
    const row = await this.db.query.user.findFirst({
      columns: { id: true },
      where: eq(user.id, userId),
    });
    return Boolean(row);
  }

  async getEntitlement(userId: string): Promise<UserEntitlement | null> {
    const row = await this.db.query.userEntitlements.findFirst({
      where: eq(userEntitlements.userId, userId),
    });
    return row ? entitlementRowToEntitlement(row) : null;
  }

  async setEntitlement(entitlement: UserEntitlement): Promise<void> {
    await this.db
      .insert(userEntitlements)
      .values({
        userId: entitlement.userId,
        planId: entitlement.planId,
        polarCustomerId: entitlement.polarCustomerId ?? null,
        polarSubscriptionId: entitlement.polarSubscriptionId ?? null,
        status: entitlement.status,
        currentPeriodEnd: entitlement.currentPeriodEnd?.toISOString() ?? null,
        cachedAt: entitlement.cachedAt.toISOString(),
      })
      .onConflictDoUpdate({
        target: userEntitlements.userId,
        set: {
          planId: entitlement.planId,
          polarCustomerId: entitlement.polarCustomerId ?? null,
          polarSubscriptionId: entitlement.polarSubscriptionId ?? null,
          status: entitlement.status,
          currentPeriodEnd: entitlement.currentPeriodEnd?.toISOString() ?? null,
          cachedAt: entitlement.cachedAt.toISOString(),
        },
      });
  }

  async getUsage(userId: string, month: string): Promise<number> {
    const row = await this.db.query.usageRecords.findFirst({
      where: and(
        eq(usageRecords.userId, userId),
        eq(usageRecords.month, month),
      ),
    });
    return row?.count ?? 0;
  }

  async consumeUsageWithinLimit(
    userId: string,
    month: string,
    limit: number,
  ): Promise<number | null> {
    if (limit <= 0) return null;

    const now = new Date().toISOString();
    const rows = await this.db
      .insert(usageRecords)
      .values({
        userId,
        month,
        count: 1,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [usageRecords.userId, usageRecords.month],
        set: {
          count: sql`${usageRecords.count} + 1`,
          updatedAt: now,
        },
        setWhere: lt(usageRecords.count, limit),
      })
      .returning({ count: usageRecords.count });

    return rows[0]?.count ?? null;
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
  if (value instanceof Date) return value;
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
    if (!deps.storage) {
      throw new Error("BillingWebhookHandler requires a storage implementation");
    }
    this.storage = deps.storage;
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
          customer?.externalId,
          customer?.externalCustomerId,
          data.external_customer_id,
          data.externalCustomerId,
          metadata?.tabUserId,
          metadata?.tab_user_id,
          customerMetadata?.tabUserId,
          customerMetadata?.tab_user_id,
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

        if (this.storage.hasUser && !(await this.storage.hasUser(userId))) {
          return;
        }

        const existing = await this.storage.getEntitlement(userId);
        const planId =
          planIdFromProductId(productId) ??
          planIdFromMetadata(productMetadata) ??
          (productName ? planIdFromProductName(productName) : null) ??
          planIdFromMetadata(metadata) ??
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
        const userId = firstString(
          customer?.external_id,
          customer?.externalId,
          customer?.externalCustomerId,
          data.external_customer_id,
          data.externalCustomerId,
        );
        if (!userId) return;

        if (this.storage.hasUser && !(await this.storage.hasUser(userId))) {
          return;
        }

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
