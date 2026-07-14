import { createFileRoute } from "@tanstack/react-router";
import { ForgotPasswordPage } from "../components/pages/auth.tsx";
import { z } from "zod";
import { routeHandlers } from "../lib/route-handlers.server.ts";

function ForgotPasswordRoute() {
  const search = Route.useSearch();
  return <ForgotPasswordPage sent={search.status === "reset_sent"} error={search.error ? "Could not send a reset link. Please try again." : undefined} />;
}

export const Route = createFileRoute("/forgot-password")({
  validateSearch: z.object({ status: z.literal("reset_sent").optional().catch(undefined), error: z.string().optional().catch(undefined) }),
  component: ForgotPasswordRoute,
  head: () => ({ meta: [{ title: "Reset password - Tab" }] }),
  server: { handlers: { POST: ({ request }) => routeHandlers.forgotPassword(request) } },
});
