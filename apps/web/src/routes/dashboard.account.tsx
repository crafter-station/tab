import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { DashboardAccountPage } from "../components/dashboard/account.tsx";

const dashboardRoute = getRouteApi("/dashboard");

function DashboardAccountRouteComponent() {
  return <DashboardAccountPage data={dashboardRoute.useLoaderData()} />;
}

export const Route = createFileRoute("/dashboard/account")({ component: DashboardAccountRouteComponent });
