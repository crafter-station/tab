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
      title="Automatic Suggestions"
      usage={usage}
      remaining={finite ? `${formatCount(allowance.remaining ?? 0)} words left` : "Unlimited"}
      detail={finite ? `Daily limit resets ${formatDate(allowance.resetAt)}` : `No daily limit on ${planName}`}
      percentage={allowancePercentage(allowance)}
    />
  );
}

export function DeepCompleteAllowance({ allowance }: { allowance: AllowanceState }) {
  return (
    <AllowanceMeter
      title="Deep Complete"
      usage={`${formatCount(allowance.used)} of ${formatCount(allowance.limit ?? 0)} used this month`}
      remaining={`${formatCount(allowance.remaining ?? 0)} Deep Completes left`}
      detail={`Monthly limit resets ${formatDate(allowance.resetAt)}`}
      percentage={allowancePercentage(allowance)}
    />
  );
}
