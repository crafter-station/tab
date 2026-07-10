import { createRoute } from "@tanstack/react-router";
import { DashboardMemoriesPage, useDashboardData } from "../components/pages/dashboard.tsx";
import { Route as DashboardRoute } from "./dashboard.tsx";

function DashboardMemoriesRouteComponent() {
  const data = useDashboardData();
  return <DashboardMemoriesPage data={data} />;
}

export const Route = createRoute({
  getParentRoute: () => DashboardRoute,
  path: "memories",
  component: DashboardMemoriesRouteComponent,
});
