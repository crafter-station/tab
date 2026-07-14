import { isPaidPlanId } from "@tab/billing";
import { Alert, AlertDescription, AlertTitle, Button, CardContent, SectionCard, SummaryMetric } from "@tab/ui";
import { formatCount, formatDate } from "../pages/shared.tsx";
import { DashboardSectionContent } from "./layout.tsx";
import { AutomaticSuggestionAllowance, DeepCompleteAllowance, formatPlanName } from "./shared.tsx";
import type { DashboardData } from "./types.ts";

export function DashboardUsagePage({ data }: { data: DashboardData }) {
  const billing = data.billing;
  const bothAllowancesExhausted = billing.localAcceptedWords.exhausted && billing.deepCompletes.exhausted;
  const hasPaidPlan = isPaidPlanId(billing.planId);

  return (
    <DashboardSectionContent section="usage">
      <div className="grid gap-10">
        <section className="grid gap-7">
          <SectionCard>
            <CardContent className="grid gap-x-8 gap-y-2 p-5 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryMetric label="Automatic Suggestions accepted" value={formatCount(data.localSuggestionActivity.acceptedSuggestions)} detail="This month" />
              <SummaryMetric label="Words inserted" value={formatCount(data.localSuggestionActivity.acceptedWords)} detail="From Automatic Suggestions this month" />
              <SummaryMetric label="Deep Completes used" value={formatCount(billing.deepCompletes.used)} detail="Successful results this month" />
              <SummaryMetric label="Active writing days" value={formatCount(data.localSuggestionActivity.activeWritingDays)} detail="This month" />
            </CardContent>
          </SectionCard>
          <SectionCard>
            <CardContent className="flex items-center justify-between gap-4 p-5">
              <div>
                <p className="text-xs font-semibold uppercase text-muted-foreground">Current plan</p>
                <p className="mt-2 text-xl font-bold">{formatPlanName(billing.planId)}{billing.trial.active ? " trial" : ""}</p>
              </div>
              <p className="text-sm text-muted-foreground">{billing.trial.active ? `Ends ${formatDate(billing.trial.endsAt)}` : billing.billingInterval ? `${billing.billingInterval} billing` : "Free account"}</p>
            </CardContent>
          </SectionCard>
          <SectionCard>
            <CardContent className="grid gap-4 p-5 sm:p-6">
              <div>
                <h2 className="text-base font-bold">Plan allowances</h2>
                <p className="mt-1 text-sm text-muted-foreground">Automatic Suggestions and Deep Complete reset independently.</p>
              </div>
              <AutomaticSuggestionAllowance allowance={billing.localAcceptedWords} planName={formatPlanName(billing.planId)} />
              <DeepCompleteAllowance allowance={billing.deepCompletes} />
            </CardContent>
          </SectionCard>
          {billing.localAcceptedWords.exhausted || billing.deepCompletes.exhausted ? (
            <Alert>
              <AlertTitle>Allowance reached</AlertTitle>
              <AlertDescription>
                {bothAllowancesExhausted
                  ? "Both allowances are used. They reset independently. "
                  : `${billing.localAcceptedWords.exhausted ? "Local Accepted Words allowance used. " : ""}${billing.deepCompletes.exhausted ? "Deep Complete allowance used. " : ""}The other mode still works. `}<a className="underline" href="/pricing">View plans</a>.
              </AlertDescription>
            </Alert>
          ) : null}
        </section>
        <SectionCard>
          <CardContent className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div>
              <h2 className="text-xl font-bold">{hasPaidPlan ? `${formatPlanName(billing.planId)} subscription` : "Need higher allowances?"}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{hasPaidPlan ? `Your paid plan includes ${formatCount(billing.deepCompletes.limit ?? 0)} Deep Completes each month.` : "Compare paid plans for unlimited Local Accepted Words and higher Deep Complete allowances."}</p>
            </div>
            <Button asChild variant="secondary" size="sm"><a href={hasPaidPlan ? "/billing/portal" : "/pricing"}>{hasPaidPlan ? "Manage subscription" : "Compare plans"}</a></Button>
          </CardContent>
        </SectionCard>
      </div>
    </DashboardSectionContent>
  );
}
