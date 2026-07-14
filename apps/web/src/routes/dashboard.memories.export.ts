import { createFileRoute } from "@tanstack/react-router";
import { routeHandlers } from "../lib/route-handlers.server.ts";

export const Route = createFileRoute("/dashboard/memories/export")({
  server: { handlers: { GET: ({ request }) => routeHandlers.memoryExport(request) } },
});
