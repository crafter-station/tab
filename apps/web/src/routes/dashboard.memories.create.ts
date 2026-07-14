import { createFileRoute } from "@tanstack/react-router";
import { routeHandlers } from "../lib/route-handlers.server.ts";

export const Route = createFileRoute("/dashboard/memories/create")({
  server: { handlers: { POST: ({ request }) => routeHandlers.memoryCreate(request) } },
});
