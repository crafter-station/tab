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
    expect(body).toInclude("Local Suggestions and Deep Completes for occasional writing.");
    expect(body).toInclude("Unlimited Local Suggestions, more Deep Completes, and automatic Personal Memory.");
    expect(body).toInclude("Everything in Pro");
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
    expect(marketingSource).toInclude("Payment details required. Cancel anytime.");
    expect(marketingSource).toInclude("Change or cancel anytime");
  });

  it("keeps paid trial terms visible without a disclosure", () => {
    expect(marketingSource).toInclude("Before you start a paid trial.");
    expect(marketingSource).toInclude("Your memory stays yours");
    expect(marketingSource).not.toInclude("Trial, renewal, and cancellation details");
  });
});
