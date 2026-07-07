import { Polar } from "@polar-sh/sdk";
import { planQuotas, type PlanId } from "@tabb/billing";
import { env } from "./env.ts";

const accessToken = env.POLAR_ACCESS_TOKEN;
if (!accessToken) {
  throw new Error("POLAR_ACCESS_TOKEN is required");
}

const server = env.POLAR_SERVER;
const organizationId = env.POLAR_ORGANIZATION_ID;
const shouldSendOrganizationId = env.POLAR_SEND_ORGANIZATION_ID === "true";

const polar = new Polar({ accessToken, server });

if (organizationId && !shouldSendOrganizationId) {
  console.warn(
    "POLAR_ORGANIZATION_ID is set but will be omitted. Polar organization tokens reject organizationId in create requests.",
  );
}

function organizationScope(): { organizationId?: string } {
  return shouldSendOrganizationId && organizationId ? { organizationId } : {};
}

type CreatedResource = {
  readonly id?: string;
  readonly name?: string;
};

function unwrapResource<T extends CreatedResource>(result: unknown, key: string): T {
  const record = result as Record<string, unknown>;
  return (record[key] ?? result) as T;
}

async function createAutocompleteMeter(): Promise<CreatedResource> {
  const result = await polar.meters.create({
    name: "Autocomplete suggestions",
    unit: "custom",
    customLabel: "suggestion",
    filter: {
      conjunction: "and",
      clauses: [{ property: "name", operator: "eq", value: "autocomplete.used" }],
    },
    aggregation: { func: "count" },
    metadata: { slug: "autocomplete.used" },
    ...organizationScope(),
  });

  return unwrapResource<CreatedResource>(result, "meter");
}

async function createPlanProduct(planId: PlanId): Promise<CreatedResource> {
  const plan = planQuotas[planId];
  const prices =
    plan.monthlyPriceUsd === 0
      ? [{ amountType: "free" }]
      : [
          {
            amountType: "fixed",
            priceCurrency: "usd",
            priceAmount: plan.monthlyPriceUsd * 100,
          },
        ];

  const result = await polar.products.create({
    name: `Tabb ${plan.name}`,
    description: `${plan.monthlyAutocompleteSuggestions.toLocaleString()} autocomplete suggestions per month.`,
    prices,
    recurringInterval: "month",
    metadata: {
      planId,
      monthlyAutocompleteSuggestions: plan.monthlyAutocompleteSuggestions,
    },
    ...organizationScope(),
  });

  return unwrapResource<CreatedResource>(result, "product");
}

const meter = await createAutocompleteMeter();
console.log(`POLAR_AUTOCOMPLETE_METER_ID=${meter.id ?? "<unknown>"}`);

for (const planId of Object.keys(planQuotas) as PlanId[]) {
  const product = await createPlanProduct(planId);
  console.log(`POLAR_PRODUCT_ID_${planId.toUpperCase()}=${product.id ?? "<unknown>"}`);
}
