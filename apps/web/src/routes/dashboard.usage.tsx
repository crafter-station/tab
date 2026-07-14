import { createFileRoute } from "@tanstack/react-router";
import { useDashboardData } from "../components/dashboard/layout.tsx";
import { DashboardUsagePage } from "../components/dashboard/usage.tsx";

function DashboardUsageRouteComponent() {
  const data = useDashboardData();
  return <DashboardUsagePage data={data} />;
}

export const Route = createFileRoute("/dashboard/usage")({ component: DashboardUsageRouteComponent });
