import { createRoute } from "@tanstack/react-router";
import { AboutPage } from "../components/pages/information.tsx";
import { rootRoute } from "./__root.tsx";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "about",
  component: AboutPage,
  head: () => ({ meta: [{ title: "About Tab - Native autocomplete for macOS" }, { name: "description", content: "Why Tab brings deliberate, controllable autocomplete to the Mac apps where you already write." }] }),
});
