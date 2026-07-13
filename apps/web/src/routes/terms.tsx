import { createRoute } from "@tanstack/react-router";
import { TermsPage } from "../components/pages/information.tsx";
import { rootRoute } from "./__root.tsx";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "terms",
  component: TermsPage,
  head: () => ({ meta: [{ title: "Terms of Service - Tab" }, { name: "description", content: "Terms governing Tab Free and Pro, the 30-day trial, billing, renewal, cancellation, and use of the native macOS app." }] }),
});
