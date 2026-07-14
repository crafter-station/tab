import { Polar } from "@polar-sh/sdk";
import { validateEvent } from "@polar-sh/sdk/webhooks";
import { and, eq, sql } from "drizzle-orm";
import {
  isPlanId,
  planCapabilities,
  type BillingInterval,
  type PaidPlanId,
  type PlanId,
} from "@tab/billing";
import type {
  AllowanceState,
  BillingStatusData,
  EntitlementSource,
} from "@tab/contracts";
import type { AppDatabase } from "./db/index.ts";
import {
  allowanceUsageEvents,
  usageRecords,
  user,
  userEntitlements,
} from "./db/schema.ts";
import { env } from "./env.ts";

type PolarServer = "production" | "sandbox";
export type AllowanceMetric = "local_accepted_words" | "deep_completes";

const DAY_MS = 24 * 60 * 60 * 1_000;

function getPolarServer(server?: PolarServer): PolarServer {
  return server ?? env.POLAR_SERVER;
}

function optionalEnvString(value: string | undefined): string | undefined {
  return value && value.trim() ? value : undefined;
}

function optionalObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
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
  readonly billingInterval?: BillingInterval;
  readonly trialStartedAt: Date;
  readonly trialEndsAt: Date;
  readonly lastWebhookEventId?: string;
  readonly lastWebhookOccurredAt?: Date;
  readonly cachedAt: Date;
};

export type ResolvedEntitlement = {
  readonly stored: UserEntitlement;
  readonly planId: PlanId;
  readonly source: EntitlementSource;
};

export type DeepCompleteCheckResult = {
  readonly ok: boolean;
  readonly reason?: "quota_exhausted";
  readonly entitlement: ResolvedEntitlement;
  readonly status: BillingStatusData;
  readonly usage: number;
  readonly quota: number;
  readonly resetAt: Date;
  readonly recorded: boolean;
};

export type QuotaCheckResult = DeepCompleteCheckResult;

export interface BillingStorage {
  hasUser?(userId: string): Promise<boolean>;
  getEntitlement(userId: string): Promise<UserEntitlement | null>;
  setEntitlement(entitlement: UserEntitlement): Promise<void>;
  getAllowanceUsage(
    userId: string,
    metric: AllowanceMetric,
    period: string,
  ): Promise<number>;
  getAllowanceEvent(
    userId: string,
    metric: AllowanceMetric,
    eventId: string,
  ): Promise<{ period: string; amount: number } | null>;
  recordAllowanceUsage(
    userId: string,
    metric: AllowanceMetric,
    period: string,
    eventId: string,
    amount: number,
  ): Promise<boolean>;
  releaseAllowanceEvent(
    userId: string,
    metric: AllowanceMetric,
    eventId: string,
  ): Promise<void>;
  consumeAllowanceWithinLimit(
    userId: string,
    metric: AllowanceMetric,
    period: string,
    eventId: string,
    amount: number,
    limit: number,
  ): Promise<number | null>;
  acquireAllowanceWithinLimit(
    userId: string,
    metric: AllowanceMetric,
    period: string,
    eventId: string,
    amount: number,
    limit: number,
  ): Promise<{ usage: number; acquired: boolean } | null>;
  getUsage?(userId: string, period: string): Promise<number>;
  consumeUsageWithinLimit?(
    userId: string,
    period: string,
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
    const meterId =
      options.meterId ??
      env.POLAR_DEEP_COMPLETE_METER_ID;
    if (!meterId) {
      throw new Error("POLAR_DEEP_COMPLETE_METER_ID is not configured");
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
      if (!accessToken) throw new Error("POLAR_ACCESS_TOKEN is not configured");
      this.polar = new Polar({
        accessToken,
        server: getPolarServer(options.server),
      });
    }

    this.meterId = meterId;
    this.organizationId = organizationId;
  }

