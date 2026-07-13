import { createRoute } from "@tanstack/react-router";
import { PricingPage } from "../components/pages/marketing.tsx";
import { rootRoute } from "./__root.tsx";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "pricing",
  component: PricingPage,
  head: () => ({ meta: [{ title: "Pricing - Tab" }, { name: "description", content: "Compare Tab Free and Pro, including the 30-day Pro trial, Local Suggestion and Deep Complete allowances, monthly and annual billing, and cancellation." }] }),
});
