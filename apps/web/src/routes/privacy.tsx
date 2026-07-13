import { createRoute } from "@tanstack/react-router";
import { PrivacyPage } from "../components/pages/information.tsx";
import { rootRoute } from "./__root.tsx";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "privacy",
  component: PrivacyPage,
  head: () => ({ meta: [{ title: "Privacy Policy - Tab" }, { name: "description", content: "How Tab keeps Automatic Suggestions local and processes explicit Deep Complete requests, Personal Memory, telemetry, account, device, and billing data." }] }),
});
