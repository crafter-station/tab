import { createRoute } from "@tanstack/react-router";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@tabb/ui";
import { rootRoute } from "./__root.tsx";

function DashboardPage() {
  return (
    <>
      <h1 className="mb-4 text-[clamp(2.5rem,8vw,5.75rem)] leading-[0.9] font-black tracking-[-0.08em]">Dashboard</h1>
      <p className="max-w-2xl text-[clamp(1.05rem,2vw,1.35rem)] text-muted-foreground">Manage account configuration, usage, billing, devices, permissions, and Personal Memory.</p>
      <div className="mt-6 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
        <Card><CardHeader><CardTitle>Monthly usage</CardTitle></CardHeader><CardContent className="flex flex-col gap-4 text-muted-foreground"><p>Plan, quota, and reset dates load from the Tabb API when you are signed in.</p><p><Button asChild variant="secondary"><a href="/billing/portal">Manage billing</a></Button></p></CardContent></Card>
        <Card><CardHeader><CardTitle>Account</CardTitle></CardHeader><CardContent className="text-muted-foreground"><p>Identity and safe account settings appear here without inventing unsupported settings APIs.</p></CardContent></Card>
        <Card id="devices"><CardHeader><CardTitle>Devices</CardTitle></CardHeader><CardContent className="text-muted-foreground"><p>Linked native devices, versions, status, and revoke controls are powered by the existing device APIs.</p></CardContent></Card>
        <Card id="memories"><CardHeader><CardTitle>Personal Memory</CardTitle></CardHeader><CardContent className="text-muted-foreground"><p>Review and delete memories collected for autocomplete personalization.</p></CardContent></Card>
      </div>
    </>
  );
}

export const Route = createRoute({ getParentRoute: () => rootRoute, path: "dashboard", component: DashboardPage });
