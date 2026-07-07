import { createRoute, redirect } from "@tanstack/react-router";
import { rootRoute } from "./__root.tsx";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "account",
  beforeLoad: () => {
    throw redirect({ href: "/dashboard" });
  },
});
