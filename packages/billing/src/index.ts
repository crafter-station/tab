export const planQuotas = {
  free: { monthlyAutocompleteSuggestions: 100, monthlyPriceUsd: 0 },
  pro: { monthlyAutocompleteSuggestions: 1_000, monthlyPriceUsd: 10 },
  max: { monthlyAutocompleteSuggestions: 1_000_000, monthlyPriceUsd: 100 },
} as const;

export type PlanId = keyof typeof planQuotas;

export function shouldCountSuggestionResponse(suggestionsReturned: number): boolean {
  return suggestionsReturned > 0;
}
