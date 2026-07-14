import { createFileRoute } from "@tanstack/react-router";
import { DashboardDevicesPage } from "../components/dashboard/devices.tsx";
import { useDashboardData } from "../components/dashboard/layout.tsx";

function DashboardDevicesRouteComponent() {
  const data = useDashboardData();
  return <DashboardDevicesPage data={data} />;
}

export const Route = createFileRoute("/dashboard/devices")({ component: DashboardDevicesRouteComponent });
