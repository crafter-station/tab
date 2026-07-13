import { Polar } from "@polar-sh/sdk";
import { planCapabilities, type BillingInterval } from "@tab/billing";
import { env } from "./env.ts";

const polar = new Polar({
  accessToken: env.POLAR_ACCESS_TOKEN,
  server: env.POLAR_SERVER,
});
const organizationScope = env.POLAR_SEND_ORGANIZATION_ID
  ? { organizationId: env.POLAR_ORGANIZATION_ID }
  : {};

type Resource = { id?: string; secret?: string };

function unwrap<T extends Resource>(value: unknown, key: string): T {
  const record = value as Record<string, unknown>;
  return (record[key] ?? value) as T;
}

async function getOrCreateMeter(): Promise<Resource> {
  const existing = env.POLAR_DEEP_COMPLETE_METER_ID;
  if (existing) return polar.meters.get({ id: existing });
  return unwrap<Resource>(
    await polar.meters.create({
      name: "Successful Deep Completes",
      unit: "custom",
      customLabel: "Deep Complete",
      filter: {
        conjunction: "and",
        clauses: [
          { property: "name", operator: "eq", value: "deep_complete.used" },
        ],
      },
      aggregation: { func: "sum", property: "creditsSpent" },
      metadata: { slug: "deep_complete.used" },
      ...organizationScope,
    }),
    "meter",
  );
}

async function getOrCreateBenefit(meterId: string): Promise<Resource> {
  const existing = env.POLAR_CREDITS_BENEFIT_ID_PRO_MONTHLY;
  if (existing) {
    return polar.benefits.get({ id: existing });
  }
  return unwrap<Resource>(
    await polar.benefits.create({
      type: "meter_credit",
      description: `${planCapabilities.pro.deepCompletesPerMonth} Deep Completes/mo`,
      properties: {
        units: planCapabilities.pro.deepCompletesPerMonth,
        rollover: false,
        meterId,
      },
      metadata: {
        planId: "pro",
        deepCompletesPerMonth: planCapabilities.pro.deepCompletesPerMonth,
      },
      ...organizationScope,
    }),
    "benefit",
  );
}

async function getOrCreateProduct(
  interval: BillingInterval,
): Promise<Resource> {
  const existing =
    interval === "monthly"
      ? env.POLAR_PRODUCT_ID_PRO_MONTHLY
      : env.POLAR_PRODUCT_ID_PRO_ANNUAL;
  if (existing) return polar.products.get({ id: existing });
  const annual = interval === "annual";
  return unwrap<Resource>(
    await polar.products.create({
      name: `Tab Pro ${annual ? "Annual" : "Monthly"}`,
      description:
        "Unlimited Local Accepted Words, 300 Deep Completes per month, continuous Memory Extraction, and up to three personal Macs.",
      prices: [
        {
          amountType: "fixed",
          priceCurrency: "usd",
          priceAmount:
            (annual
              ? planCapabilities.pro.annualPriceUsd
              : planCapabilities.pro.monthlyPriceUsd) * 100,
        },
      ],
      recurringInterval: annual ? "year" : "month",
      metadata: { planId: "pro", billingInterval: interval },
      ...organizationScope,
    }),
    "product",
  );
}

async function createWebhookEndpoint(url: string): Promise<Resource> {
  return unwrap<Resource>(
    await polar.webhooks.createWebhookEndpoint({
      url,
      name: "Tab billing sync",
      format: "raw",
      events: [
        "subscription.created",
        "subscription.updated",
        "subscription.active",
        "subscription.canceled",
        "subscription.uncanceled",
        "subscription.revoked",
        "subscription.past_due",
      ],
      ...organizationScope,
    }),
    "webhookEndpoint",
  );
}

const meter = await getOrCreateMeter();
if (!meter.id) throw new Error("Polar meter creation did not return an id");
const benefit = await getOrCreateBenefit(meter.id);
if (!benefit.id) throw new Error("Polar Pro benefit creation did not return an id");

console.log(`POLAR_DEEP_COMPLETE_METER_ID=${meter.id}`);
console.log(`POLAR_CREDITS_BENEFIT_ID_PRO_MONTHLY=${benefit.id}`);

for (const interval of ["monthly", "annual"] as const) {
  const product = await getOrCreateProduct(interval);
  if (!product.id) throw new Error(`Polar Pro ${interval} product has no id`);
  await polar.products.updateBenefits({
    id: product.id,
    productBenefitsUpdate: {
      benefits: interval === "monthly" ? [benefit.id] : [],
    },
  });
  console.log(
    `POLAR_PRODUCT_ID_PRO_${interval.toUpperCase()}=${product.id}`,
  );
}

if (env.POLAR_WEBHOOK_URL) {
  const endpoint = await createWebhookEndpoint(env.POLAR_WEBHOOK_URL);
  console.log(`POLAR_WEBHOOK_ENDPOINT_ID=${endpoint.id ?? "<unknown>"}`);
  console.log(
    `POLAR_WEBHOOK_SECRET=${endpoint.secret ?? "<copy from Polar dashboard>"}`,
  );
} else {
  console.log("Set POLAR_WEBHOOK_URL to create the Polar webhook endpoint.");
}
