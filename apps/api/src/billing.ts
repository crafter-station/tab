import { Polar } from "@polar-sh/sdk";
import { validateEvent } from "@polar-sh/sdk/webhooks";
import { and, eq, sql } from "drizzle-orm";
import {
  getAllowancePeriods,
  isPlanId,
  projectBillingStatus,
  projectEntitlement,
  type BillingInterval,
  type EntitlementFacts,
  type PaidPlanId,
  type PlanId,
} from "@tab/billing";
import type {
  BillingStatusData,
  EntitlementSource,
} from "@tab/contracts";
import type { AppDatabase } from "./db/index.ts";
import {
  allowanceUsageEvents,
  polarUsageOutbox,
  usageRecords,
  user,
  userEntitlements,
} from "./db/schema.ts";
import { env } from "./env.ts";

type PolarServer = "production" | "sandbox";
export type AllowanceMetric = "local_accepted_words" | "deep_completes";

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
  readonly polarProductId?: string;
  readonly status:
    | "active"
    | "trialing"
    | "canceled"
    | "past_due"
    | "unpaid"
    | "inactive";
  readonly currentPeriodStart?: Date;
  readonly currentPeriodEnd?: Date;
  readonly cancelAtPeriodEnd?: boolean;
  readonly billingInterval?: BillingInterval;
  readonly trialStartedAt?: Date;
  readonly trialEndsAt?: Date;
  readonly lastWebhookEventId?: string;
  readonly lastWebhookOccurredAt?: Date;
  readonly provisioningState?: "pending" | "provisioning" | "ready" | "retrying" | "failed";
  readonly provisioningAttempts?: number;
  readonly provisioningError?: string;
  readonly provisioningUpdatedAt?: Date;
  readonly reconciledAt?: Date;
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
  initializeEntitlement?(entitlement: UserEntitlement): Promise<UserEntitlement>;
  setEntitlement(entitlement: UserEntitlement): Promise<void>;
  applyWebhookEntitlement?(entitlement: UserEntitlement): Promise<boolean>;
  listAccountsNeedingProvisioning?(limit: number): Promise<Array<{
    id: string;
    email: string;
    name?: string;
  }>>;
  listAccountsNeedingReconciliation?(now: Date, limit: number): Promise<string[]>;
  claimAccountProvisioning?(userId: string, now: Date): Promise<boolean>;
  completeAccountProvisioning?(
    entitlement: UserEntitlement,
    claimedAt: Date,
    periodMove?: { metric: AllowanceMetric; from: string; to: string },
  ): Promise<boolean>;
  setReconciledEntitlement?(
    entitlement: UserEntitlement,
    expectedSubscriptionId: string,
    expectedCachedAt: Date,
  ): Promise<boolean>;
  moveAllowanceUsagePeriod?(
    userId: string,
    metric: AllowanceMetric,
    fromPeriod: string,
    toPeriod: string,
  ): Promise<void>;
  ensureEntitlementPeriod?(
    userId: string,
    period: { subscriptionId: string; startsAt: Date; endsAt: Date },
  ): Promise<UserEntitlement | null>;
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
  recordLocalAcceptedWordsWithUsage(input: {
    userId: string;
    acceptanceId: string;
    localDay: string;
    acceptedAt: Date;
    words: number;
  }): Promise<boolean>;
  enqueueDeepCompleteUsage(input: {
    userId: string;
    requestId: string;
    timestamp: Date;
  }): Promise<boolean>;
  claimPolarUsageOutbox(input: {
    now: Date;
    leaseOwner: string;
    leaseDurationMs: number;
    limit: number;
  }): Promise<PolarUsageOutboxEvent[]>;
  completePolarUsageOutbox(id: string, leaseOwner: string, deliveredAt: Date): Promise<void>;
  retryPolarUsageOutbox(input: {
    id: string;
    leaseOwner: string;
    nextAttemptAt: Date;
    failed: boolean;
    error: string;
  }): Promise<void>;
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
  acquireDeepCompleteWithinCurrentPeriod?(
    userId: string,
    period: string,
    eventId: string,
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
  readonly eventId: string;
  readonly eventName: "deep_complete.used" | "local_accepted_words.used";
  readonly timestamp: Date;
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
};

