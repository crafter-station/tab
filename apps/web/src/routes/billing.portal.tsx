import { createRoute } from "@tanstack/react-router";
import { MessagePage } from "../components/web-pages.tsx";
import { rootRoute } from "./__root.tsx";

function PortalPage() {
  return <MessagePage title="Opening billing portal" message="Redirecting you to your billing portal..." />;
}

export const Route = createRoute({ getParentRoute: () => rootRoute, path: "billing/portal", component: PortalPage });