  async ingest(event: PolarUsageEvent): Promise<void> {
    void this.meterId;
    const creditsSpent = event.creditsSpent ?? 1;
    await this.polar.events.ingest({
      events: [
        {
          name: "deep_complete.used",
          externalCustomerId: event.userId,
          externalId: event.requestId,
          organizationId: this.organizationId,
          metadata: { requestId: event.requestId, creditsSpent },
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
  const meterId =
    options?.meterId ??
    env.POLAR_DEEP_COMPLETE_METER_ID;

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
      "Polar usage metering is partially configured. Set POLAR_ACCESS_TOKEN and POLAR_DEEP_COMPLETE_METER_ID.",
    );
  }
  return new InMemoryUsageMeterClient();
}

export interface BillingCheckoutClient {
  createCheckoutUrl(
    planId: PaidPlanId,
    interval: BillingInterval,
    user: { id: string; email?: string; name?: string },
  ): Promise<string>;
  createPortalUrl(userId: string, customerId?: string): Promise<string>;
}

export type CreatePolarBillingCheckoutClientOptions = {
  accessToken?: string;
  server?: PolarServer;
  productIds?: Partial<Record<PaidPlanId, string>>;
  successUrl?: string;
};

export class StubBillingCheckoutClient implements BillingCheckoutClient {
  async createCheckoutUrl(
    planId: PaidPlanId,
    interval: BillingInterval,
    user: { id: string; email?: string; name?: string },
  ): Promise<string> {
    void planId;
    void interval;
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
  private readonly productIds: Record<PaidPlanId, string>;
  private readonly successUrl: string | undefined;

  constructor(options: CreatePolarBillingCheckoutClientOptions = {}) {
    const accessToken = options.accessToken ?? env.POLAR_ACCESS_TOKEN;
    if (!accessToken) throw new Error("POLAR_ACCESS_TOKEN is not configured");

    const productIds: Partial<Record<PaidPlanId, string>> = {
      pro: env.POLAR_PRODUCT_ID_PRO_MONTHLY,
      max: env.POLAR_PRODUCT_ID_MAX_MONTHLY,
      ...options.productIds,
    };
    if (!productIds.pro || !productIds.max) {
      throw new Error("Polar Pro and Max monthly product ids are not configured");
    }

    this.polar = new Polar({
      accessToken,
      server: getPolarServer(options.server),
    });
    this.productIds = productIds as Record<PaidPlanId, string>;
    this.successUrl = optionalEnvString(
      options.successUrl ?? env.POLAR_CHECKOUT_SUCCESS_URL,
    );
  }

  async createCheckoutUrl(
    planId: PaidPlanId,
    interval: BillingInterval,
    user: { id: string; email?: string; name?: string },
  ): Promise<string> {
    try {
      return await this.createCheckoutUrlWithEmail(planId, interval, user);
    } catch (error) {
      if (!user.email || !isPolarInvalidCustomerEmailError(error)) throw error;
      return this.createCheckoutUrlWithEmail(planId, interval, {
        ...user,
        email: undefined,
      });
    }
  }

  private async createCheckoutUrlWithEmail(
    planId: PaidPlanId,
    interval: BillingInterval,
    user: { id: string; email?: string; name?: string },
  ): Promise<string> {
    const checkout = await this.polar.checkouts.create({
      products: [this.productIds[planId]],
      externalCustomerId: user.id,
      customerEmail: user.email,
      customerName: user.name,
      customerMetadata: { tabUserId: user.id },
      metadata: { planId, billingInterval: interval, tabUserId: user.id },
      successUrl: this.successUrl,
    });
    return checkout.url;
  }

  async createPortalUrl(userId: string, customerId?: string): Promise<string> {
    void userId;
    if (!customerId) {
      throw new Error("No Polar customer associated with this account");
    }
    const session = await this.polar.customerSessions.create({ customerId });
    return session.customerPortalUrl;
  }
}

export function createBillingCheckoutClient(
  options?: CreatePolarBillingCheckoutClientOptions,
): BillingCheckoutClient {
  const productIds = {
    pro: env.POLAR_PRODUCT_ID_PRO_MONTHLY,
    max: env.POLAR_PRODUCT_ID_MAX_MONTHLY,
    ...options?.productIds,
  };
  const accessToken = options?.accessToken ?? env.POLAR_ACCESS_TOKEN;

  if (accessToken && productIds.pro && productIds.max) {
    return new PolarBillingCheckoutClient(options);
  }
  if (accessToken || productIds.pro || productIds.max) {
    throw new Error(
      "Polar checkout is partially configured. Set POLAR_ACCESS_TOKEN, POLAR_PRODUCT_ID_PRO_MONTHLY, and POLAR_PRODUCT_ID_MAX_MONTHLY.",
    );
  }
  return new StubBillingCheckoutClient();
}

function utcMonth(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function nextUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

function nextUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
}

function allowanceState(
  period: string,
  used: number,
  limit: number | null,
  resetAt: Date,
): AllowanceState {
  return {
    period,
    used,
    limit,
    remaining: limit === null ? null : Math.max(0, limit - used),
    resetAt: resetAt.toISOString(),
    exhausted: limit !== null && used >= limit,
  };
}

export function hasActivePolarEntitlement(
  entitlement: UserEntitlement,
  now = new Date(),
): boolean {
  if (
    entitlement.planId === "free" ||
    !entitlement.polarCustomerId ||
    !entitlement.polarSubscriptionId
  ) {
    return false;
  }
  if (entitlement.status === "active") return true;
  return Boolean(
    entitlement.status === "canceled" &&
      entitlement.currentPeriodEnd &&
      entitlement.currentPeriodEnd > now,
  );
}

export type BillingServiceDependencies = {
  readonly storage?: BillingStorage;
  readonly now?: () => Date;
  readonly webhookSecret?: string;
};

export class BillingService {
  private readonly storage: BillingStorage;
  private readonly now: () => Date;
  private readonly webhookHandler: BillingWebhookHandler;

  constructor(deps: BillingServiceDependencies = {}) {
    if (!deps.storage) {
      throw new Error("BillingService requires a storage implementation");
    }
    this.storage = deps.storage;
    this.now = deps.now ?? (() => new Date());
    this.webhookHandler = new BillingWebhookHandler({
      storage: deps.storage,
      secret: deps.webhookSecret,
      now: this.now,
    });
  }

  async getEntitlement(userId: string): Promise<UserEntitlement> {
    const cached = await this.storage.getEntitlement(userId);
    if (cached) {
      const normalized = this.withTrial(cached);
      if (!cached.trialStartedAt || !cached.trialEndsAt) {
        await this.storage.setEntitlement(normalized);
      }
      return normalized;
    }

    const now = this.now();
    const defaultEntitlement: UserEntitlement = {
      userId,
      planId: "free",
      status: "inactive",
      trialStartedAt: now,
      trialEndsAt: new Date(now.getTime() + planCapabilities.free.trialDays * DAY_MS),
      cachedAt: now,
    };
    await this.storage.setEntitlement(defaultEntitlement);
    return defaultEntitlement;
  }

  async resolveEntitlement(userId: string): Promise<ResolvedEntitlement> {
    const stored = await this.getEntitlement(userId);
    const now = this.now();
    if (hasActivePolarEntitlement(stored, now)) {
      return { stored, planId: stored.planId, source: "paid" };
    }
    if (stored.trialEndsAt > now) {
      return { stored, planId: "pro", source: "trial" };
    }
    return { stored, planId: "free", source: "free" };
  }

  async getStatus(
    userId: string,
    options: {
      localDay?: string;
      localResetAt?: Date;
      activeDevices?: number;
    } = {},
  ): Promise<BillingStatusData> {
    const now = this.now();
    const entitlement = await this.resolveEntitlement(userId);
    const capabilities = planCapabilities[entitlement.planId];
    const localPeriod = options.localDay ?? utcDay(now);
    const deepPeriod = utcMonth(now);
    const [localUsage, deepUsage] = await Promise.all([
      this.storage.getAllowanceUsage(
        userId,
        "local_accepted_words",
        localPeriod,
      ),
      this.storage.getAllowanceUsage(userId, "deep_completes", deepPeriod),
    ]);
    const activeDevices = options.activeDevices ?? 0;

    return {
      planId: entitlement.planId,
      entitlementSource: entitlement.source,
      billingInterval:
        entitlement.source === "paid"
          ? entitlement.stored.billingInterval
          : undefined,
      accessEndsAt:
        entitlement.source === "paid"
          ? entitlement.stored.currentPeriodEnd?.toISOString()
          : undefined,
      capabilities: {
        localAcceptedWordsPerDay: capabilities.localAcceptedWordsPerDay,
        deepCompletesPerMonth: capabilities.deepCompletesPerMonth,
        personalDeviceLimit: capabilities.personalDeviceLimit,
        continuousMemoryExtraction: capabilities.continuousMemoryExtraction,
        customWritingInstructions: capabilities.customWritingInstructions,
        modelCatalogAccess: capabilities.modelCatalogAccess,
      },
      trial: {
        active: entitlement.source === "trial",
        startedAt: entitlement.stored.trialStartedAt.toISOString(),
        endsAt: entitlement.stored.trialEndsAt.toISOString(),
      },
      localAcceptedWords: allowanceState(
        localPeriod,
        localUsage,
        capabilities.localAcceptedWordsPerDay,
        options.localResetAt ?? nextUtcDay(now),
      ),
      deepCompletes: allowanceState(
        deepPeriod,
        deepUsage,
        capabilities.deepCompletesPerMonth,
        nextUtcMonth(now),
      ),
      devices: {
        active: activeDevices,
        limit: capabilities.personalDeviceLimit,
        canLink: activeDevices < capabilities.personalDeviceLimit,
      },
      upgradeUrl: entitlement.planId === "free" ? "/pricing" : undefined,
    };
  }

  async checkDeepComplete(userId: string): Promise<DeepCompleteCheckResult> {
    const status = await this.getStatus(userId);
    const entitlement = await this.resolveEntitlement(userId);
    return {
      ok: !status.deepCompletes.exhausted,
      reason: status.deepCompletes.exhausted ? "quota_exhausted" : undefined,
      entitlement,
      status,
      usage: status.deepCompletes.used,
      quota: status.deepCompletes.limit ?? 0,
      resetAt: new Date(status.deepCompletes.resetAt),
      recorded: false,
    };
  }

  async consumeDeepComplete(
    userId: string,
    requestId: string,
  ): Promise<DeepCompleteCheckResult> {
    const check = await this.checkDeepComplete(userId);
    const period = utcMonth(this.now());
    const existing = await this.storage.getAllowanceEvent(
      userId,
      "deep_completes",
      requestId,
    );
    if (existing) {
      const status = await this.getStatus(userId);
      return {
        ...check,
        ok: true,
        reason: undefined,
        status,
        usage: status.deepCompletes.used,
        recorded: false,
      };
    }
    if (!check.ok) return check;

    const reservation = await this.storage.acquireAllowanceWithinLimit(
      userId,
      "deep_completes",
      period,
      requestId,
      1,
      check.quota,
    );
    if (reservation === null) {
      const status = await this.getStatus(userId);
      return {
        ...check,
        ok: false,
        reason: "quota_exhausted",
        status,
        usage: status.deepCompletes.used,
        recorded: false,
      };
    }

    const status = await this.getStatus(userId);
    return {
      ...check,
      ok: true,
      reason: undefined,
      status,
      usage: reservation.usage,
      recorded: reservation.acquired,
    };
  }

  async releaseDeepComplete(userId: string, requestId: string): Promise<void> {
    await this.storage.releaseAllowanceEvent(
      userId,
      "deep_completes",
      requestId,
    );
  }

  async recordLocalAcceptedWords(input: {
    userId: string;
    acceptanceId: string;
    localDay: string;
    words: number;
  }): Promise<BillingStatusData> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.localDay)) {
      throw new Error("Local Accepted Word day must use YYYY-MM-DD");
    }
    if (!Number.isInteger(input.words) || input.words < 0) {
      throw new Error("Accepted Word count must be a nonnegative integer");
    }
    if (input.words > 0) {
      await this.storage.recordAllowanceUsage(
        input.userId,
        "local_accepted_words",
        input.localDay,
        input.acceptanceId,
        input.words,
      );
    }
    return this.getStatus(input.userId, { localDay: input.localDay });
  }

  async applyEntitlement(entitlement: UserEntitlement): Promise<void> {
    await this.storage.setEntitlement(this.withTrial(entitlement));
  }

  validatePaidEntitlementEvent(
    body: string,
    headers: Record<string, string | undefined>,
  ): WebhookValidationResult {
    return this.webhookHandler.validateRequest(body, headers);
  }

  async applyPaidEntitlementEvent(payload: PolarWebhookPayload): Promise<void> {
    await this.webhookHandler.handle(payload);
  }

  private withTrial(entitlement: UserEntitlement): UserEntitlement {
    const startedAt = entitlement.trialStartedAt ?? this.now();
    return {
      ...entitlement,
      trialStartedAt: startedAt,
      trialEndsAt:
        entitlement.trialEndsAt ??
        new Date(
          startedAt.getTime() + planCapabilities.free.trialDays * DAY_MS,
        ),
    };
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
          await new Promise((resolve) =>
            setTimeout(resolve, this.retryDelayMs * 2 ** attempt),
          );
        }
      }
    }
    throw lastError ?? new Error("Usage metering failed after retries");
  }
}

