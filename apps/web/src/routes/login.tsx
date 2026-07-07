import { createRoute, useSearch } from "@tanstack/react-router";
import { LoginPage } from "../components/web-pages.tsx";
import { rootRoute } from "./__root.tsx";

function LoginRouteComponent() {
  const search = useSearch({ strict: false }) as { device_id?: string; callback?: string };
  return <LoginPage search={search} />;
}

export const Route = createRoute({ getParentRoute: () => rootRoute, path: "login", component: LoginRouteComponent });
