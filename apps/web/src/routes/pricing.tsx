import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { PricingPage } from "../components/pages/marketing.tsx";

const rootApi = getRouteApi("__root__");

function PricingRoute() {
  const { viewer } = rootApi.useLoaderData();
  return <PricingPage authenticated={Boolean(viewer)} />;
}

export const Route = createFileRoute("/pricing")({
  component: PricingRoute,
  head: () => ({ meta: [{ title: "Pricing - Tab" }, { name: "description", content: "Compare Tab Free, Pro, and Max plans. Paid plans include one month free." }] }),
});
