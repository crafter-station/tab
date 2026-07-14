import { createFileRoute } from "@tanstack/react-router";
import { routeHandlers } from "../lib/route-handlers.server.ts";

export const Route = createFileRoute("/dashboard/devices/$deviceId/revoke")({
  server: { handlers: { POST: ({ request, params }) => routeHandlers.deviceRevoke(request, params.deviceId) } },
});
