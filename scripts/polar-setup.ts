import { Polar } from "@polar-sh/sdk";
import type { ProductCreateRecurringPrices } from "@polar-sh/sdk/models/components/productcreaterecurring.js";
import { planQuotas, type PlanId } from "@tab/billing";
import { env } from "./env.ts";

const accessToken = env.POLAR_ACCESS_TOKEN;
if (!accessToken) {
  throw new Error("POLAR_ACCESS_TOKEN is required");
}

const server = env.POLAR_SERVER;
const organizationId = env.POLAR_ORGANIZATION_ID;
const autocompleteMeterId = env.POLAR_AUTOCOMPLETE_METER_ID;

const polar = new Polar({ accessToken, server });

const autocompleteMeterConfig = {
  name: "Autocomplete credits spent",
  unit: "custom" as const,
  customLabel: "credit",
  filter: {
    conjunction: "and" as const,
    clauses: [
      { property: "name", operator: "eq" as const, value: "autocomplete.used" },
    ],
  },
  aggregation: { func: "sum" as const, property: "creditsSpent" },
  metadata: { slug: "autocomplete.used" },
};

function organizationScope(): { organizationId?: string } {
  return env.POLAR_SEND_ORGANIZATION_ID ? { organizationId } : {};
}

type CreatedResource = {
  readonly id?: string;
  readonly name?: string;
  readonly secret?: string;
};

function existingBenefitId(planId: PlanId): string | undefined {
  switch (planId) {
    case "free":
      return env.POLAR_CREDITS_BENEFIT_ID_FREE;
    case "pro":
      return env.POLAR_CREDITS_BENEFIT_ID_PRO;
    case "max":
      return env.POLAR_CREDITS_BENEFIT_ID_MAX;
  }
}

function existingProductId(planId: PlanId): string | undefined {
  switch (planId) {
    case "free":
      return env.POLAR_PRODUCT_ID_FREE;
    case "pro":
      return env.POLAR_PRODUCT_ID_PRO;
    case "max":
      return env.POLAR_PRODUCT_ID_MAX;
  }
}

function unwrapResource<T extends CreatedResource>(result: unknown, key: string): T {
  const record = result as Record<string, unknown>;
  return (record[key] ?? result) as T;
}

async function createAutocompleteMeter(): Promise<CreatedResource> {
  if (autocompleteMeterId) {
    return await polar.meters.get({ id: autocompleteMeterId });
  }

  const result = await polar.meters.create({
    ...autocompleteMeterConfig,
    ...organizationScope(),
  });

  return unwrapResource<CreatedResource>(result, "meter");
}

async function createPlanCreditsBenefit(
  planId: PlanId,
  meterId: string,
): Promise<CreatedResource> {
  const benefitId = existingBenefitId(planId);
  if (benefitId) {
    return await polar.benefits.get({ id: benefitId });
  }

  const plan = planQuotas[planId];
  const result = await polar.benefits.create({
    type: "meter_credit",
    description: `${plan.monthlyAutocompleteSuggestions.toLocaleString()} autocomplete credits/mo`,
    properties: {
      units: plan.monthlyAutocompleteSuggestions,
      rollover: false,
      meterId,
    },
    metadata: {
      planId,
      monthlyAutocompleteCredits: plan.monthlyAutocompleteSuggestions,
    },
    ...organizationScope(),
  });

  return unwrapResource<CreatedResource>(result, "benefit");
}

function createPlanPrices(
  planId: PlanId,
  meterId: string,
): ProductCreateRecurringPrices[] {
  const plan = planQuotas[planId];

  return [
    {
      amountType: "fixed",
      priceCurrency: "usd",
      priceAmount: plan.monthlyPriceUsd * 100,
    },
    {
      amountType: "metered_unit",
      priceCurrency: "usd",
      meterId,
      unitAmount: "0.000001",
      capAmount: 0,
    },
  ];
}

async function createPlanProduct(
  planId: PlanId,
  meterId: string,
): Promise<CreatedResource> {
  const productId = existingProductId(planId);
  if (productId) {
    return await polar.products.get({ id: productId });
  }

  const plan = planQuotas[planId];

  const result = await polar.products.create({
    name: `Tab ${plan.name}`,
    description: `${plan.monthlyAutocompleteSuggestions.toLocaleString()} autocomplete suggestions per month.`,
    prices: createPlanPrices(planId, meterId),
    recurringInterval: "month",
    metadata: {
      planId,
      monthlyAutocompleteSuggestions: plan.monthlyAutocompleteSuggestions,
    },
    ...organizationScope(),
  });

  return unwrapResource<CreatedResource>(result, "product");
}

async function attachBenefitToProduct(productId: string, benefitId: string): Promise<void> {
  await polar.products.updateBenefits({
    id: productId,
    productBenefitsUpdate: { benefits: [benefitId] },
  });
}

async function createWebhookEndpoint(url: string): Promise<CreatedResource> {
  const result = await polar.webhooks.createWebhookEndpoint({
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
    ...organizationScope(),
  });

  return unwrapResource<CreatedResource>(result, "webhookEndpoint");
}

const meter = await createAutocompleteMeter();
console.log(`POLAR_AUTOCOMPLETE_METER_ID=${meter.id ?? "<unknown>"}`);

if (!meter.id) {
  throw new Error("Polar meter creation did not return an id");
}

for (const planId of Object.keys(planQuotas) as PlanId[]) {
  const benefit = await createPlanCreditsBenefit(planId, meter.id);
  const product = await createPlanProduct(planId, meter.id);
  if (!benefit.id) {
    throw new Error(`Polar ${planId} credits benefit creation did not return an id`);
  }
  if (!product.id) {
    throw new Error(`Polar ${planId} product creation did not return an id`);
  }
  await attachBenefitToProduct(product.id, benefit.id);
  console.log(`POLAR_PRODUCT_ID_${planId.toUpperCase()}=${product.id ?? "<unknown>"}`);
  console.log(`POLAR_CREDITS_BENEFIT_ID_${planId.toUpperCase()}=${benefit.id}`);
}

if (env.POLAR_WEBHOOK_URL) {
  const endpoint = await createWebhookEndpoint(env.POLAR_WEBHOOK_URL);
  console.log(`POLAR_WEBHOOK_ENDPOINT_ID=${endpoint.id ?? "<unknown>"}`);
  console.log(`POLAR_WEBHOOK_SECRET=${endpoint.secret ?? "<copy from Polar dashboard>"}`);
} else {
  console.log("Set POLAR_WEBHOOK_URL to create the Polar webhook endpoint.");
}
