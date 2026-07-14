import { createFileRoute } from "@tanstack/react-router";
import { routeHandlers } from "../lib/route-handlers.server.ts";

export const Route = createFileRoute("/billing/portal")({
  server: { handlers: { GET: ({ request }) => routeHandlers.portal(request) } },
});
