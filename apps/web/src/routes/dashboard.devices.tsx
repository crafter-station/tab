import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { DashboardDevicesPage } from "../components/dashboard/devices.tsx";

const dashboardRoute = getRouteApi("/dashboard");

function DashboardDevicesRouteComponent() {
  return <DashboardDevicesPage data={dashboardRoute.useLoaderData()} />;
}

export const Route = createFileRoute("/dashboard/devices")({ component: DashboardDevicesRouteComponent });
