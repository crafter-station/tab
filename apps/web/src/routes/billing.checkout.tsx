import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./__root.tsx";

function CheckoutPage() {
  return <p>Starting checkout...</p>;
}

export const Route = createRoute({ getParentRoute: () => rootRoute, path: "billing/checkout", component: CheckoutPage });
