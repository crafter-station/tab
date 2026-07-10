import { createRoute } from "@tanstack/react-router";
import { TermsPage } from "../components/pages/information.tsx";
import { rootRoute } from "./__root.tsx";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "terms",
  component: TermsPage,
  head: () => ({ meta: [{ title: "Terms of Service - Tab" }, { name: "description", content: "Terms governing the Tab website, native macOS app, account dashboard, and paid plans." }] }),
});
