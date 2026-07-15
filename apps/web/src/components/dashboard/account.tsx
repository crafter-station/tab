import { Button, CardContent, SectionCard, StatusRow } from "@tab/ui";
import { DashboardSectionContent } from "./layout.tsx";
import type { DashboardData } from "./types.ts";

export function DashboardAccountPage({ data }: { data: DashboardData }) {
  const accountName = data.user.email ?? data.user.name ?? data.user.id;
  const needsVerification = data.user.emailVerified === false;

  return (
    <DashboardSectionContent section="account">
      <SectionCard variant="quiet">
        <CardContent className="grid gap-4 p-5 sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Signed-in account</p>
              <p className="mt-2 truncate text-lg font-semibold text-foreground">{accountName}</p>
            </div>
            <form method="post" action="/logout"><Button type="submit" variant="secondary">Sign out</Button></form>
          </div>
          <StatusRow
            label="Email status"
            value={needsVerification ? "Verify your email" : "Email verified"}
            tone={needsVerification ? "warning" : "success"}
            description={needsVerification ? "Verify your email before choosing a paid plan." : undefined}
          />
        </CardContent>
      </SectionCard>
    </DashboardSectionContent>
  );
}
