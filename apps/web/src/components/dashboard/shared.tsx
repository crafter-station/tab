import { isPlanId, planCapabilities } from "@tab/billing";
import { AllowanceMeter } from "@tab/ui";
import type { AllowanceState } from "@tab/contracts";
import { formatCount, formatDate } from "../pages/shared.tsx";

export function formatPlanName(planId: string): string {
  if (isPlanId(planId)) return planCapabilities[planId].name;
  return planId.charAt(0).toUpperCase() + planId.slice(1);
}

export function allowancePercentage(allowance: AllowanceState): number | null {
  if (allowance.limit === null) return null;
  return Math.round((Math.min(allowance.used, allowance.limit) / allowance.limit) * 100);
}

export function AutomaticSuggestionAllowance({ allowance, planName }: { allowance: AllowanceState; planName: string }) {
  const finite = allowance.limit !== null;
  const usage = finite
    ? `${formatCount(allowance.used)} of ${formatCount(allowance.limit!)} accepted words used today`
    : `${formatCount(allowance.used)} accepted words today`;

  return (
    <AllowanceMeter
      title="Suggestions"
      usage={usage}
      remaining={finite ? `${formatCount(allowance.remaining ?? 0)} words left` : "Unlimited"}
      detail={finite ? "Resets daily" : `No daily limit on ${planName}`}
      percentage={allowancePercentage(allowance)}
    />
  );
}

export function DeepCompleteAllowance({ allowance, cancelAtPeriodEnd = false, planEndsAt, trialEndsAt }: { allowance: AllowanceState; cancelAtPeriodEnd?: boolean; planEndsAt?: string; trialEndsAt?: string }) {
  return (
    <AllowanceMeter
      title="Deep Suggestions"
      usage={`${formatCount(allowance.used)} of ${formatCount(allowance.limit ?? 0)} used`}
      remaining={`${formatCount(allowance.remaining ?? 0)} left`}
      detail={trialEndsAt
        ? `Trial ends ${formatDate(trialEndsAt)}; the paid billing period follows`
        : cancelAtPeriodEnd
          ? `Available until your plan ends ${formatDate(planEndsAt ?? allowance.periodEndsAt)}`
          : `Resets with your billing cycle on ${formatDate(allowance.periodEndsAt)}`}
      percentage={allowancePercentage(allowance)}
    />
  );
}
