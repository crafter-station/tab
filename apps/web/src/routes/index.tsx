import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "../components/pages/marketing.tsx";

export const Route = createFileRoute("/")({
  component: HomePage,
  head: () => ({ meta: [{ title: "Tab - Native autocomplete for your Mac" }, { name: "description", content: "Private suggestions and deeper help across the Mac apps where you write." }] }),
});
