import { Link } from "@tanstack/react-router";
import { Button, CardContent, SectionCard, SummaryMetric } from "@tab/ui";
import { formatCount, formatDate } from "../pages/shared.tsx";
import { DashboardSectionContent } from "./layout.tsx";
import { AutomaticSuggestionAllowance, DeepCompleteAllowance, formatPlanName } from "./shared.tsx";
import type { DashboardData } from "./types.ts";

export function DashboardOverviewPage({ data }: { data: DashboardData }) {
  const connectedDevices = data.devices.filter((device) => !device.revoked).length;
  const emailStatus = data.user.emailVerified === false ? "Verify your email" : "Email verified";

  return (
    <DashboardSectionContent section="overview">
      <div className="grid gap-10">
        <SectionCard>
          <CardContent className="grid gap-x-8 gap-y-2 p-5 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryMetric label="Suggestions used" value={formatCount(data.localSuggestionActivity.acceptedSuggestions)} detail="This month" />
            <SummaryMetric label="Words inserted" value={formatCount(data.localSuggestionActivity.acceptedWords)} detail="This month" />
            <SummaryMetric label="Active writing days" value={formatCount(data.localSuggestionActivity.activeWritingDays)} detail="This month" />
            <SummaryMetric label="Deep Suggestions used" value={formatCount(data.billing.deepCompletes.used)} detail="This month" />
          </CardContent>
        </SectionCard>
        <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start">
          <SectionCard>
            <CardContent className="grid gap-7 p-5 sm:p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-base font-bold">Plan allowances</h2>
                <p className="text-sm text-muted-foreground">{formatPlanName(data.billing.planId)} plan{data.billing.trial.active ? ` trial ends ${formatDate(data.billing.trial.endsAt)}` : ""}</p>
              </div>
              <AutomaticSuggestionAllowance allowance={data.billing.localAcceptedWords} planName={formatPlanName(data.billing.planId)} />
              <DeepCompleteAllowance allowance={data.billing.deepCompletes} />
            </CardContent>
          </SectionCard>
          <div className="grid gap-3 lg:pt-2">
            <p className="text-sm font-semibold text-foreground">{formatCount(connectedDevices)} of {formatCount(data.billing.devices.limit)} Macs connected</p>
            <p className="text-sm leading-relaxed text-muted-foreground">{emailStatus}.</p>
            <p><Button asChild variant="secondary" size="sm"><Link to="/dashboard/usage">View usage and billing</Link></Button></p>
          </div>
        </section>
      </div>
    </DashboardSectionContent>
  );
}
