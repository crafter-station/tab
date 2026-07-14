import { createFileRoute } from "@tanstack/react-router";
import { routeHandlers } from "../lib/route-handlers.server.ts";

export const Route = createFileRoute("/dashboard/memories/delete-selected")({
  server: { handlers: { POST: ({ request }) => routeHandlers.memoryBulkDelete(request) } },
});
