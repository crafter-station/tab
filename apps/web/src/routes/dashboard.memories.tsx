import { createFileRoute } from "@tanstack/react-router";
import { useDashboardData } from "../components/dashboard/layout.tsx";
import { DashboardMemoriesPage } from "../components/dashboard/memories.tsx";

function DashboardMemoriesRouteComponent() {
  const data = useDashboardData();
  return <DashboardMemoriesPage data={data} />;
}

export const Route = createFileRoute("/dashboard/memories")({ component: DashboardMemoriesRouteComponent });
