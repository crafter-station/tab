import { createFileRoute } from "@tanstack/react-router";
import { ContactPage } from "../components/pages/information.tsx";

export const Route = createFileRoute("/contact")({
  component: ContactPage,
  head: () => ({ meta: [{ title: "Contact Tab" }, { name: "description", content: "Contact Tab for setup, privacy, billing, account help, or technical product feedback." }] }),
});
