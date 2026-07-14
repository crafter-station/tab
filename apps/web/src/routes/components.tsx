import { createFileRoute } from "@tanstack/react-router";
import { ComponentReviewSurface } from "@tab/ui";

export const Route = createFileRoute("/components")({
  component: ComponentReviewSurface,
  head: () => ({ meta: [{ title: "Tab Component Review" }] }),
});
