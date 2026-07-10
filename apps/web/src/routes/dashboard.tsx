import { createRoute, useRouterState } from "@tanstack/react-router";
import { DashboardLayout, type DashboardSection } from "../components/pages/dashboard.tsx";
import { rootRoute } from "./__root.tsx";

function sectionFromPathname(pathname: string): DashboardSection {
  if (pathname.endsWith("/account")) return "account";
  if (pathname.endsWith("/usage")) return "usage";
  if (pathname.endsWith("/devices")) return "devices";
  if (pathname.endsWith("/memories")) return "memories";
  return "overview";
}

function DashboardRouteComponent() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return <DashboardLayout section={sectionFromPathname(pathname)} />;
}

export const Route = createRoute({ getParentRoute: () => rootRoute, path: "dashboard", component: DashboardRouteComponent });
