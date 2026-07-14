import { Link } from "@tanstack/react-router";
import { Button, CardContent, SectionCard, SummaryMetric } from "@tab/ui";
import { formatCount, formatDate } from "../pages/shared.tsx";
import { DashboardSectionContent } from "./layout.tsx";
import { formatPlanName, QuotaProgressPanel } from "./shared.tsx";
import type { DashboardData } from "./types.ts";

export function DashboardOverviewPage({ data }: { data: DashboardData }) {
  const connectedDevices = data.devices.filter((device) => !device.revoked).length;
  const emailStatus = data.user.emailVerified === false ? "Verify your email" : "Email verified";

  return (
    <DashboardSectionContent section="overview">
      <div className="grid gap-10">
        <SectionCard>
          <CardContent className="grid gap-x-8 gap-y-2 p-5 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryMetric label="Words completed" value={formatCount(data.localSuggestionActivity.acceptedWords)} detail="From Local Suggestions this month" />
            <SummaryMetric label="Active writing days" value={formatCount(data.localSuggestionActivity.activeWritingDays)} detail="This month" />
            <SummaryMetric label="Deep Completes" value={formatCount(data.billing.deepCompletes.used)} detail="Successful results this month" />
            <SummaryMetric label="Plan" value={formatPlanName(data.billing.planId)} detail={data.billing.trial.active ? `Trial ends ${formatDate(data.billing.trial.endsAt)}` : undefined} />
          </CardContent>
        </SectionCard>
        <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start">
          <SectionCard>
            <CardContent className="grid gap-7 p-5 sm:p-6">
              <QuotaProgressPanel title="Local Accepted Words today" usage={data.billing.localAcceptedWords.used} quota={data.billing.localAcceptedWords.limit} resetAt={data.billing.localAcceptedWords.resetAt} />
              <QuotaProgressPanel title="Deep Completes this month" usage={data.billing.deepCompletes.used} quota={data.billing.deepCompletes.limit} resetAt={data.billing.deepCompletes.resetAt} />
            </CardContent>
          </SectionCard>
          <div className="grid gap-3 lg:pt-2">
            <p className="text-sm font-semibold text-foreground">{formatCount(connectedDevices)} of {formatCount(data.billing.devices.limit)} Macs connected</p>
            <p className="text-sm leading-relaxed text-muted-foreground">{emailStatus}. Allowances are independent, so reaching one does not disable the other mode.</p>
            <p><Button asChild variant="secondary" size="sm"><Link to="/dashboard/usage">View usage and billing</Link></Button></p>
          </div>
        </section>
      </div>
    </DashboardSectionContent>
  );
}
