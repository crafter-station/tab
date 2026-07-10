import { createRoute } from "@tanstack/react-router";
import { MessagePage } from "../components/pages/shared.tsx";
import { rootRoute } from "./__root.tsx";

function CheckoutPage() {
  return <MessagePage title="Opening checkout" message="Taking you to checkout..." />;
}

export const Route = createRoute({ getParentRoute: () => rootRoute, path: "billing/checkout", component: CheckoutPage });
