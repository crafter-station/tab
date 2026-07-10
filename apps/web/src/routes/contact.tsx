import { createRoute } from "@tanstack/react-router";
import { ContactPage } from "../components/pages/information.tsx";
import { rootRoute } from "./__root.tsx";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "contact",
  component: ContactPage,
  head: () => ({ meta: [{ title: "Contact Tab" }, { name: "description", content: "Contact Tab for setup, privacy, billing, account help, or technical product feedback." }] }),
});