export type PolarUsageOutboxEvent = PolarUsageEvent & {
  readonly attemptCount: number;
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
    await this.polar.events.ingest({
      events: [
        {
          name: event.eventName,
          externalCustomerId: event.userId,
          externalId: event.eventId,
          organizationId: this.organizationId,
          metadata: { ...event.metadata },
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
    this.events.push({
      userId: event.userId,
      eventId: event.eventId,
      eventName: event.eventName,
      timestamp: event.timestamp,
      metadata: { ...event.metadata },
    });
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
    subscriptionId?: string,
  ): Promise<string>;
  createPortalUrl(userId: string, customerId?: string): Promise<string>;
}

export type CreatePolarBillingCheckoutClientOptions = {
  accessToken?: string;
  server?: PolarServer;
  productIds?: Partial<Record<PaidPlanId, string>>;
  successUrl?: string;
  polar?: Polar;
};

export class StubBillingCheckoutClient implements BillingCheckoutClient {
  async createCheckoutUrl(
    planId: PaidPlanId,
    interval: BillingInterval,
    user: { id: string; email?: string; name?: string },
    subscriptionId?: string,
  ): Promise<string> {
    void planId;
    void interval;
    void user;
    void subscriptionId;
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
    if (!accessToken && !options.polar) throw new Error("POLAR_ACCESS_TOKEN is not configured");

    const productIds: Partial<Record<PaidPlanId, string>> = {
      pro: env.POLAR_PRODUCT_ID_PRO_MONTHLY,
      max: env.POLAR_PRODUCT_ID_MAX_MONTHLY,
      ...options.productIds,
    };
    if (!productIds.pro || !productIds.max) {
      throw new Error("Polar Pro and Max monthly product ids are not configured");
    }

    this.polar = options.polar ?? new Polar({
      accessToken: accessToken!,
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
    subscriptionId?: string,
  ): Promise<string> {
    try {
      return await this.createCheckoutUrlWithEmail(planId, interval, user, subscriptionId);
    } catch (error) {
      if (!user.email || !isPolarInvalidCustomerEmailError(error)) throw error;
      return this.createCheckoutUrlWithEmail(
        planId,
        interval,
        { ...user, email: undefined },
        subscriptionId,
      );
    }
  }

  private async createCheckoutUrlWithEmail(
    planId: PaidPlanId,
    interval: BillingInterval,
    user: { id: string; email?: string; name?: string },
    subscriptionId?: string,
  ): Promise<string> {
    const checkout = await this.polar.checkouts.create({
      products: [this.productIds[planId]],
      subscriptionId,
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

export type PolarSubscriptionSnapshot = {
  readonly customerId: string;
  readonly subscriptionId: string;
  readonly productId: string;
  readonly status: UserEntitlement["status"];
  readonly currentPeriodStart: Date;
  readonly currentPeriodEnd: Date;
  readonly cancelAtPeriodEnd: boolean;
  readonly trialStartedAt?: Date;
  readonly trialEndsAt?: Date;
};

export interface BillingProvisioningClient {
  provisionFreeSubscription(user: {
    id: string;
    email: string;
    name?: string;
  }): Promise<PolarSubscriptionSnapshot>;
  getSubscription(subscriptionId: string): Promise<PolarSubscriptionSnapshot>;
}

export class PolarBillingProvisioningClient implements BillingProvisioningClient {
  private readonly polar: Polar;
  private freeProductId: string | undefined;

  constructor(options: {
    accessToken?: string;
    server?: PolarServer;
    freeProductId?: string;
    polar?: Polar;
  } = {}) {
    const accessToken = options.accessToken ?? env.POLAR_ACCESS_TOKEN;
    this.freeProductId = options.freeProductId ?? env.POLAR_PRODUCT_ID_FREE_MONTHLY;
    if (options.polar) this.polar = options.polar;
    else {
      if (!accessToken) throw new Error("POLAR_ACCESS_TOKEN is not configured");
      this.polar = new Polar({ accessToken, server: getPolarServer(options.server) });
    }
  }

  async provisionFreeSubscription(user: {
    id: string;
    email: string;
    name?: string;
  }): Promise<PolarSubscriptionSnapshot> {
    const freeProductId = await this.resolveFreeProductId();
    let customer;
    try {
      customer = await this.polar.customers.getExternal({ externalId: user.id });
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode !== 404) throw error;
      try {
        customer = await this.polar.customers.create({
          externalId: user.id,
          email: user.email,
          name: user.name,
          metadata: { tabUserId: user.id },
        });
      } catch {
        customer = await this.polar.customers.getExternal({ externalId: user.id });
      }
    }

    const listed = await this.polar.subscriptions.list({
      externalCustomerId: user.id,
      active: true,
      limit: 100,
    });
    const subscriptions = listed.result.items;
    const subscription =
      subscriptions.find((item) => item.productId === freeProductId) ??
      subscriptions[0] ??
      await this.polar.subscriptions.create({
        productId: freeProductId,
        customerId: customer.id,
        metadata: { planId: "free", tabUserId: user.id },
      });
    return this.snapshot(subscription);
  }

  private async resolveFreeProductId(): Promise<string> {
    if (this.freeProductId) return this.freeProductId;
    const listed = await this.polar.products.list({
      metadata: { planId: "free", billingInterval: "monthly" },
      isArchived: false,
      isRecurring: true,
      limit: 100,
    });
    const product = listed.result.items.find((item) =>
      item.recurringInterval === "month" &&
      item.prices.some((price) =>
        !price.isArchived &&
        (price.amountType === "free" ||
          (price.amountType === "fixed" && price.priceAmount === 0))
      )
    );
    if (!product) throw new Error("Polar Free monthly product is not configured");
    this.freeProductId = product.id;
    return product.id;
  }

  async getSubscription(subscriptionId: string): Promise<PolarSubscriptionSnapshot> {
    return this.snapshot(await this.polar.subscriptions.get({ id: subscriptionId }));
  }

  private snapshot(subscription: Awaited<ReturnType<Polar["subscriptions"]["get"]>>): PolarSubscriptionSnapshot {
    return {
      customerId: subscription.customerId,
      subscriptionId: subscription.id,
      productId: subscription.productId,
      status: normalizeStatus(subscription.status),
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      trialStartedAt: subscription.trialStart ?? undefined,
      trialEndsAt: subscription.trialEnd ?? undefined,
    };
  }
}

export function createBillingProvisioningClient(): BillingProvisioningClient | undefined {
  if (!env.POLAR_ACCESS_TOKEN) return undefined;
  return new PolarBillingProvisioningClient();
}

function entitlementFacts(entitlement: UserEntitlement): EntitlementFacts {
  const period = {
    subscriptionId: entitlement.polarSubscriptionId,
    currentPeriodStart: entitlement.currentPeriodStart?.toISOString(),
    currentPeriodEnd: entitlement.currentPeriodEnd?.toISOString(),
    cancelAtPeriodEnd: entitlement.cancelAtPeriodEnd,
  };
  if (entitlement.planId === "free") return { planId: "free", source: "free", ...period };
  if (entitlement.status === "trialing" && entitlement.trialEndsAt) {
    return {
      planId: entitlement.planId,
      source: "trial",
      effectiveEnd: entitlement.trialEndsAt.toISOString(),
      trialStartedAt: entitlement.trialStartedAt?.toISOString(),
      ...period,
    };
  }
  if (
    entitlement.status === "active" ||
    (entitlement.status === "canceled" && entitlement.currentPeriodEnd)
  ) {
    return {
      planId: entitlement.planId,
      source: "paid",
      effectiveEnd: entitlement.currentPeriodEnd?.toISOString(),
      billingInterval: entitlement.billingInterval,
      ...period,
    };
  }
  return { planId: "free", source: "free", ...period };
}

function nextCalendarMonth(date: Date): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();
  return new Date(Date.UTC(
    year,
    month + 1,
    Math.min(day, lastDay),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  ));
}

function withProvisionalPeriod(entitlement: UserEntitlement, now: Date): UserEntitlement {
  if (
    entitlement.polarSubscriptionId &&
    entitlement.currentPeriodStart &&
    entitlement.currentPeriodEnd
  ) {
    return entitlement;
  }
  return {
    ...entitlement,
    polarSubscriptionId:
      entitlement.polarSubscriptionId ?? `pending:${entitlement.userId}`,
    currentPeriodStart: entitlement.currentPeriodStart ?? now,
    currentPeriodEnd: entitlement.currentPeriodEnd ?? nextCalendarMonth(now),
  };
}

export function hasActivePolarEntitlement(
  entitlement: UserEntitlement,
  now: Date,
): boolean {
  if (
    entitlement.planId === "free" ||
    !entitlement.polarCustomerId ||
    !entitlement.polarSubscriptionId
  ) {
    return false;
  }
  return projectEntitlement(entitlementFacts(entitlement), now).source !== "free";
}

export type BillingServiceDependencies = {
  readonly storage?: BillingStorage;
  readonly now?: () => Date;
  readonly webhookSecret?: string;
  readonly provisioningClient?: BillingProvisioningClient;
};

export class BillingService {
  private readonly storage: BillingStorage;
  private readonly now: () => Date;
  private readonly webhookHandler: BillingWebhookHandler;
  private readonly provisioningClient: BillingProvisioningClient | undefined;

  constructor(deps: BillingServiceDependencies = {}) {
    if (!deps.storage) {
      throw new Error("BillingService requires a storage implementation");
    }
    this.storage = deps.storage;
    this.now = deps.now ?? (() => new Date());
    this.provisioningClient = deps.provisioningClient;
    this.webhookHandler = new BillingWebhookHandler({
      storage: deps.storage,
      secret: deps.webhookSecret,
      now: this.now,
    });
  }

  async getEntitlement(userId: string): Promise<UserEntitlement> {
    const cached = await this.storage.getEntitlement(userId);
    if (cached) {
      const stabilized = withProvisionalPeriod(cached, cached.cachedAt);
      if (
        this.storage.ensureEntitlementPeriod &&
        (!cached.polarSubscriptionId || !cached.currentPeriodStart || !cached.currentPeriodEnd)
      ) {
        return (await this.storage.ensureEntitlementPeriod(userId, {
          subscriptionId: stabilized.polarSubscriptionId!,
          startsAt: stabilized.currentPeriodStart!,
          endsAt: stabilized.currentPeriodEnd!,
        })) ?? stabilized;
      }
      return stabilized;
    }

    const now = this.now();
    const defaultEntitlement: UserEntitlement = {
      userId,
      planId: "free",
      status: "inactive",
      cancelAtPeriodEnd: false,
      provisioningState: "pending",
      provisioningAttempts: 0,
      cachedAt: now,
    };
    const initialized = withProvisionalPeriod(defaultEntitlement, now);
    if (this.storage.initializeEntitlement) {
      return this.storage.initializeEntitlement(initialized);
    }
    await this.storage.setEntitlement(initialized);
    return initialized;
  }

  async initializeAccount(userId: string): Promise<UserEntitlement> {
    return this.getEntitlement(userId);
  }

  async provisionAccount(user: {
    id: string;
    email: string;
    name?: string;
  }): Promise<UserEntitlement> {
    const entitlement = await this.getEntitlement(user.id);
    if (!this.provisioningClient) return entitlement;
    if (
      entitlement.provisioningState === "ready" &&
      entitlement.polarCustomerId &&
      entitlement.polarSubscriptionId &&
      !entitlement.polarSubscriptionId.startsWith("pending:")
    ) {
      return entitlement;
    }
    const startedAt = this.now();
    if (
      this.storage.claimAccountProvisioning &&
      !(await this.storage.claimAccountProvisioning(user.id, startedAt))
    ) {
      return (await this.storage.getEntitlement(user.id)) ?? entitlement;
    }
    const claimed = (await this.storage.getEntitlement(user.id)) ?? entitlement;
    const attempt = claimed.provisioningAttempts ?? 1;
    try {
      const subscription = await this.provisioningClient.provisionFreeSubscription(user);
      const planId = planIdFromProductId(subscription.productId) ?? "free";
      const ready: UserEntitlement = {
        ...claimed,
        planId,
        polarCustomerId: subscription.customerId,
        polarSubscriptionId: subscription.subscriptionId,
        polarProductId: subscription.productId,
        status: subscription.status,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        trialStartedAt: subscription.trialStartedAt,
        trialEndsAt: subscription.trialEndsAt,
        billingInterval: "monthly",
        provisioningState: "ready",
        provisioningAttempts: attempt,
        provisioningError: undefined,
        provisioningUpdatedAt: this.now(),
        reconciledAt: this.now(),
        cachedAt: this.now(),
      };
      const oldPeriod = `${claimed.polarSubscriptionId}:${claimed.currentPeriodStart?.toISOString()}`;
      const newPeriod = `${ready.polarSubscriptionId}:${ready.currentPeriodStart?.toISOString()}`;
      const periodMove = oldPeriod === newPeriod
        ? undefined
        : { metric: "deep_completes" as const, from: oldPeriod, to: newPeriod };
      const saved = this.storage.completeAccountProvisioning
        ? await this.storage.completeAccountProvisioning(ready, startedAt, periodMove)
        : (await this.storage.setEntitlement(ready), true);
      if (!saved) return (await this.storage.getEntitlement(user.id)) ?? claimed;
      if (periodMove && !this.storage.completeAccountProvisioning && this.storage.moveAllowanceUsagePeriod) {
        await this.storage.moveAllowanceUsagePeriod(
          user.id,
          periodMove.metric,
          periodMove.from,
          periodMove.to,
        );
      }
      return ready;
    } catch (error) {
      const retrying: UserEntitlement = {
        ...claimed,
        provisioningState: attempt >= 8 ? "failed" : "retrying",
        provisioningAttempts: attempt,
        provisioningError: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
        provisioningUpdatedAt: this.now(),
        cachedAt: this.now(),
      };
      const saved = this.storage.completeAccountProvisioning
        ? await this.storage.completeAccountProvisioning(retrying, startedAt)
        : (await this.storage.setEntitlement(retrying), true);
      return saved
        ? retrying
        : (await this.storage.getEntitlement(user.id)) ?? claimed;
    }
  }

  async reconcileEntitlement(userId: string): Promise<UserEntitlement> {
    const entitlement = await this.getEntitlement(userId);
    if (
      !this.provisioningClient ||
      !entitlement.polarSubscriptionId ||
      entitlement.polarSubscriptionId.startsWith("pending:")
    ) return entitlement;
    try {
      const subscription = await this.provisioningClient.getSubscription(
        entitlement.polarSubscriptionId,
      );
      if (subscription.status === "canceled" || subscription.status === "inactive") {
        return this.transitionToPendingFree(entitlement);
      }
      const reconciled: UserEntitlement = {
        ...entitlement,
        planId: planIdFromProductId(subscription.productId) ?? entitlement.planId,
        polarCustomerId: subscription.customerId,
        polarProductId: subscription.productId,
        status: subscription.status,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        trialStartedAt: subscription.trialStartedAt,
        trialEndsAt: subscription.trialEndsAt,
        provisioningState: "ready",
        reconciledAt: this.now(),
        cachedAt: this.now(),
      };
      const saved = this.storage.setReconciledEntitlement
        ? await this.storage.setReconciledEntitlement(
            reconciled,
            entitlement.polarSubscriptionId,
            entitlement.cachedAt,
          )
        : (await this.storage.setEntitlement(reconciled), true);
      return saved
        ? reconciled
        : (await this.storage.getEntitlement(userId)) ?? entitlement;
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 404) {
        return this.transitionToPendingFree(entitlement);
      }
      return entitlement;
    }
  }

  private async transitionToPendingFree(
    entitlement: UserEntitlement,
  ): Promise<UserEntitlement> {
    const now = this.now();
    const pending = withProvisionalPeriod({
      ...entitlement,
      planId: "free",
      polarSubscriptionId: undefined,
      polarProductId: undefined,
      status: "inactive",
      cancelAtPeriodEnd: false,
      provisioningState: "retrying",
      provisioningError: undefined,
      provisioningUpdatedAt: now,
      reconciledAt: now,
      currentPeriodStart: now,
      currentPeriodEnd: nextCalendarMonth(now),
      cachedAt: now,
    }, now);
    const saved = this.storage.setReconciledEntitlement && entitlement.polarSubscriptionId
      ? await this.storage.setReconciledEntitlement(
          pending,
          entitlement.polarSubscriptionId,
          entitlement.cachedAt,
        )
      : (await this.storage.setEntitlement(pending), true);
    return saved
      ? pending
      : (await this.storage.getEntitlement(entitlement.userId)) ?? entitlement;
  }

  async backfillAccounts(limit = 25): Promise<number> {
    if (!this.storage.listAccountsNeedingProvisioning) return 0;
    const accounts = await this.storage.listAccountsNeedingProvisioning(limit);
    for (const account of accounts) await this.provisionAccount(account);
    return accounts.length;
  }

  async reconcileAccounts(limit = 25): Promise<number> {
    if (!this.storage.listAccountsNeedingReconciliation) return 0;
    const userIds = await this.storage.listAccountsNeedingReconciliation(
      this.now(),
      limit,
    );
    for (const userId of userIds) await this.reconcileEntitlement(userId);
    return userIds.length;
  }

  async resolveEntitlement(userId: string): Promise<ResolvedEntitlement> {
    const stored = await this.getEntitlement(userId);
    const now = this.now();
    if (stored.polarCustomerId && stored.polarSubscriptionId) {
      const projected = projectEntitlement(entitlementFacts(stored), now);
      if (projected.source === "free") {
        return { stored, planId: "free", source: "free" };
      }
      return {
        stored,
        planId: projected.planId,
        source: projected.source,
      };
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
    const periods = getAllowancePeriods({
      now,
      localDay: options.localDay,
      localResetAt: options.localResetAt,
      deepCompletePeriod: {
        period: `${entitlement.stored.polarSubscriptionId}:${entitlement.stored.currentPeriodStart?.toISOString()}`,
        periodStartsAt: entitlement.stored.currentPeriodStart!.toISOString(),
        periodEndsAt: entitlement.stored.currentPeriodEnd!.toISOString(),
      },
    });
    const [localUsage, deepUsage] = await Promise.all([
      this.storage.getAllowanceUsage(
        userId,
        "local_accepted_words",
        periods.localAcceptedWords.period,
      ),
      this.storage.getAllowanceUsage(
        userId,
        "deep_completes",
        periods.deepCompletes.period,
      ),
    ]);

    return projectBillingStatus({
      entitlement: entitlementFacts(entitlement.stored),
      now,
      localDay: periods.localAcceptedWords.period,
      localResetAt: new Date(periods.localAcceptedWords.periodEndsAt),
      localAcceptedWords: {
        period: periods.localAcceptedWords.period,
        used: localUsage,
      },
      deepCompletes: { period: periods.deepCompletes.period, used: deepUsage },
      activeDevices: options.activeDevices ?? 0,
    });
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
      resetAt: new Date(status.deepCompletes.periodEndsAt),
      recorded: false,
    };
  }

  async consumeDeepComplete(
    userId: string,
    requestId: string,
    periodRetry = false,
  ): Promise<DeepCompleteCheckResult> {
    const check = await this.checkDeepComplete(userId);
    const period = check.status.deepCompletes.period!;
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

    const reservation = this.storage.acquireDeepCompleteWithinCurrentPeriod
      ? await this.storage.acquireDeepCompleteWithinCurrentPeriod(
          userId,
          period,
          requestId,
          check.quota,
        )
      : await this.storage.acquireAllowanceWithinLimit(
          userId,
          "deep_completes",
          period,
          requestId,
          1,
          check.quota,
        );
    if (reservation === null) {
      const status = await this.getStatus(userId);
      if (!periodRetry && status.deepCompletes.period !== period) {
        return this.consumeDeepComplete(userId, requestId, true);
      }
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
    acceptedAt?: Date;
    words: number;
  }): Promise<BillingStatusData> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.localDay)) {
      throw new Error("Local Accepted Word day must use YYYY-MM-DD");
    }
    if (!Number.isInteger(input.words) || input.words < 0) {
      throw new Error("Accepted Word count must be a nonnegative integer");
    }
    if (input.words > 0) {
      await this.storage.recordLocalAcceptedWordsWithUsage({
        userId: input.userId,
        acceptanceId: input.acceptanceId,
        localDay: input.localDay,
        acceptedAt: input.acceptedAt ?? this.now(),
        words: input.words,
      });
    }
    return this.getStatus(input.userId, { localDay: input.localDay });
  }

  async applyEntitlement(entitlement: UserEntitlement): Promise<void> {
    await this.storage.setEntitlement(withProvisionalPeriod(entitlement, this.now()));
  }

  async finalizeDeepComplete(
    userId: string,
    requestId: string,
    timestamp = this.now(),
  ): Promise<void> {
    await this.storage.enqueueDeepCompleteUsage({ userId, requestId, timestamp });
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

}

export type UsageMeterServiceDependencies = {
  readonly client?: UsageMeterClient;
};

export class UsageMeterService {
  private readonly client: UsageMeterClient;

  constructor(deps: UsageMeterServiceDependencies = {}) {
    if (!deps.client) {
      throw new Error("UsageMeterService requires a client implementation");
    }
    this.client = deps.client;
  }

  async drainOutbox(
    storage: BillingStorage,
    options: { now?: Date; limit?: number } = {},
  ): Promise<{ delivered: number; retried: number; failed: number }> {
    const now = options.now ?? new Date();
    const leaseOwner = crypto.randomUUID();
    const events = await storage.claimPolarUsageOutbox({
      now,
      leaseOwner,
      leaseDurationMs: 5 * 60 * 1000,
      limit: options.limit ?? 25,
    });
    const result = { delivered: 0, retried: 0, failed: 0 };
    for (const event of events) {
      const id = `${event.userId}:${event.eventName}:${event.eventId}`;
      try {
        await this.client.ingest(event);
        await storage.completePolarUsageOutbox(id, leaseOwner, new Date());
        result.delivered += 1;
      } catch (error) {
        const attempt = event.attemptCount + 1;
        const failed = attempt >= 8;
        const delayMs = Math.min(60 * 60 * 1000, 1_000 * 2 ** attempt);
        await storage.retryPolarUsageOutbox({
          id,
          leaseOwner,
          nextAttemptAt: new Date(now.getTime() + delayMs),
          failed,
          error: error instanceof Error ? error.message : String(error),
        });
        if (failed) result.failed += 1;
        else result.retried += 1;
      }
    }
    return result;
  }
}

export class InMemoryBillingStorage implements BillingStorage {
  private entitlements = new Map<string, UserEntitlement>();
  private events = new Map<
    string,
    { period: string; amount: number; createdAt: string }
  >();
  private consumptionTail: Promise<void> = Promise.resolve();
  private outbox = new Map<string, PolarUsageOutboxEvent & {
    status: "pending" | "processing" | "delivered" | "failed";
    nextAttemptAt: Date;
    leaseOwner?: string;
  }>();
  private provisioning = new Set<string>();

  async getEntitlement(userId: string): Promise<UserEntitlement | null> {
    return this.entitlements.get(userId) ?? null;
  }

  async setEntitlement(entitlement: UserEntitlement): Promise<void> {
    this.entitlements.set(entitlement.userId, entitlement);
    if (entitlement.provisioningState !== "provisioning") {
      this.provisioning.delete(entitlement.userId);
    }
  }

  async initializeEntitlement(entitlement: UserEntitlement): Promise<UserEntitlement> {
    if (!this.entitlements.has(entitlement.userId)) {
      this.entitlements.set(entitlement.userId, entitlement);
    }
    return this.entitlements.get(entitlement.userId)!;
  }

  async applyWebhookEntitlement(entitlement: UserEntitlement): Promise<boolean> {
    const current = this.entitlements.get(entitlement.userId);
    if (current?.lastWebhookOccurredAt && entitlement.lastWebhookOccurredAt) {
      const time = entitlement.lastWebhookOccurredAt.getTime();
      const currentTime = current.lastWebhookOccurredAt.getTime();
      if (time < currentTime) return false;
      if (
        time === currentTime &&
        entitlement.lastWebhookEventId &&
        current.lastWebhookEventId &&
        entitlement.lastWebhookEventId <= current.lastWebhookEventId
      ) return false;
    }
    await this.setEntitlement(entitlement);
    return true;
  }

  async acquireDeepCompleteWithinCurrentPeriod(
    userId: string,
    period: string,
    eventId: string,
    limit: number,
  ): Promise<{ usage: number; acquired: boolean } | null> {
    const entitlement = this.entitlements.get(userId);
    const currentPeriod = entitlement?.polarSubscriptionId && entitlement.currentPeriodStart
      ? `${entitlement.polarSubscriptionId}:${entitlement.currentPeriodStart.toISOString()}`
      : undefined;
    if (currentPeriod !== period) return null;
    return this.acquireAllowanceWithinLimit(
      userId,
      "deep_completes",
      period,
      eventId,
      1,
      limit,
    );
  }

  async claimAccountProvisioning(userId: string): Promise<boolean> {
    if (this.provisioning.has(userId)) return false;
    this.provisioning.add(userId);
    const entitlement = this.entitlements.get(userId);
    if (entitlement) {
      this.entitlements.set(userId, {
        ...entitlement,
        provisioningState: "provisioning",
        provisioningAttempts: (entitlement.provisioningAttempts ?? 0) + 1,
        provisioningUpdatedAt: new Date(),
        cachedAt: new Date(),
      });
    }
    return true;
  }

  async completeAccountProvisioning(
    entitlement: UserEntitlement,
    _claimedAt: Date,
    periodMove?: { metric: AllowanceMetric; from: string; to: string },
  ): Promise<boolean> {
    const current = this.entitlements.get(entitlement.userId);
    if (current?.provisioningState !== "provisioning") return false;
    if (periodMove) {
      await this.moveAllowanceUsagePeriod(
        entitlement.userId,
        periodMove.metric,
        periodMove.from,
        periodMove.to,
      );
    }
    await this.setEntitlement(entitlement);
    return true;
  }

  async setReconciledEntitlement(
    entitlement: UserEntitlement,
    expectedSubscriptionId: string,
    expectedCachedAt: Date,
  ): Promise<boolean> {
    const current = this.entitlements.get(entitlement.userId);
    if (
      current?.polarSubscriptionId !== expectedSubscriptionId ||
      current.cachedAt.getTime() !== expectedCachedAt.getTime()
    ) return false;
    await this.setEntitlement(entitlement);
    return true;
  }

  async moveAllowanceUsagePeriod(
    userId: string,
    metric: AllowanceMetric,
    fromPeriod: string,
    toPeriod: string,
  ): Promise<void> {
    for (const [key, event] of this.events) {
      if (key.startsWith(`${userId}:${metric}:`) && event.period === fromPeriod) {
        this.events.set(key, { ...event, period: toPeriod });
      }
    }
  }

  async ensureEntitlementPeriod(
    userId: string,
    period: { subscriptionId: string; startsAt: Date; endsAt: Date },
  ): Promise<UserEntitlement | null> {
    const current = this.entitlements.get(userId);
    if (!current) return null;
    const stabilized = {
      ...current,
      polarSubscriptionId: current.polarSubscriptionId ?? period.subscriptionId,
      currentPeriodStart: current.currentPeriodStart ?? period.startsAt,
      currentPeriodEnd: current.currentPeriodEnd ?? period.endsAt,
    };
    this.entitlements.set(userId, stabilized);
    return stabilized;
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

  async recordLocalAcceptedWordsWithUsage(input: {
    userId: string;
    acceptanceId: string;
    localDay: string;
    acceptedAt: Date;
    words: number;
  }): Promise<boolean> {
    const recorded = await this.recordAllowanceUsage(
      input.userId,
      "local_accepted_words",
      input.localDay,
      input.acceptanceId,
      input.words,
    );
    if (recorded) {
      this.addOutbox({
        userId: input.userId,
        eventId: input.acceptanceId,
        eventName: "local_accepted_words.used",
        timestamp: input.acceptedAt,
        metadata: { words: input.words, localDay: input.localDay },
      });
    }
    return recorded;
  }

  async enqueueDeepCompleteUsage(input: {
    userId: string;
    requestId: string;
    timestamp: Date;
  }): Promise<boolean> {
    const allowance = await this.getAllowanceEvent(
      input.userId,
      "deep_completes",
      input.requestId,
    );
    if (!allowance) return false;
    return this.addOutbox({
      userId: input.userId,
      eventId: input.requestId,
      eventName: "deep_complete.used",
      timestamp: input.timestamp,
      metadata: { creditsSpent: 1, requestId: input.requestId },
    });
  }

  private addOutbox(event: PolarUsageEvent): boolean {
    const id = `${event.userId}:${event.eventName}:${event.eventId}`;
    if (this.outbox.has(id)) return false;
    this.outbox.set(id, {
      ...event,
      attemptCount: 0,
      status: "pending",
      nextAttemptAt: event.timestamp,
    });
    return true;
  }

  async claimPolarUsageOutbox(input: {
    now: Date;
    leaseOwner: string;
    leaseDurationMs: number;
    limit: number;
  }): Promise<PolarUsageOutboxEvent[]> {
    const claimed: PolarUsageOutboxEvent[] = [];
    for (const event of this.outbox.values()) {
      if (claimed.length >= input.limit) break;
      if (
        (event.status === "pending" || event.status === "processing") &&
        event.nextAttemptAt <= input.now
      ) {
        event.status = "processing";
        event.leaseOwner = input.leaseOwner;
        event.nextAttemptAt = new Date(input.now.getTime() + input.leaseDurationMs);
        claimed.push(event);
      }
    }
    return claimed;
  }

  async completePolarUsageOutbox(id: string, leaseOwner: string): Promise<void> {
    const event = this.outbox.get(id);
    if (event?.leaseOwner === leaseOwner) event.status = "delivered";
  }

  async retryPolarUsageOutbox(input: {
    id: string;
    leaseOwner: string;
    nextAttemptAt: Date;
    failed: boolean;
    error: string;
  }): Promise<void> {
    const event = this.outbox.get(input.id);
    if (!event || event.leaseOwner !== input.leaseOwner) return;
    event.status = input.failed ? "failed" : "pending";
    this.outbox.set(input.id, {
      ...event,
      attemptCount: event.attemptCount + 1,
      nextAttemptAt: input.nextAttemptAt,
      leaseOwner: undefined,
    });
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
  return {
    userId: row.userId,
    planId: isPlanId(row.planId) ? row.planId : "free",
    polarCustomerId: row.polarCustomerId ?? undefined,
    polarSubscriptionId: row.polarSubscriptionId ?? undefined,
    polarProductId: row.polarProductId ?? undefined,
    status: normalizeStatus(row.status),
    currentPeriodStart: row.currentPeriodStart
      ? new Date(row.currentPeriodStart)
      : undefined,
    currentPeriodEnd: row.currentPeriodEnd
      ? new Date(row.currentPeriodEnd)
      : undefined,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    billingInterval:
      row.billingInterval === "monthly" ? row.billingInterval : undefined,
    trialStartedAt: row.trialStartedAt
      ? new Date(row.trialStartedAt)
      : undefined,
    trialEndsAt: row.trialEndsAt ? new Date(row.trialEndsAt) : undefined,
    lastWebhookEventId: row.lastWebhookEventId ?? undefined,
    lastWebhookOccurredAt: row.lastWebhookOccurredAt
      ? new Date(row.lastWebhookOccurredAt)
      : undefined,
    provisioningState:
      row.provisioningState === "provisioning" ||
      row.provisioningState === "ready" ||
      row.provisioningState === "retrying" ||
      row.provisioningState === "failed"
        ? row.provisioningState
        : "pending",
    provisioningAttempts: row.provisioningAttempts,
    provisioningError: row.provisioningError ?? undefined,
    provisioningUpdatedAt: row.provisioningUpdatedAt
      ? new Date(row.provisioningUpdatedAt)
      : undefined,
    reconciledAt: row.reconciledAt ? new Date(row.reconciledAt) : undefined,
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
    return entitlementRowToEntitlement(row);
  }

  async initializeEntitlement(entitlement: UserEntitlement): Promise<UserEntitlement> {
    await this.db.insert(userEntitlements)
      .values({ userId: entitlement.userId, ...this.entitlementValues(entitlement) })
      .onConflictDoNothing();
    return (await this.getEntitlement(entitlement.userId)) ?? entitlement;
  }

  async applyWebhookEntitlement(entitlement: UserEntitlement): Promise<boolean> {
    const values = this.entitlementValues(entitlement);
    const occurredAt = entitlement.lastWebhookOccurredAt?.toISOString() ?? "";
    const eventId = entitlement.lastWebhookEventId ?? "";
    const update = () => this.db.update(userEntitlements)
      .set(values)
      .where(and(
        eq(userEntitlements.userId, entitlement.userId),
        sql`(
          ${userEntitlements.lastWebhookOccurredAt} IS NULL OR
          ${userEntitlements.lastWebhookOccurredAt} < ${occurredAt} OR
          (
            ${userEntitlements.lastWebhookOccurredAt} = ${occurredAt} AND
            coalesce(${userEntitlements.lastWebhookEventId}, '') < ${eventId}
          )
        )`,
      ))
      .returning({ userId: userEntitlements.userId });
    if ((await update()).length > 0) return true;
    const inserted = await this.db.insert(userEntitlements)
      .values({ userId: entitlement.userId, ...values })
      .onConflictDoNothing()
      .returning({ userId: userEntitlements.userId });
    if (inserted.length > 0) return true;
    return (await update()).length > 0;
  }

  async listAccountsNeedingProvisioning(limit: number): Promise<Array<{
    id: string;
    email: string;
    name?: string;
  }>> {
    const rows = await this.db.all<{ id: string; email: string; name: string }>(sql`
      SELECT u.id, u.email, u.name
      FROM user u
      LEFT JOIN user_entitlements e ON e.user_id = u.id
      WHERE u.email_verified = 1
        AND (
          e.user_id IS NULL OR
          e.provisioning_state IN ('pending', 'retrying') OR
          (e.provisioning_state = 'provisioning' AND e.provisioning_updated_at <= ${new Date(Date.now() - 10 * 60 * 1000).toISOString()}) OR
          (e.provisioning_state = 'failed' AND e.provisioning_attempts < 8)
        )
      ORDER BY u.created_at
      LIMIT ${limit}
    `);
    return rows.map((row) => ({ id: row.id, email: row.email, name: row.name }));
  }

  async claimAccountProvisioning(userId: string, now: Date): Promise<boolean> {
    const staleAt = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
    const claimed = await this.db.get<{ userId: string }>(sql`
      UPDATE user_entitlements
      SET provisioning_state = 'provisioning',
          provisioning_attempts = provisioning_attempts + 1,
          provisioning_updated_at = ${now.toISOString()},
          cached_at = ${now.toISOString()}
      WHERE user_id = ${userId}
        AND provisioning_state != 'ready'
        AND (
          provisioning_state != 'provisioning' OR
          provisioning_updated_at IS NULL OR
          provisioning_updated_at <= ${staleAt}
        )
      RETURNING user_id AS userId
    `);
    return Boolean(claimed);
  }

  async completeAccountProvisioning(
    entitlement: UserEntitlement,
    claimedAt: Date,
    periodMove?: { metric: AllowanceMetric; from: string; to: string },
  ): Promise<boolean> {
    const entitlementUpdate = this.db.update(userEntitlements)
      .set(this.entitlementValues(entitlement))
      .where(and(
        eq(userEntitlements.userId, entitlement.userId),
        eq(userEntitlements.provisioningState, "provisioning"),
        eq(userEntitlements.provisioningUpdatedAt, claimedAt.toISOString()),
      ))
      .returning({ userId: userEntitlements.userId });
    if (periodMove) {
      const [, rows] = await this.db.batch([
        this.db.update(allowanceUsageEvents)
          .set({ period: periodMove.to })
          .where(and(
            eq(allowanceUsageEvents.userId, entitlement.userId),
            eq(allowanceUsageEvents.metric, periodMove.metric),
            eq(allowanceUsageEvents.period, periodMove.from),
            sql`EXISTS (
              SELECT 1 FROM user_entitlements
              WHERE user_id = ${entitlement.userId}
                AND provisioning_state = 'provisioning'
                AND provisioning_updated_at = ${claimedAt.toISOString()}
            )`,
          )),
        entitlementUpdate,
      ]);
      return rows.length > 0;
    }
    const rows = await entitlementUpdate;
    return rows.length > 0;
  }

  async setReconciledEntitlement(
    entitlement: UserEntitlement,
    expectedSubscriptionId: string,
    expectedCachedAt: Date,
  ): Promise<boolean> {
    const rows = await this.db.update(userEntitlements)
      .set(this.entitlementValues(entitlement))
      .where(and(
        eq(userEntitlements.userId, entitlement.userId),
        eq(userEntitlements.polarSubscriptionId, expectedSubscriptionId),
        eq(userEntitlements.cachedAt, expectedCachedAt.toISOString()),
      ))
      .returning({ userId: userEntitlements.userId });
    return rows.length > 0;
  }

  async moveAllowanceUsagePeriod(
    userId: string,
    metric: AllowanceMetric,
    fromPeriod: string,
    toPeriod: string,
  ): Promise<void> {
    await this.db.update(allowanceUsageEvents)
      .set({ period: toPeriod })
      .where(and(
        eq(allowanceUsageEvents.userId, userId),
        eq(allowanceUsageEvents.metric, metric),
        eq(allowanceUsageEvents.period, fromPeriod),
      ));
  }

  async ensureEntitlementPeriod(
    userId: string,
    period: { subscriptionId: string; startsAt: Date; endsAt: Date },
  ): Promise<UserEntitlement | null> {
    await this.db.run(sql`
      UPDATE user_entitlements
      SET polar_subscription_id = coalesce(polar_subscription_id, ${period.subscriptionId}),
          current_period_start = coalesce(current_period_start, ${period.startsAt.toISOString()}),
          current_period_end = coalesce(current_period_end, ${period.endsAt.toISOString()})
      WHERE user_id = ${userId}
    `);
    return this.getEntitlement(userId);
  }

  async listAccountsNeedingReconciliation(now: Date, limit: number): Promise<string[]> {
    const staleAt = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
    const rows = await this.db.all<{ userId: string }>(sql`
      SELECT user_id AS userId
      FROM user_entitlements
      WHERE provisioning_state = 'ready'
        AND polar_subscription_id IS NOT NULL
        AND polar_subscription_id NOT LIKE 'pending:%'
        AND (
          current_period_end <= ${now.toISOString()} OR
          reconciled_at IS NULL OR
          reconciled_at <= ${staleAt}
        )
      ORDER BY coalesce(reconciled_at, cached_at)
      LIMIT ${limit}
    `);
    return rows.map((row) => row.userId);
  }

  async setEntitlement(entitlement: UserEntitlement): Promise<void> {
    const values = this.entitlementValues(entitlement);
    await this.db
      .insert(userEntitlements)
      .values({ userId: entitlement.userId, ...values })
      .onConflictDoUpdate({ target: userEntitlements.userId, set: values });
  }

  private entitlementValues(entitlement: UserEntitlement) {
    return {
      planId: entitlement.planId,
      polarCustomerId: entitlement.polarCustomerId ?? null,
      polarSubscriptionId: entitlement.polarSubscriptionId ?? null,
      polarProductId: entitlement.polarProductId ?? null,
      status: entitlement.status,
      currentPeriodStart: entitlement.currentPeriodStart?.toISOString() ?? null,
      currentPeriodEnd: entitlement.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: entitlement.cancelAtPeriodEnd ?? false,
      billingInterval: entitlement.billingInterval ?? null,
      trialStartedAt: entitlement.trialStartedAt?.toISOString() ?? null,
      trialEndsAt: entitlement.trialEndsAt?.toISOString() ?? null,
      lastWebhookEventId: entitlement.lastWebhookEventId ?? null,
      lastWebhookOccurredAt:
        entitlement.lastWebhookOccurredAt?.toISOString() ?? null,
      provisioningState: entitlement.provisioningState ?? "pending",
      provisioningAttempts: entitlement.provisioningAttempts ?? 0,
      provisioningError: entitlement.provisioningError ?? null,
      provisioningUpdatedAt:
        entitlement.provisioningUpdatedAt?.toISOString() ?? null,
      reconciledAt: entitlement.reconciledAt?.toISOString() ?? null,
      cachedAt: entitlement.cachedAt.toISOString(),
    };
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

  async recordLocalAcceptedWordsWithUsage(input: {
    userId: string;
    acceptanceId: string;
    localDay: string;
    acceptedAt: Date;
    words: number;
  }): Promise<boolean> {
    const existing = await this.getAllowanceEvent(
      input.userId,
      "local_accepted_words",
      input.acceptanceId,
    );
    if (existing) return false;
    const now = new Date().toISOString();
    await this.db.batch([
      this.db.insert(allowanceUsageEvents).values({
        userId: input.userId,
        metric: "local_accepted_words",
        period: input.localDay,
        eventId: input.acceptanceId,
        amount: input.words,
        createdAt: now,
      }).onConflictDoNothing(),
      this.db.insert(polarUsageOutbox).values({
        id: `${input.userId}:local_accepted_words.used:${input.acceptanceId}`,
        userId: input.userId,
        eventName: "local_accepted_words.used",
        eventTimestamp: input.acceptedAt.toISOString(),
        metadata: JSON.stringify({ words: input.words, localDay: input.localDay }),
        status: "pending",
        nextAttemptAt: now,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing(),
    ]);
    return true;
  }

  async enqueueDeepCompleteUsage(input: {
    userId: string;
    requestId: string;
    timestamp: Date;
  }): Promise<boolean> {
    const now = new Date().toISOString();
    const inserted = await this.db.get<{ id: string }>(sql`
      INSERT INTO polar_usage_outbox (
        id, user_id, event_name, event_timestamp, metadata, status,
        attempt_count, next_attempt_at, created_at, updated_at
      )
      SELECT
        ${`${input.userId}:deep_complete.used:${input.requestId}`}, ${input.userId},
        'deep_complete.used', ${input.timestamp.toISOString()},
        ${JSON.stringify({ creditsSpent: 1, requestId: input.requestId })},
        'pending', 0, ${now}, ${now}, ${now}
      WHERE EXISTS (
        SELECT 1 FROM allowance_usage_events
        WHERE user_id = ${input.userId}
          AND metric = 'deep_completes'
          AND event_id = ${input.requestId}
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    `);
    return Boolean(inserted);
  }

  async claimPolarUsageOutbox(input: {
    now: Date;
    leaseOwner: string;
    leaseDurationMs: number;
    limit: number;
  }): Promise<PolarUsageOutboxEvent[]> {
    const now = input.now.toISOString();
    const leaseExpiresAt = new Date(
      input.now.getTime() + input.leaseDurationMs,
    ).toISOString();
    const candidates = await this.db.all<{ id: string }>(sql`
      SELECT id FROM polar_usage_outbox
      WHERE (
        (status = 'pending' AND next_attempt_at <= ${now}) OR
        (status = 'processing' AND lease_expires_at <= ${now})
      )
      ORDER BY next_attempt_at, created_at
      LIMIT ${input.limit}
    `);
    if (candidates.length === 0) return [];
    for (const { id } of candidates) {
      await this.db.run(sql`
        UPDATE polar_usage_outbox
        SET status = 'processing', lease_owner = ${input.leaseOwner},
            lease_expires_at = ${leaseExpiresAt}, updated_at = ${now}
        WHERE id = ${id}
          AND (
            (status = 'pending' AND next_attempt_at <= ${now}) OR
            (status = 'processing' AND lease_expires_at <= ${now})
          )
      `);
    }
    const rows = await this.db.all<{
      id: string;
      userId: string;
      eventName: string;
      eventTimestamp: string;
      metadata: string;
      attemptCount: number;
    }>(sql`
      SELECT
        id, user_id AS userId, event_name AS eventName,
        event_timestamp AS eventTimestamp, metadata,
        attempt_count AS attemptCount
      FROM polar_usage_outbox
      WHERE lease_owner = ${input.leaseOwner} AND status = 'processing'
    `);
    return rows.map((row) => ({
      userId: row.userId,
      eventId: row.id.slice(`${row.userId}:${row.eventName}:`.length),
      eventName: row.eventName as PolarUsageEvent["eventName"],
      timestamp: new Date(row.eventTimestamp),
      metadata: JSON.parse(row.metadata) as Record<string, string | number | boolean>,
      attemptCount: row.attemptCount,
    }));
  }

  async completePolarUsageOutbox(
    id: string,
    leaseOwner: string,
    deliveredAt: Date,
  ): Promise<void> {
    await this.db.update(polarUsageOutbox).set({
      status: "delivered",
      deliveredAt: deliveredAt.toISOString(),
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: null,
      updatedAt: deliveredAt.toISOString(),
    }).where(and(
      eq(polarUsageOutbox.id, id),
      eq(polarUsageOutbox.leaseOwner, leaseOwner),
    ));
  }

  async retryPolarUsageOutbox(input: {
    id: string;
    leaseOwner: string;
    nextAttemptAt: Date;
    failed: boolean;
    error: string;
  }): Promise<void> {
    await this.db.update(polarUsageOutbox).set({
      status: input.failed ? "failed" : "pending",
      attemptCount: sql`${polarUsageOutbox.attemptCount} + 1`,
      nextAttemptAt: input.nextAttemptAt.toISOString(),
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: input.error.slice(0, 500),
      updatedAt: new Date().toISOString(),
    }).where(and(
      eq(polarUsageOutbox.id, input.id),
      eq(polarUsageOutbox.leaseOwner, input.leaseOwner),
    ));
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

  async acquireDeepCompleteWithinCurrentPeriod(
    userId: string,
    period: string,
    eventId: string,
    limit: number,
  ): Promise<{ usage: number; acquired: boolean } | null> {
    const existing = await this.getAllowanceEvent(userId, "deep_completes", eventId);
    if (existing) {
      return {
        usage: await this.getAllowanceUsage(userId, "deep_completes", existing.period),
        acquired: false,
      };
    }
    const inserted = await this.db.get<{ eventId: string }>(sql`
      INSERT INTO allowance_usage_events (
        user_id, metric, event_id, period, amount, created_at
      )
      SELECT ${userId}, 'deep_completes', ${eventId}, ${period}, 1, ${new Date().toISOString()}
      WHERE EXISTS (
        SELECT 1 FROM user_entitlements
        WHERE user_id = ${userId}
          AND polar_subscription_id || ':' || current_period_start = ${period}
      )
      AND (
        SELECT coalesce(sum(amount), 0)
        FROM allowance_usage_events
        WHERE user_id = ${userId}
          AND metric = 'deep_completes'
          AND period = ${period}
      ) + 1 <= ${limit}
      ON CONFLICT DO NOTHING
      RETURNING event_id AS eventId
    `);
    if (!inserted) {
      const duplicate = await this.getAllowanceEvent(userId, "deep_completes", eventId);
      return duplicate
        ? {
            usage: await this.getAllowanceUsage(
              userId,
              "deep_completes",
              duplicate.period,
            ),
            acquired: false,
          }
        : null;
    }
    return {
      usage: await this.getAllowanceUsage(userId, "deep_completes", period),
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
    case "trialing":
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
  if (productId === env.POLAR_PRODUCT_ID_FREE_MONTHLY) return "free";
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
    productId === env.POLAR_PRODUCT_ID_MAX_MONTHLY ||
    productId === env.POLAR_PRODUCT_ID_FREE_MONTHLY
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

    const existing =
      (await this.storage.getEntitlement(userId)) ??
      withProvisionalPeriod(
        {
          userId,
          planId: "free",
          status: "inactive",
          cancelAtPeriodEnd: false,
          provisioningState: "pending",
          provisioningAttempts: 0,
          cachedAt: this.now(),
        },
        this.now(),
      );
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
    if (
      existing.lastWebhookOccurredAt &&
      occurredAt.getTime() === existing.lastWebhookOccurredAt.getTime() &&
      webhookEventId &&
      existing.lastWebhookEventId &&
      webhookEventId <= existing.lastWebhookEventId
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
        if (
          existing.polarSubscriptionId &&
          !existing.polarSubscriptionId.startsWith("pending:") &&
          subscriptionId !== existing.polarSubscriptionId
        ) {
          return;
        }

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
        const planId = planIdFromProductId(productId) ??
          planIdFromMetadata(productMetadata) ??
          (productName ? planIdFromProductName(productName) : null) ??
          planIdFromMetadata(metadata);
        if (!planId) return;
        const billingInterval =
          intervalFromProductId(productId) ??
          intervalFromMetadata(productMetadata) ??
          intervalFromMetadata(metadata) ??
          existing.billingInterval;

        const nextEntitlement: UserEntitlement = {
          ...existing,
          planId: payload.type === "subscription.revoked" ? "free" : planId,
          polarCustomerId: customerId,
          polarSubscriptionId:
            payload.type === "subscription.revoked" ? undefined : subscriptionId,
          polarProductId:
            payload.type === "subscription.revoked" ? undefined : productId,
          status,
          currentPeriodStart:
            optionalDate(data.current_period_start ?? data.currentPeriodStart) ??
            existing.currentPeriodStart,
          currentPeriodEnd:
            optionalDate(data.current_period_end ?? data.currentPeriodEnd) ??
            existing.currentPeriodEnd,
          trialStartedAt:
            optionalDate(data.trial_start ?? data.trialStart) ??
            existing.trialStartedAt,
          trialEndsAt:
            optionalDate(data.trial_end ?? data.trialEnd) ??
            existing.trialEndsAt,
          billingInterval,
          cancelAtPeriodEnd:
            Boolean(data.cancel_at_period_end ?? data.cancelAtPeriodEnd),
          provisioningState:
            payload.type === "subscription.revoked" ? "retrying" : "ready",
          provisioningError: undefined,
          provisioningUpdatedAt: this.now(),
          reconciledAt: this.now(),
          lastWebhookEventId: webhookEventId,
          lastWebhookOccurredAt: occurredAt,
          cachedAt: this.now(),
        };
        if (this.storage.applyWebhookEntitlement) {
          await this.storage.applyWebhookEntitlement(nextEntitlement);
        } else {
          await this.storage.setEntitlement(nextEntitlement);
        }
        break;
      }

      case "subscription.canceled":
      case "subscription.uncanceled": {
        const subscriptionId = optionalString(data.id);
        if (!subscriptionId) return;
        if (
          existing.polarSubscriptionId &&
          !existing.polarSubscriptionId.startsWith("pending:") &&
          subscriptionId !== existing.polarSubscriptionId
        ) {
          return;
        }
        const nextEntitlement: UserEntitlement = {
          ...existing,
          status: normalizeStatus(optionalString(data.status)) === "inactive"
            ? existing.status
            : normalizeStatus(optionalString(data.status)),
          cancelAtPeriodEnd: payload.type === "subscription.canceled",
          currentPeriodStart:
            optionalDate(data.current_period_start ?? data.currentPeriodStart) ??
            existing.currentPeriodStart,
          currentPeriodEnd:
            optionalDate(data.current_period_end ?? data.currentPeriodEnd) ??
            existing.currentPeriodEnd,
          lastWebhookEventId: webhookEventId,
          lastWebhookOccurredAt: occurredAt,
          cachedAt: this.now(),
        };
        if (this.storage.applyWebhookEntitlement) {
          await this.storage.applyWebhookEntitlement(nextEntitlement);
        } else {
          await this.storage.setEntitlement(nextEntitlement);
        }
        break;
      }

      default:
        break;
    }
  }
}
