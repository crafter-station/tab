import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./__root.tsx";

function PortalPage() {
  return <p>Opening billing portal...</p>;
}

export const Route = createRoute({ getParentRoute: () => rootRoute, path: "billing/portal", component: PortalPage });
