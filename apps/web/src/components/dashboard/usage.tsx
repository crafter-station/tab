import { isPaidPlanId } from "@tab/billing";
import { ArrowSquareOut } from "@phosphor-icons/react";
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
          <SectionCard variant="quiet">
            <CardContent className="grid gap-x-8 gap-y-2 p-5 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryMetric label="Suggestions used" value={formatCount(data.localSuggestionActivity.acceptedSuggestions)} detail="This month" />
              <SummaryMetric label="Words inserted" value={formatCount(data.localSuggestionActivity.acceptedWords)} detail="This month" />
              <SummaryMetric label="Deep Suggestions used" value={formatCount(billing.deepCompletes.used)} detail="This period" />
              <SummaryMetric label="Active writing days" value={formatCount(data.localSuggestionActivity.activeWritingDays)} detail="This month" />
            </CardContent>
          </SectionCard>
          <SectionCard variant="quiet">
            <CardContent className="flex items-center justify-between gap-4 p-5">
              <div>
                <p className="text-xs font-semibold uppercase text-muted-foreground">Current plan</p>
                <p className="mt-2 text-xl font-bold">{formatPlanName(billing.planId)}{billing.trial.active ? " trial" : ""}</p>
              </div>
              <p className="text-sm text-muted-foreground">{billing.trial.active ? `Ends ${formatDate(billing.trial.endsAt)}` : billing.billingInterval ? `${billing.billingInterval} billing` : "Free account"}</p>
            </CardContent>
          </SectionCard>
          <SectionCard variant="plain">
            <CardContent className="grid gap-4 p-0">
              <div>
                <h2 className="text-base font-bold">Plan allowances</h2>
                <p className="mt-1 text-sm text-muted-foreground">Each limit resets separately.</p>
              </div>
              <AutomaticSuggestionAllowance allowance={billing.localAcceptedWords} planName={formatPlanName(billing.planId)} />
              <DeepCompleteAllowance
                allowance={billing.deepCompletes}
                cancelAtPeriodEnd={billing.cancelAtPeriodEnd}
                planEndsAt={billing.accessEndsAt}
                trialEndsAt={billing.trial.active ? billing.trial.endsAt : undefined}
              />
            </CardContent>
          </SectionCard>
          {billing.localAcceptedWords.exhausted || billing.deepCompletes.exhausted ? (
            <Alert>
              <AlertTitle>Allowance reached</AlertTitle>
              <AlertDescription>
                {bothAllowancesExhausted
                  ? "Both allowances are used. They reset independently. "
                  : `${billing.localAcceptedWords.exhausted ? "Daily suggestion limit reached. " : ""}${billing.deepCompletes.exhausted ? "Deep Suggestion limit reached. " : ""}The other option still works. `}<a className="underline" href="/pricing">View plans</a>.
              </AlertDescription>
            </Alert>
          ) : null}
        </section>
        <SectionCard>
          <CardContent className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div>
              <h2 className="text-xl font-bold">Billing</h2>
              <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">{hasPaidPlan ? `Manage your ${formatPlanName(billing.planId)} plan.` : "Compare plans for higher limits."}</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {!hasPaidPlan ? <Button asChild variant="ghost" size="sm"><a href="/pricing">Compare plans</a></Button> : null}
              <Button asChild variant="secondary" size="sm">
                <a href="/billing/portal">Manage billing <ArrowSquareOut aria-hidden="true" /></a>
              </Button>
            </div>
          </CardContent>
        </SectionCard>
      </div>
    </DashboardSectionContent>
  );
}
