import { createFileRoute } from "@tanstack/react-router";
import { VerifyEmailPage } from "../components/pages/auth.tsx";
import { routeHandlers } from "../lib/route-handlers.server.ts";
import { VerifyEmailSearchSchema } from "../lib/search.ts";

function VerifyEmailRouteComponent() {
  const search = Route.useSearch();
  return <VerifyEmailPage callbackURL={search.callbackURL} error={search.error} />;
}

export const Route = createFileRoute("/verify-email")({
  validateSearch: VerifyEmailSearchSchema,
  component: VerifyEmailRouteComponent,
  head: () => ({ meta: [{ title: "Verify your email - Tab" }] }),
  server: { handlers: { POST: ({ request }) => routeHandlers.resendVerification(request) } },
});
