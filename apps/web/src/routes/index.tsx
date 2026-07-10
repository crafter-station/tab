import { createRoute } from "@tanstack/react-router";
import { HomePage } from "../components/pages/marketing.tsx";
import { rootRoute } from "./__root.tsx";

export const Route = createRoute({ getParentRoute: () => rootRoute, path: "/", component: HomePage });
