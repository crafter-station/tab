import { isPlanId, planCapabilities } from "@tab/billing";
import { Progress } from "@tab/ui";
import { formatCount, formatDate } from "../pages/shared.tsx";

export function formatPlanName(planId: string): string {
  if (isPlanId(planId)) return planCapabilities[planId].name;
  return planId.charAt(0).toUpperCase() + planId.slice(1);
}

export function QuotaProgressPanel({ title, usage, quota, resetAt }: { title: string; usage: number; quota: number | null; resetAt: string }) {
  const quotaUsed = quota === null ? 0 : Math.min(usage, quota);
  const quotaPercent = quota && quota > 0 ? Math.round((quotaUsed / quota) * 100) : 0;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="font-[var(--font-code)] text-sm tabular-nums text-muted-foreground">{formatCount(usage)} of {quota === null ? "unlimited" : formatCount(quota)}</p>
      </div>
      {quota === null ? null : <Progress value={quotaPercent} aria-label={`${title} progress`} className="h-1.5 bg-border" />}
      <div className="flex items-center justify-between gap-4 text-xs font-medium text-muted-foreground">
        <span>{quota === null ? "Unlimited on your plan" : `${quotaPercent}% used`}</span>
        <span>Resets {formatDate(resetAt)}</span>
      </div>
    </div>
  );
}
