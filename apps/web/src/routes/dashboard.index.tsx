import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { DashboardOverviewPage } from "../components/dashboard/overview.tsx";

const dashboardRoute = getRouteApi("/dashboard");

function DashboardIndexRoute() {
  return <DashboardOverviewPage data={dashboardRoute.useLoaderData()} />;
}

export const Route = createFileRoute("/dashboard/")({ component: DashboardIndexRoute });
