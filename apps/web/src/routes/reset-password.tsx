import { createRoute, useSearch } from "@tanstack/react-router";
import { ResetPasswordPage } from "../components/web-pages.tsx";
import { rootRoute } from "./__root.tsx";

function ResetPasswordRouteComponent() {
  const search = useSearch({ strict: false }) as { token?: string; error?: string };
  return <ResetPasswordPage token={search.token} error={search.error === "INVALID_TOKEN" ? "This reset link is invalid or expired." : undefined} />;
}

export const Route = createRoute({ getParentRoute: () => rootRoute, path: "reset-password", component: ResetPasswordRouteComponent });
