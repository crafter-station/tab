import { Polar } from "@polar-sh/sdk";
import { planCapabilities, type PaidPlanId } from "@tab/billing";
import { env } from "./env.ts";
import { getPolarEnvFile, updatePolarEnvFile } from "./polar-env-file.ts";

const CONFIGURATION_VERSION = "monthly-pro-max-v1";
const envFile = getPolarEnvFile();
const polar = new Polar({
  accessToken: env.POLAR_ACCESS_TOKEN,
  server: env.POLAR_SERVER,
});
const organizationScope = env.POLAR_SEND_ORGANIZATION_ID
  ? { organizationId: env.POLAR_ORGANIZATION_ID }
  : {};

type Meter = Awaited<ReturnType<typeof polar.meters.get>>;
type Benefit = Awaited<ReturnType<typeof polar.benefits.get>>;
type Product = Awaited<ReturnType<typeof polar.products.get>>;

const paidPlans = ["pro", "max"] as const satisfies readonly PaidPlanId[];

function configuredBenefitId(planId: PaidPlanId): string | undefined {
  return planId === "pro"
    ? env.POLAR_CREDITS_BENEFIT_ID_PRO_MONTHLY
    : env.POLAR_CREDITS_BENEFIT_ID_MAX_MONTHLY;
}

function configuredProductId(planId: PaidPlanId): string | undefined {
  return planId === "pro"
    ? env.POLAR_PRODUCT_ID_PRO_MONTHLY
    : env.POLAR_PRODUCT_ID_MAX_MONTHLY;
}

function filterIncludesDeepComplete(filter: Meter["filter"]): boolean {
  return filter.clauses.some((clause) =>
    "clauses" in clause
      ? filterIncludesDeepComplete(clause)
      : clause.property === "name" &&
        clause.operator === "eq" &&
        clause.value === "deep_complete.used",
  );
}

function isDeepCompleteMeter(meter: Meter): boolean {
  return (
    !meter.archivedAt &&
    meter.metadata.slug === "deep_complete.used" &&
    meter.aggregation.func === "sum" &&
    "property" in meter.aggregation &&
    meter.aggregation.property === "creditsSpent" &&
    filterIncludesDeepComplete(meter.filter)
  );
}

function isPlanBenefit(
  benefit: Benefit,
  planId: PaidPlanId,
  meterId: string,
): boolean {
  return (
    benefit.type === "meter_credit" &&
    !benefit.isDeleted &&
    benefit.metadata.planId === planId &&
    benefit.properties.meterId === meterId &&
    benefit.properties.units === planCapabilities[planId].deepCompletesPerMonth &&
    !benefit.properties.rollover
  );
}

function isPlanProduct(product: Product, planId: PaidPlanId): boolean {
  const expectedPrice = planCapabilities[planId].monthlyPriceUsd * 100;
  const activePrices = product.prices.filter((price) => !price.isArchived);
  return (
    !product.isArchived &&
    product.metadata.planId === planId &&
    product.metadata.billingInterval === "monthly" &&
    product.recurringInterval === "month" &&
    activePrices.length === 1 &&
    activePrices.some(
      (price) =>
        price.amountType === "fixed" &&
        !price.isArchived &&
        price.priceCurrency === "usd" &&
        price.priceAmount === expectedPrice,
    )
  );
}

async function resolveMeter(): Promise<Meter> {
  if (env.POLAR_DEEP_COMPLETE_METER_ID) {
    const meter = await polar.meters.get({ id: env.POLAR_DEEP_COMPLETE_METER_ID });
    if (!isDeepCompleteMeter(meter)) {
      throw new Error("Configured Deep Complete meter has an unexpected shape");
    }
    return meter;
  }
  const listed = await polar.meters.list({
    ...organizationScope,
    metadata: { slug: "deep_complete.used" },
    isArchived: false,
    limit: 100,
  });
  const existing = listed.result.items.find(isDeepCompleteMeter);
  if (existing) return existing;
  return polar.meters.create({
    name: "Successful Deep Completes",
    unit: "custom",
    customLabel: "Deep Complete",
    filter: {
      conjunction: "and",
      clauses: [{ property: "name", operator: "eq", value: "deep_complete.used" }],
    },
    aggregation: { func: "sum", property: "creditsSpent" },
    metadata: { slug: "deep_complete.used", configurationVersion: CONFIGURATION_VERSION },
    ...organizationScope,
  });
}