export class InMemoryBillingStorage implements BillingStorage {
  private entitlements = new Map<string, UserEntitlement>();
  private events = new Map<
    string,
    { period: string; amount: number; createdAt: string }
  >();
  private consumptionTail: Promise<void> = Promise.resolve();

  async getEntitlement(userId: string): Promise<UserEntitlement | null> {
    return this.entitlements.get(userId) ?? null;
  }

  async setEntitlement(entitlement: UserEntitlement): Promise<void> {
    this.entitlements.set(entitlement.userId, entitlement);
  }

  async getAllowanceUsage(
    userId: string,
    metric: AllowanceMetric,
    period: string,
  ): Promise<number> {
    let usage = 0;
    const prefix = `${userId}:${metric}:`;
    for (const [key, event] of this.events) {
      if (key.startsWith(prefix) && event.period === period) usage += event.amount;
    }
    return usage;
  }

  async getAllowanceEvent(
    userId: string,
    metric: AllowanceMetric,
    eventId: string,
  ): Promise<{ period: string; amount: number } | null> {
    return this.events.get(`${userId}:${metric}:${eventId}`) ?? null;
  }

  async recordAllowanceUsage(
    userId: string,
    metric: AllowanceMetric,
    period: string,
    eventId: string,
    amount: number,
  ): Promise<boolean> {
    const key = `${userId}:${metric}:${eventId}`;
    if (this.events.has(key)) return false;
    this.events.set(key, {
      period,
      amount,
      createdAt: new Date().toISOString(),
    });
    return true;
  }

