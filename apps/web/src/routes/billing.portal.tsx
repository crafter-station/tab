import { createRoute } from "@tanstack/react-router";
import { MessagePage } from "../components/web-pages.tsx";
import { rootRoute } from "./__root.tsx";

function PortalPage() {
  return <MessagePage title="Opening billing settings" message="Taking you to your billing settings..." />;
}

export const Route = createRoute({ getParentRoute: () => rootRoute, path: "billing/portal", component: PortalPage });
