import { createRoute } from "@tanstack/react-router";
import { DashboardPage } from "../components/web-pages.tsx";
import { rootRoute } from "./__root.tsx";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "dashboard/devices",
  component: () => <DashboardPage section="devices" />,
});
