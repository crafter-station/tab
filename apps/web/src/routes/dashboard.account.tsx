import { createRoute } from "@tanstack/react-router";
import { DashboardAccountPage, useDashboardData } from "../components/pages/dashboard.tsx";
import { Route as DashboardRoute } from "./dashboard.tsx";

function DashboardAccountRouteComponent() {
  const data = useDashboardData();
  return <DashboardAccountPage data={data} />;
}

export const Route = createRoute({
  getParentRoute: () => DashboardRoute,
  path: "account",
  component: DashboardAccountRouteComponent,
});
