import { createFileRoute, redirect } from "@tanstack/react-router";
import { DashboardLayout } from "../components/dashboard/layout.tsx";
import { getDashboardData } from "../lib/dashboard.functions.ts";
import { getViewer } from "../lib/viewer.functions.ts";

function DashboardRouteComponent() {
  const data = Route.useLoaderData();
  return <DashboardLayout data={data} />;
}

export const Route = createFileRoute("/dashboard")({
  beforeLoad: async () => {
    if (!await getViewer()) throw redirect({ href: "/login" });
  },
  loader: () => getDashboardData(),
  component: DashboardRouteComponent,
});
