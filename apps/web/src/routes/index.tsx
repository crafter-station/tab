import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "../components/pages/marketing.tsx";

export const Route = createFileRoute("/")({
  component: HomePage,
  head: () => ({ meta: [{ title: "Tab - Native autocomplete for your Mac" }, { name: "description", content: "Private Local Suggestions as you type, explicit Deep Complete for harder writing, and autocomplete across the Mac apps where you already work." }] }),
});
