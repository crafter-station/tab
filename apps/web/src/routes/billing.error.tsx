import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { MessagePage } from "../components/pages/shared.tsx";

function BillingErrorPage() {
  const { code } = Route.useSearch();
  const message = code === "portal"
    ? "Could not open billing portal. Please try again."
    : code === "plan_change"
      ? "Your plan change needs to be completed in billing settings."
      : "Could not update billing. Manage billing or try again later.";
  return <MessagePage title="Billing error" message={message} action={{ href: "/billing/portal", label: "Manage billing" }} />;
}

export const Route = createFileRoute("/billing/error")({
  validateSearch: z.object({ code: z.enum(["billing", "portal", "plan_change"]).catch("billing") }),
  component: BillingErrorPage,
});
