import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { DashboardMemoriesPage } from "../components/dashboard/memories.tsx";

const dashboardRoute = getRouteApi("/dashboard");

function DashboardMemoriesRouteComponent() {
  return <DashboardMemoriesPage data={dashboardRoute.useLoaderData()} />;
}

export const Route = createFileRoute("/dashboard/memories")({ component: DashboardMemoriesRouteComponent });
