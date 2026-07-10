import { createRoute } from "@tanstack/react-router";
import { DashboardUsagePage, useDashboardData } from "../components/pages/dashboard.tsx";
import { Route as DashboardRoute } from "./dashboard.tsx";

function DashboardUsageRouteComponent() {
  const data = useDashboardData();
  return <DashboardUsagePage data={data} />;
}

export const Route = createRoute({
  getParentRoute: () => DashboardRoute,
  path: "usage",
  component: DashboardUsageRouteComponent,
});
