import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const marketingSource = readFileSync(new URL("../apps/web/src/components/pages/marketing.tsx", import.meta.url), "utf8");
const pricingSource = readFileSync(new URL("../apps/web/src/components/pricing/pricing-plan-card.tsx", import.meta.url), "utf8");

describe("pricing plan composition", () => {
  it("preserves plan content and native monthly checkout forms", () => {
    const body = marketingSource;

    expect(body).toInclude('name: "Free"');
    expect(body).toInclude('name: "Pro"');
    expect(body).toInclude('name: "Max"');
    expect(body).toInclude("Private local help and occasional Deep Complete for lighter writing.");
    expect(body).toInclude("Unlimited local writing, more Deep Complete, and continuous personalization.");
    expect(body).toInclude("The same complete toolkit as Pro, with more Deep Complete capacity.");
    expect(body).toInclude("formatCount(max.deepCompletesPerMonth)");
    expect(body).toInclude("formatMonthlyPrice(max.monthlyPriceUsd)");
    expect(pricingSource).toInclude('<form action="/billing/checkout" method="get"');
    expect(pricingSource).toInclude('<input type="hidden" name="plan" value={plan.action.plan}');
    expect(body).toInclude('plan: "pro"');
    expect(body).toInclude('plan: "max"');
    expect(pricingSource).not.toInclude('name="interval"');
    expect(pricingSource).toInclude("CardHeader");
    expect(pricingSource).toInclude("CardContent");
    expect(pricingSource).toInclude("CardFooter");
    expect(pricingSource).toInclude("Badge");
    expect(pricingSource).toInclude("Button");
  });

  it("preserves signed-in and signed-out action destinations", () => {
    expect(marketingSource).toInclude('authenticated ? "#paid-plans" : "/signup"');
    expect(marketingSource).toInclude('authenticated ? "/dashboard" : "/signup"');
    expect(marketingSource).toInclude("Sign in, then continue to secure checkout.");
    expect(marketingSource).toInclude("Free accounts continue to checkout. Plan changes open in Polar.");
    expect(marketingSource).toInclude("Change plans, inspect usage, or cancel");
  });
});