  async releaseAllowanceEvent(
    userId: string,
    metric: AllowanceMetric,
    eventId: string,
  ): Promise<void> {
    this.events.delete(`${userId}:${metric}:${eventId}`);
  }

  async consumeAllowanceWithinLimit(
    userId: string,
    metric: AllowanceMetric,
    period: string,
    eventId: string,
    amount: number,
    limit: number,
  ): Promise<number | null> {
    const result = await this.acquireAllowanceWithinLimit(
      userId,
      metric,
      period,
      eventId,
      amount,
      limit,
    );
    return result?.usage ?? null;
  }

  async acquireAllowanceWithinLimit(
    userId: string,
    metric: AllowanceMetric,
    period: string,
    eventId: string,
    amount: number,
    limit: number,
  ): Promise<{ usage: number; acquired: boolean } | null> {
    const previous = this.consumptionTail;
    let release!: () => void;
    this.consumptionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const existing = await this.getAllowanceEvent(userId, metric, eventId);
      if (existing) {
        return {
          usage: await this.getAllowanceUsage(userId, metric, existing.period),
          acquired: false,
        };
      }
      const usage = await this.getAllowanceUsage(userId, metric, period);
      if (usage + amount > limit) return null;
      await this.recordAllowanceUsage(userId, metric, period, eventId, amount);
      return { usage: usage + amount, acquired: true };
    } finally {
      release();
    }
  }

  async getUsage(userId: string, period: string): Promise<number> {
    return this.getAllowanceUsage(userId, "deep_completes", period);
  }

  async consumeUsageWithinLimit(
    userId: string,
    period: string,
    limit: number,
  ): Promise<number | null> {
    return this.consumeAllowanceWithinLimit(
      userId,
      "deep_completes",
      period,
      crypto.randomUUID(),
      1,
      limit,
    );
  }
}

