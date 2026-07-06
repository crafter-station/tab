import { planQuotas } from "@tabb/billing";

export const webAppBoundary = {
  runtime: "tanstack-start",
  owns: [
    "marketing and download surface",
    "pricing and account management",
    "Personal Memory control plane",
    "device management",
  ],
} as const;

export const pricingPlans = planQuotas;
