import { createRoute, useSearch } from "@tanstack/react-router";
import { SignupPage } from "../components/pages/auth.tsx";
import { rootRoute } from "./__root.tsx";

function SignupRouteComponent() {
  const search = useSearch({ strict: false }) as { device_id?: string; callback?: string };
  return <SignupPage search={search} />;
}

export const Route = createRoute({ getParentRoute: () => rootRoute, path: "signup", component: SignupRouteComponent });
