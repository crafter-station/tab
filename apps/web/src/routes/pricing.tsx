import { createRoute } from "@tanstack/react-router";
import { PricingPage } from "../components/pages/marketing.tsx";
import { rootRoute } from "./__root.tsx";

export const Route = createRoute({ getParentRoute: () => rootRoute, path: "pricing", component: PricingPage });
