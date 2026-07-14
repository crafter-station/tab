import { createRoute } from "@tanstack/react-router";
import { PricingPage } from "../components/pages/marketing.tsx";
import { rootRoute } from "./__root.tsx";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "pricing",
  component: PricingPage,
  head: () => ({ meta: [{ title: "Pricing - Tab" }, { name: "description", content: "Compare Tab Free, Pro, and Max, including one month free on paid plans, monthly pricing, Local Suggestion and Deep Complete allowances, and cancellation." }] }),
});