function entitlementRowToEntitlement(
  row: typeof userEntitlements.$inferSelect,
): UserEntitlement {
  const cachedAt = new Date(row.cachedAt);
  const initializedAt = new Date();
  const trialStartedAt = row.trialStartedAt
    ? new Date(row.trialStartedAt)
    : initializedAt;
  const trialEndsAt = row.trialEndsAt
    ? new Date(row.trialEndsAt)
    : new Date(trialStartedAt.getTime() + planCapabilities.free.trialDays * DAY_MS);
  return {
    userId: row.userId,
    planId: isPlanId(row.planId) ? row.planId : "free",
    polarCustomerId: row.polarCustomerId ?? undefined,
    polarSubscriptionId: row.polarSubscriptionId ?? undefined,
    status: normalizeStatus(row.status),
    currentPeriodEnd: row.currentPeriodEnd
      ? new Date(row.currentPeriodEnd)
      : undefined,
    billingInterval:
      row.billingInterval === "monthly" ? row.billingInterval : undefined,
    trialStartedAt,
    trialEndsAt,
    lastWebhookEventId: row.lastWebhookEventId ?? undefined,
    lastWebhookOccurredAt: row.lastWebhookOccurredAt
      ? new Date(row.lastWebhookOccurredAt)
      : undefined,
    cachedAt,
  };
}

