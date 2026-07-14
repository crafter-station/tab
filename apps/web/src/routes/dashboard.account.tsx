import { createFileRoute } from "@tanstack/react-router";
import { DashboardAccountPage } from "../components/dashboard/account.tsx";
import { useDashboardData } from "../components/dashboard/layout.tsx";

function DashboardAccountRouteComponent() {
  const data = useDashboardData();
  return <DashboardAccountPage data={data} />;
}

export const Route = createFileRoute("/dashboard/account")({ component: DashboardAccountRouteComponent });
