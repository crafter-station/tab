export const PLAN_IDS = ["free", "pro", "max"] as const;

export const planCapabilities = {
  free: {
    name: "Free",
    monthlyPriceUsd: 0,
    localAcceptedWordsPerDay: 100,
    deepCompletesPerMonth: 10,
    personalDeviceLimit: 1,
    continuousMemoryExtraction: false,
    customWritingInstructions: false,
    modelCatalogAccess: false,
  },
  pro: {
    name: "Pro",
    monthlyPriceUsd: 10,
    localAcceptedWordsPerDay: null,
    deepCompletesPerMonth: 300,
    personalDeviceLimit: 3,
    continuousMemoryExtraction: true,
    customWritingInstructions: true,
    modelCatalogAccess: true,
  },
  max: {
    name: "Max",
    monthlyPriceUsd: 20,
    localAcceptedWordsPerDay: null,
    deepCompletesPerMonth: 1_000,
    personalDeviceLimit: 3,
    continuousMemoryExtraction: true,
    customWritingInstructions: true,
    modelCatalogAccess: true,
  },
} as const;

export type PlanId = keyof typeof planCapabilities;
export type PaidPlanId = Exclude<PlanId, "free">;
export type BillingInterval = "monthly";
export type EntitlementSource = "free" | "trial" | "paid";

export type EntitlementFacts = {
  readonly planId: PlanId;
  readonly source: EntitlementSource;
  readonly effectiveEnd?: string;
  readonly trialStartedAt?: string;
  readonly billingInterval?: BillingInterval;
  readonly subscriptionId?: string;
  readonly currentPeriodStart?: string;
  readonly currentPeriodEnd?: string;
  readonly cancelAtPeriodEnd?: boolean;
};

export type UsageFacts = {
  readonly period: string;
  readonly used: number;
  readonly periodStartsAt?: string;
  readonly periodEndsAt?: string;
};

export type BillingProjectionInput = {
  readonly entitlement: EntitlementFacts;
  readonly now: Date;
  readonly localDay?: string;
  readonly localResetAt?: Date;
  readonly localAcceptedWords: UsageFacts;
  readonly deepCompletes: UsageFacts;
  readonly activeDevices: number;
};

export type AllowancePeriod = {
  readonly period: string;
  readonly periodStartsAt: string;
  readonly periodEndsAt: string;
};

export function isPlanId(value: string | undefined): value is PlanId {
  return Boolean(value && value in planCapabilities);
}

export function isPaidPlanId(value: string | undefined): value is PaidPlanId {
  return isPlanId(value) && value !== "free";
}

export function getPlanCapabilities(planId: PlanId) {
  const plan = planCapabilities[planId];
  return {
    localAcceptedWordsPerDay: plan.localAcceptedWordsPerDay,
    deepCompletesPerMonth: plan.deepCompletesPerMonth,
    personalDeviceLimit: plan.personalDeviceLimit,
    continuousMemoryExtraction: plan.continuousMemoryExtraction,
    customWritingInstructions: plan.customWritingInstructions,
    modelCatalogAccess: plan.modelCatalogAccess,
  };
}

function localDay(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function nextLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
}

export function getAllowancePeriods(input: {
  readonly now: Date;
  readonly localDay?: string;
  readonly localResetAt?: Date;
  readonly deepCompletePeriod: AllowancePeriod;
}) {
  const localPeriod = input.localDay ?? localDay(input.now);
  return {
    localAcceptedWords: {
      period: localPeriod,
      periodStartsAt: `${localPeriod}T00:00:00`,
      periodEndsAt: (input.localResetAt ?? nextLocalDay(input.now)).toISOString(),
    },
    deepCompletes: input.deepCompletePeriod,
  };
}

