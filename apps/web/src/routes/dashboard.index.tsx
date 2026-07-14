import { createFileRoute } from "@tanstack/react-router";
import { useDashboardData } from "../components/dashboard/layout.tsx";
import { DashboardOverviewPage } from "../components/dashboard/overview.tsx";

function DashboardIndexRoute() {
  return <DashboardOverviewPage data={useDashboardData()} />;
}

export const Route = createFileRoute("/dashboard/")({ component: DashboardIndexRoute });
