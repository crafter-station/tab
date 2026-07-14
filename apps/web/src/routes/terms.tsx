import { createFileRoute } from "@tanstack/react-router";
import { TermsPage } from "../components/pages/information.tsx";

export const Route = createFileRoute("/terms")({
  component: TermsPage,
  head: () => ({ meta: [{ title: "Terms of Service - Tab" }, { name: "description", content: "Terms governing Tab Free, Pro, and Max, paid-plan trials, billing, renewal, cancellation, and use of the native macOS app." }] }),
});
