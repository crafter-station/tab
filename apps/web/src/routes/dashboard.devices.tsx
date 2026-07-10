import { createRoute } from "@tanstack/react-router";
import { DashboardDevicesPage, useDashboardData } from "../components/pages/dashboard.tsx";
import { Route as DashboardRoute } from "./dashboard.tsx";

function DashboardDevicesRouteComponent() {
  const data = useDashboardData();
  return <DashboardDevicesPage data={data} />;
}

export const Route = createRoute({
  getParentRoute: () => DashboardRoute,
  path: "devices",
  component: DashboardDevicesRouteComponent,
});
