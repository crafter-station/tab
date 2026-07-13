export const PLAN_IDS = ["free", "pro", "max"] as const;

export const planCapabilities = {
  free: {
    name: "Free",
    monthlyPriceUsd: 0,
    trialDays: 30,
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
    trialDays: 0,
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
    trialDays: 0,
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

export function isPlanId(value: string | undefined): value is PlanId {
  return Boolean(value && value in planCapabilities);
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
