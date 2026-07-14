import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { DashboardUsagePage } from "../components/dashboard/usage.tsx";

const dashboardRoute = getRouteApi("/dashboard");

function DashboardUsageRouteComponent() {
  return <DashboardUsagePage data={dashboardRoute.useLoaderData()} />;
}

export const Route = createFileRoute("/dashboard/usage")({ component: DashboardUsageRouteComponent });
