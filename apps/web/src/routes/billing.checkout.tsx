import { createRoute } from "@tanstack/react-router";
import { MessagePage } from "../components/web-pages.tsx";
import { rootRoute } from "./__root.tsx";

function CheckoutPage() {
  return <MessagePage title="Starting checkout" message="Redirecting you to checkout..." />;
}

export const Route = createRoute({ getParentRoute: () => rootRoute, path: "billing/checkout", component: CheckoutPage });