async function resolveBenefit(planId: PaidPlanId, meterId: string): Promise<Benefit> {
  const configuredId = configuredBenefitId(planId);
  if (configuredId) {
    const benefit = await polar.benefits.get({ id: configuredId });
    if (!isPlanBenefit(benefit, planId, meterId)) {
      throw new Error(`Configured ${planId} benefit has an unexpected shape`);
    }
    return benefit;
  }
  const listed = await polar.benefits.list({
    ...organizationScope,
    typeFilter: "meter_credit",
    metadata: { planId },
    limit: 100,
  });
  const existing = listed.result.items.find((benefit) =>
    isPlanBenefit(benefit, planId, meterId),
  );
  if (existing) return existing;
  const units = planCapabilities[planId].deepCompletesPerMonth;
  return polar.benefits.create({
    type: "meter_credit",
    description: `${units.toLocaleString()} Deep Completes/mo`,
    properties: { units, rollover: false, meterId },
    metadata: { planId, deepCompletesPerMonth: units, configurationVersion: CONFIGURATION_VERSION },
    ...organizationScope,
  });
}

async function resolveProduct(planId: PaidPlanId): Promise<Product> {
  const configuredId = configuredProductId(planId);
  if (configuredId) {
    const product = await polar.products.get({ id: configuredId });
    if (!isPlanProduct(product, planId)) {
      throw new Error(`Configured ${planId} product has an unexpected shape`);
    }
    return product;
  }
  const listed = await polar.products.list({
    ...organizationScope,
    metadata: { planId, billingInterval: "monthly" },
    isArchived: false,
    isRecurring: true,
    limit: 100,
  });
  const existing = listed.result.items.find((product) => isPlanProduct(product, planId));
  if (existing) return existing;
  const plan = planCapabilities[planId];
  return polar.products.create({
    name: `Tab ${plan.name} Monthly`,
    description: `Unlimited Local Accepted Words, ${plan.deepCompletesPerMonth.toLocaleString()} Deep Completes per month, continuous Memory Extraction, and up to three personal Macs.`,
    prices: [{
      amountType: "fixed",
      priceCurrency: "usd",
      priceAmount: plan.monthlyPriceUsd * 100,
    }],
    recurringInterval: "month",
    metadata: { planId, billingInterval: "monthly", configurationVersion: CONFIGURATION_VERSION },
    ...organizationScope,
  });
}

const organization = await polar.organizations.get({ id: env.POLAR_ORGANIZATION_ID });
if (organization.status !== "active") {
  console.warn(
    `Polar organization is ${organization.status}; resources will be created, but checkout will remain unavailable until activation.`,
  );
}
if (!organization.capabilities.apiAccess) {
  throw new Error("Polar organization is missing API access");
}

const meter = await resolveMeter();
const resources = {} as Record<
  PaidPlanId,
  { benefit: Benefit; product: Product }
>;
for (const planId of paidPlans) {
  const benefit = await resolveBenefit(planId, meter.id);
  const product = await resolveProduct(planId);
  const updated = await polar.products.updateBenefits({
    id: product.id,
    productBenefitsUpdate: { benefits: [benefit.id] },
  });
  if (!isPlanBenefit(benefit, planId, meter.id) || !isPlanProduct(updated, planId)) {
    throw new Error(`${planId} Polar resource verification failed`);
  }
  if (!updated.benefits.some((item) => item.id === benefit.id)) {
    throw new Error(`${planId} product does not grant its configured benefit`);
  }
  resources[planId] = { benefit, product: updated };
}

await updatePolarEnvFile(envFile, {
  POLAR_DEEP_COMPLETE_METER_ID: meter.id,
  POLAR_CREDITS_BENEFIT_ID_PRO_MONTHLY: resources.pro.benefit.id,
  POLAR_PRODUCT_ID_PRO_MONTHLY: resources.pro.product.id,
  POLAR_CREDITS_BENEFIT_ID_MAX_MONTHLY: resources.max.benefit.id,
  POLAR_PRODUCT_ID_MAX_MONTHLY: resources.max.product.id,
});

console.log(JSON.stringify({
  status: "configured",
  environment: env.POLAR_SERVER,
  organizationId: organization.id,
  configurationVersion: CONFIGURATION_VERSION,
  resources: {
    deepCompleteMeterId: meter.id,
    proBenefitId: resources.pro.benefit.id,
    proProductId: resources.pro.product.id,
    maxBenefitId: resources.max.benefit.id,
    maxProductId: resources.max.product.id,
  },
  envFile,
}, null, 2));
