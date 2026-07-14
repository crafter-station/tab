import { createFileRoute, redirect } from "@tanstack/react-router";
import { SignupPage } from "../components/pages/auth.tsx";
import { MessagePage } from "../components/pages/shared.tsx";
import { authorizeExistingDevice } from "../lib/auth.functions.ts";
import { AuthSearchSchema } from "../lib/search.ts";
import { getViewer } from "../lib/viewer.functions.ts";
import { routeHandlers } from "../lib/route-handlers.server.ts";
import { safeNextPath } from "../lib/search.ts";

function SignupRouteComponent() {
  const search = Route.useSearch();
  if (search.status === "verify_email") return <MessagePage title="Check your email" message="We sent you a verification link. Verify your email address before choosing a plan." />;
  const error = search.error ? "We could not create that account. Check the details and try again." : undefined;
  return <SignupPage search={search} error={error} />;
}

export const Route = createFileRoute("/signup")({
  validateSearch: AuthSearchSchema,
  beforeLoad: async ({ search }) => {
    if (search.status === "verify_email") return;
    const viewer = await getViewer();
    if (!viewer) return;
    if (search.device_id && search.callback) await authorizeExistingDevice({ data: { callback: search.callback, deviceId: search.device_id } });
    throw redirect({ href: safeNextPath(search.next) ?? "/dashboard" });
  },
  component: SignupRouteComponent,
  head: () => ({ meta: [{ title: "Sign up - Tab" }] }),
  server: { handlers: { POST: ({ request }) => routeHandlers.signup(request) } },
});