export class D1BillingStorage implements BillingStorage {
  constructor(private readonly db: AppDatabase) {}

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
    if (!row) return null;
    const entitlement = entitlementRowToEntitlement(row);
    if (!row.trialStartedAt || !row.trialEndsAt) {
      await this.db
        .update(userEntitlements)
        .set({
          trialStartedAt: sql<string>`coalesce(${userEntitlements.trialStartedAt}, ${entitlement.trialStartedAt.toISOString()})`,
          trialEndsAt: sql<string>`coalesce(${userEntitlements.trialEndsAt}, ${entitlement.trialEndsAt.toISOString()})`,
        })
        .where(eq(userEntitlements.userId, userId));
      const normalized = await this.db.query.userEntitlements.findFirst({
        where: eq(userEntitlements.userId, userId),
      });
      return normalized ? entitlementRowToEntitlement(normalized) : entitlement;
    }
    return entitlement;
  }

  async setEntitlement(entitlement: UserEntitlement): Promise<void> {
    const trialStartedAt = entitlement.trialStartedAt ?? entitlement.cachedAt;
    const trialEndsAt =
      entitlement.trialEndsAt ??
      new Date(trialStartedAt.getTime() + planCapabilities.free.trialDays * DAY_MS);
    const values = {
      planId: entitlement.planId,
      polarCustomerId: entitlement.polarCustomerId ?? null,
      polarSubscriptionId: entitlement.polarSubscriptionId ?? null,
      status: entitlement.status,
      currentPeriodEnd: entitlement.currentPeriodEnd?.toISOString() ?? null,
      billingInterval: entitlement.billingInterval ?? null,
      trialStartedAt: trialStartedAt.toISOString(),
      trialEndsAt: trialEndsAt.toISOString(),
      lastWebhookEventId: entitlement.lastWebhookEventId ?? null,
      lastWebhookOccurredAt:
        entitlement.lastWebhookOccurredAt?.toISOString() ?? null,
      cachedAt: entitlement.cachedAt.toISOString(),
    };
    await this.db
      .insert(userEntitlements)
      .values({ userId: entitlement.userId, ...values })
      .onConflictDoUpdate({ target: userEntitlements.userId, set: values });
  }

  async getAllowanceUsage(
    userId: string,
    metric: AllowanceMetric,
    period: string,
  ): Promise<number> {
    const rows = await this.db
      .select({ total: sql<number>`coalesce(sum(${allowanceUsageEvents.amount}), 0)` })
      .from(allowanceUsageEvents)
      .where(
        and(
          eq(allowanceUsageEvents.userId, userId),
          eq(allowanceUsageEvents.metric, metric),
          eq(allowanceUsageEvents.period, period),
        ),
      );
    return Number(rows[0]?.total ?? 0);
  }

  async getAllowanceEvent(
    userId: string,
    metric: AllowanceMetric,
    eventId: string,
  ): Promise<{ period: string; amount: number } | null> {
    const row = await this.db.query.allowanceUsageEvents.findFirst({
      columns: { period: true, amount: true },
      where: and(
        eq(allowanceUsageEvents.userId, userId),
        eq(allowanceUsageEvents.metric, metric),
        eq(allowanceUsageEvents.eventId, eventId),
      ),
    });
    return row ?? null;
  }

  async recordAllowanceUsage(
    userId: string,
    metric: AllowanceMetric,
    period: string,
    eventId: string,
    amount: number,
  ): Promise<boolean> {
    const rows = await this.db
      .insert(allowanceUsageEvents)
      .values({
        userId,
        metric,
        period,
        eventId,
        amount,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoNothing()
      .returning({ eventId: allowanceUsageEvents.eventId });
    return rows.length > 0;
  }

  async releaseAllowanceEvent(
    userId: string,
    metric: AllowanceMetric,
    eventId: string,
  ): Promise<void> {
    await this.db
      .delete(allowanceUsageEvents)
      .where(
        and(
          eq(allowanceUsageEvents.userId, userId),
          eq(allowanceUsageEvents.metric, metric),
          eq(allowanceUsageEvents.eventId, eventId),
        ),
      );
  }

  async consumeAllowanceWithinLimit(
    userId: string,
    metric: AllowanceMetric,
    period: string,
    eventId: string,
    amount: number,
    limit: number,
  ): Promise<number | null> {
    const result = await this.acquireAllowanceWithinLimit(
      userId,
      metric,
      period,
      eventId,
      amount,
      limit,
    );
    return result?.usage ?? null;
  }

  async acquireAllowanceWithinLimit(
    userId: string,
    metric: AllowanceMetric,
    period: string,
    eventId: string,
    amount: number,
    limit: number,
  ): Promise<{ usage: number; acquired: boolean } | null> {
    const existing = await this.getAllowanceEvent(userId, metric, eventId);
    if (existing) {
      return {
        usage: await this.getAllowanceUsage(userId, metric, existing.period),
        acquired: false,
      };
    }

    const inserted = await this.db.get<{ eventId: string }>(sql`
      INSERT INTO allowance_usage_events (
        user_id, metric, event_id, period, amount, created_at
      )
      SELECT ${userId}, ${metric}, ${eventId}, ${period}, ${amount}, ${new Date().toISOString()}
      WHERE (
        SELECT coalesce(sum(amount), 0)
        FROM allowance_usage_events
        WHERE user_id = ${userId}
          AND metric = ${metric}
          AND period = ${period}
      ) + ${amount} <= ${limit}
      ON CONFLICT DO NOTHING
      RETURNING event_id AS eventId
    `);
    if (!inserted) {
      const duplicate = await this.getAllowanceEvent(userId, metric, eventId);
      return duplicate
        ? {
            usage: await this.getAllowanceUsage(
              userId,
              metric,
              duplicate.period,
            ),
            acquired: false,
          }
        : null;
    }
    return {
      usage: await this.getAllowanceUsage(userId, metric, period),
      acquired: true,
    };
  }

  async getUsage(userId: string, period: string): Promise<number> {
    const newUsage = await this.getAllowanceUsage(
      userId,
      "deep_completes",
      period,
    );
    if (newUsage > 0) return newUsage;
    const legacy = await this.db.query.usageRecords.findFirst({
      where: and(eq(usageRecords.userId, userId), eq(usageRecords.month, period)),
    });
    return legacy?.count ?? 0;
  }

  async consumeUsageWithinLimit(
    userId: string,
    period: string,
    limit: number,
  ): Promise<number | null> {
    return this.consumeAllowanceWithinLimit(
      userId,
      "deep_completes",
      period,
      crypto.randomUUID(),
      1,
      limit,
    );
  }
}

type PolarWebhookPayload = {
  readonly id?: string;
  readonly type: string;
  readonly timestamp?: string;
  readonly createdAt?: string;
  readonly data: Record<string, unknown>;
};

function optionalString(value: unknown): string | undefined {
  return value ? String(value) : undefined;
}

function optionalDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (!value) return undefined;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return optionalObject(value);
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

function planIdFromProductId(productId: string | undefined): PlanId | null {
  if (!productId) return null;
  if (productId === env.POLAR_PRODUCT_ID_PRO_MONTHLY) {
    return "pro";
  }
  if (productId === env.POLAR_PRODUCT_ID_MAX_MONTHLY) return "max";
  return null;
}

function intervalFromProductId(
  productId: string | undefined,
): BillingInterval | undefined {
  if (!productId) return undefined;
  if (
    productId === env.POLAR_PRODUCT_ID_PRO_MONTHLY ||
    productId === env.POLAR_PRODUCT_ID_MAX_MONTHLY
  ) {
    return "monthly";
  }
  return undefined;
}

function planIdFromMetadata(
  metadata: Record<string, unknown> | undefined,
): PlanId | null {
  const planId = optionalString(metadata?.planId ?? metadata?.plan_id);
  return isPlanId(planId) ? planId : null;
}

function intervalFromMetadata(
  metadata: Record<string, unknown> | undefined,
): BillingInterval | undefined {
  const value = optionalString(
    metadata?.billingInterval ?? metadata?.billing_interval,
  );
  return value === "monthly" ? value : undefined;
}

export type WebhookValidationResult =
  | { readonly valid: true; readonly payload: PolarWebhookPayload }
  | { readonly valid: false; readonly reason: string };

type WebhookHandlerDependencies = {
  readonly storage?: BillingStorage;
  readonly secret?: string;
  readonly now?: () => Date;
};

class BillingWebhookHandler {
  private readonly storage: BillingStorage;
  private readonly secret: string | undefined;
  private readonly now: () => Date;

  constructor(deps: WebhookHandlerDependencies = {}) {
    if (!deps.storage) {
      throw new Error("BillingWebhookHandler requires a storage implementation");
    }
    this.storage = deps.storage;
    this.secret = deps.secret ?? env.POLAR_WEBHOOK_SECRET;
    this.now = deps.now ?? (() => new Date());
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
      if (value !== undefined) validatedHeaders[key] = value;
    }
    try {
      const event = validateEvent(body, validatedHeaders, this.secret);
      return { valid: true, payload: event as unknown as PolarWebhookPayload };
    } catch {
      return { valid: false, reason: "Invalid webhook signature" };
    }
  }

  async handle(payload: PolarWebhookPayload): Promise<void> {
    const data = payload.data;
    const customer = optionalRecord(data.customer);
    const userId = firstString(
      customer?.external_id,
      customer?.externalId,
      customer?.externalCustomerId,
      data.external_customer_id,
      data.externalCustomerId,
      optionalRecord(data.metadata)?.tabUserId,
      optionalRecord(data.metadata)?.tab_user_id,
      optionalRecord(customer?.metadata)?.tabUserId,
      optionalRecord(customer?.metadata)?.tab_user_id,
    );
    if (!userId) return;
    if (this.storage.hasUser && !(await this.storage.hasUser(userId))) return;

    const existing = await this.storage.getEntitlement(userId);
    if (!existing) return;
    const webhookEventId = optionalString(payload.id);
    const occurredAt =
      optionalDate(payload.timestamp ?? payload.createdAt) ?? this.now();
    if (webhookEventId && existing.lastWebhookEventId === webhookEventId) return;
    if (
      existing.lastWebhookOccurredAt &&
      occurredAt < existing.lastWebhookOccurredAt
    ) {
      return;
    }

    switch (payload.type) {
      case "subscription.active":
      case "subscription.created":
      case "subscription.updated":
      case "subscription.past_due":
      case "subscription.revoked": {
        const product = optionalRecord(data.product);
        const metadata = optionalRecord(data.metadata);
        const productMetadata = optionalRecord(product?.metadata);
        const customerId = firstString(
          data.customer_id,
          data.customerId,
          customer?.id,
        );
        const subscriptionId = optionalString(data.id);
        if (!customerId || !subscriptionId) return;

        const status =
          payload.type === "subscription.active"
            ? "active"
            : payload.type === "subscription.past_due"
              ? "past_due"
              : payload.type === "subscription.revoked"
                ? "inactive"
                : normalizeStatus(optionalString(data.status));
        const productId = firstString(
          data.product_id,
          data.productId,
          product?.id,
        );
        const productName = optionalString(product?.name);
        const configuredProductIds = [
          env.POLAR_PRODUCT_ID_PRO_MONTHLY,
          env.POLAR_PRODUCT_ID_MAX_MONTHLY,
        ].filter(Boolean);
        const planId = productId && configuredProductIds.length > 0
          ? planIdFromProductId(productId)
          : planIdFromProductId(productId) ??
            planIdFromMetadata(productMetadata) ??
            (productName ? planIdFromProductName(productName) : null) ??
            planIdFromMetadata(metadata);
        if (!planId || planId === "free") return;
        const billingInterval =
          intervalFromProductId(productId) ??
          intervalFromMetadata(productMetadata) ??
          intervalFromMetadata(metadata) ??
          existing.billingInterval;

        await this.storage.setEntitlement({
          ...existing,
          planId,
          polarCustomerId: customerId,
          polarSubscriptionId: subscriptionId,
          status,
          currentPeriodEnd:
            optionalDate(data.current_period_end ?? data.currentPeriodEnd) ??
            existing.currentPeriodEnd,
          billingInterval,
          lastWebhookEventId: webhookEventId,
          lastWebhookOccurredAt: occurredAt,
          cachedAt: this.now(),
        });
        break;
      }

      case "subscription.canceled":
      case "subscription.uncanceled":
        await this.storage.setEntitlement({
          ...existing,
          status:
            payload.type === "subscription.canceled" ? "canceled" : "active",
          currentPeriodEnd:
            optionalDate(data.current_period_end ?? data.currentPeriodEnd) ??
            existing.currentPeriodEnd,
          lastWebhookEventId: webhookEventId,
          lastWebhookOccurredAt: occurredAt,
          cachedAt: this.now(),
        });
        break;

      default:
        break;
    }
  }
}