function allowanceState(
  facts: UsageFacts,
  period: AllowancePeriod,
  limit: number | null,
) {
  const effectivePeriod =
    facts.period > period.period
      ? {
          period: facts.period,
          periodStartsAt: facts.periodStartsAt ?? period.periodStartsAt,
          periodEndsAt: facts.periodEndsAt ?? period.periodEndsAt,
        }
      : period;
  const used = facts.period === effectivePeriod.period ? facts.used : 0;
  return {
    period: effectivePeriod.period,
    used,
    limit,
    remaining: limit === null ? null : Math.max(0, limit - used),
    periodStartsAt: effectivePeriod.periodStartsAt,
    periodEndsAt: effectivePeriod.periodEndsAt,
    exhausted: limit !== null && used >= limit,
  };
}

export function projectEntitlement(
  entitlement: EntitlementFacts,
  now: Date,
) {
  const expired = Boolean(
    entitlement.source !== "free" &&
      entitlement.effectiveEnd &&
      new Date(entitlement.effectiveEnd) <= now,
  );
  return expired
    ? { planId: "free" as const, source: "free" as const }
    : entitlement;
}

export function projectBillingStatus(input: BillingProjectionInput) {
  const entitlement = projectEntitlement(input.entitlement, input.now);
  const planId = entitlement.planId;
  const entitlementSource = entitlement.source;
  const capabilities = getPlanCapabilities(planId);
  if (
    !input.entitlement.subscriptionId ||
    !input.entitlement.currentPeriodStart ||
    !input.entitlement.currentPeriodEnd
  ) {
    throw new Error("Billing status requires a cached Polar subscription period");
  }
  const periods = getAllowancePeriods({
    ...input,
    deepCompletePeriod: {
      period: `${input.entitlement.subscriptionId}:${input.entitlement.currentPeriodStart}`,
      periodStartsAt: input.entitlement.currentPeriodStart,
      periodEndsAt: input.entitlement.currentPeriodEnd,
    },
  });
  const trial =
    entitlementSource === "trial" &&
    input.entitlement.trialStartedAt &&
    input.entitlement.effectiveEnd
      ? {
          active: true as const,
          startedAt: input.entitlement.trialStartedAt,
          endsAt: input.entitlement.effectiveEnd,
        }
      : { active: false as const };

  return {
    planId,
    entitlementSource,
    ...(entitlementSource === "paid" && input.entitlement.billingInterval
      ? { billingInterval: input.entitlement.billingInterval }
      : {}),
    ...(entitlementSource === "paid" && input.entitlement.effectiveEnd
      ? { accessEndsAt: input.entitlement.effectiveEnd }
      : {}),
    cancelAtPeriodEnd: input.entitlement.cancelAtPeriodEnd ?? false,
    capabilities,
    trial,
    localAcceptedWords: allowanceState(
      input.localAcceptedWords,
      periods.localAcceptedWords,
      capabilities.localAcceptedWordsPerDay,
    ),
    deepCompletes: allowanceState(
      input.deepCompletes,
      periods.deepCompletes,
      capabilities.deepCompletesPerMonth,
    ),
    devices: {
      active: input.activeDevices,
      limit: capabilities.personalDeviceLimit,
      canLink: input.activeDevices < capabilities.personalDeviceLimit,
    },
    ...(planId === "free" ? { upgradeUrl: "/pricing" } : {}),
  };
}

export function shouldCountDeepComplete(
  suggestionsReturned: number,
): boolean {
  return suggestionsReturned > 0;
}

export function countAcceptedWords(text: string): number {
  if (typeof Intl.Segmenter === "function") {
    const segments = new Intl.Segmenter(undefined, {
      granularity: "word",
    }).segment(text);
    let count = 0;
    for (const segment of segments) {
      if (segment.isWordLike && /\p{L}/u.test(segment.segment)) count += 1;
    }
    return count;
  }

  // Older runtimes conservatively count Unicode letter/number runs and keep
  // apostrophe contractions together. CJK runs count as one fallback word.
  return text.match(/\p{L}[\p{L}\p{M}\p{N}]*(?:['’]\p{L}[\p{L}\p{M}\p{N}]*)*/gu)?.length ?? 0;
}
