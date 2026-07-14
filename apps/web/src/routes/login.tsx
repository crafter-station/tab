import { createFileRoute, redirect } from "@tanstack/react-router";
import { LoginPage } from "../components/pages/auth.tsx";
import { authorizeExistingDevice } from "../lib/auth.functions.ts";
import { getViewer } from "../lib/viewer.functions.ts";
import { AuthSearchSchema, safeNextPath } from "../lib/search.ts";
import { routeHandlers } from "../lib/route-handlers.server.ts";

const errors = {
  invalid_form: "Invalid form submission.",
  invalid_credentials: "Invalid email or password.",
  email_unverified: "Check your email to verify your account before signing in.",
  device_failed: "Signed in, but failed to authorize this device.",
  signup_failed: undefined,
} as const;

function LoginRouteComponent() {
  const search = Route.useSearch();
  return <LoginPage search={search} error={search.error ? errors[search.error] : undefined} verified={search.status === "email_verified"} />;
}

export const Route = createFileRoute("/login")({
  validateSearch: AuthSearchSchema,
  beforeLoad: async ({ search }) => {
    const viewer = await getViewer();
    if (!viewer) return;
    if (search.device_id && search.callback) await authorizeExistingDevice({ data: { callback: search.callback, deviceId: search.device_id } });
    throw redirect({ href: safeNextPath(search.next) ?? "/dashboard" });
  },
  component: LoginRouteComponent,
  head: () => ({ meta: [{ title: "Sign in - Tab" }] }),
  server: { handlers: { POST: ({ request }) => routeHandlers.login(request) } },
});
