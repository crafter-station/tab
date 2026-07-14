import { createFileRoute } from "@tanstack/react-router";
import { routeHandlers } from "../lib/route-handlers.server.ts";

export const Route = createFileRoute("/verify-email/confirm")({
  server: { handlers: { GET: ({ request }) => routeHandlers.verifyEmail(request) } },
});
