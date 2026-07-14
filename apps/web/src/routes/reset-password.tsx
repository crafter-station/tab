import { createFileRoute } from "@tanstack/react-router";
import { ResetPasswordPage } from "../components/pages/auth.tsx";
import { ResetSearchSchema } from "../lib/search.ts";
import { routeHandlers } from "../lib/route-handlers.server.ts";

function ResetPasswordRouteComponent() {
  const search = Route.useSearch();
  const error = search.error === "INVALID_TOKEN"
    ? "This reset link is invalid or expired."
    : search.error ? "Could not update your password. Request a new reset link and try again." : undefined;
  return <ResetPasswordPage token={search.token} error={error} />;
}

export const Route = createFileRoute("/reset-password")({
  validateSearch: ResetSearchSchema,
  component: ResetPasswordRouteComponent,
  head: () => ({ meta: [{ title: "Choose a new password - Tab" }] }),
  server: { handlers: { POST: ({ request }) => routeHandlers.resetPassword(request) } },
});
