import { createFileRoute } from "@tanstack/react-router";
import { routeHandlers } from "../lib/route-handlers.server.ts";

export const Route = createFileRoute("/dashboard/memories/$memoryId/delete")({
  server: { handlers: { POST: ({ request, params }) => routeHandlers.memoryDelete(request, params.memoryId) } },
});
