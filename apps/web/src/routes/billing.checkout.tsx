import { createFileRoute } from "@tanstack/react-router";
import { routeHandlers } from "../lib/route-handlers.server.ts";

export const Route = createFileRoute("/billing/checkout")({
  server: { handlers: { GET: ({ request }) => routeHandlers.checkout(request) } },
});
