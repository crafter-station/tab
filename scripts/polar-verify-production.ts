import { Polar } from "@polar-sh/sdk";
import { planCapabilities, type PaidPlanId } from "@tab/billing";
import { env } from "./env.ts";
import { getPolarEnvFile } from "./polar-env-file.ts";

getPolarEnvFile();
if (env.POLAR_SERVER !== "production") {
  throw new Error("Production verification requires POLAR_SERVER=production");
}

const required = {
  meterId: env.POLAR_DEEP_COMPLETE_METER_ID,
  proBenefitId: env.POLAR_CREDITS_BENEFIT_ID_PRO_MONTHLY,
  proProductId: env.POLAR_PRODUCT_ID_PRO_MONTHLY,
  maxBenefitId: env.POLAR_CREDITS_BENEFIT_ID_MAX_MONTHLY,
  maxProductId: env.POLAR_PRODUCT_ID_MAX_MONTHLY,
  webhookUrl: env.POLAR_WEBHOOK_URL,
  webhookSecret: env.POLAR_WEBHOOK_SECRET,
};
for (const [key, value] of Object.entries(required)) {
  if (!value) throw new Error(`Missing production Polar value: ${key}`);
}

const polar = new Polar({ accessToken: env.POLAR_ACCESS_TOKEN, server: env.POLAR_SERVER });
const organization = await polar.organizations.get({ id: env.POLAR_ORGANIZATION_ID });
const readinessIssues: string[] = [];
if (organization.status !== "active") {
  readinessIssues.push(`organization status is ${organization.status}`);
}
if (
  !organization.capabilities.apiAccess ||
  !organization.capabilities.checkoutPayments ||
  !organization.capabilities.subscriptionRenewals
) {
  readinessIssues.push("checkout or subscription renewal capabilities are disabled");
}

const meterId = required.meterId as string;
const meter = await polar.meters.get({ id: meterId });
const meterSelectsDeepCompletes = meter.filter.clauses.some((clause) =>
  !("clauses" in clause) &&
  clause.property === "name" &&
  clause.operator === "eq" &&
  clause.value === "deep_complete.used"
);
if (
  meter.archivedAt ||
  meter.metadata.slug !== "deep_complete.used" ||
  meter.aggregation.func !== "sum" ||
  !("property" in meter.aggregation) ||
  meter.aggregation.property !== "creditsSpent" ||
  !meterSelectsDeepCompletes
) {
  throw new Error("Deep Complete meter verification failed");
}

const planIds = ["pro", "max"] as const satisfies readonly PaidPlanId[];
for (const planId of planIds) {
  const benefitId = required[`${planId}BenefitId`];
  const productId = required[`${planId}ProductId`];
  const [benefit, product] = await Promise.all([
    polar.benefits.get({ id: benefitId as string }),
    polar.products.get({ id: productId as string }),
  ]);
  const plan = planCapabilities[planId];
  const activePrices = product.prices.filter((price) => !price.isArchived);
  if (
    benefit.type !== "meter_credit" ||
    benefit.isDeleted ||
    benefit.properties.meterId !== meterId ||
    benefit.properties.units !== plan.deepCompletesPerMonth ||
    benefit.properties.rollover
  ) {
    throw new Error(`${plan.name} benefit verification failed`);
  }
  if (
    product.isArchived ||
    product.metadata.planId !== planId ||
    product.metadata.billingInterval !== "monthly" ||
    product.recurringInterval !== "month" ||
    activePrices.length !== 1 ||
    !activePrices.some((price) =>
      price.amountType === "fixed" &&
      !price.isArchived &&
      price.priceCurrency === "usd" &&
      price.priceAmount === plan.monthlyPriceUsd * 100
    ) ||
    !product.benefits.some((item) => item.id === benefit.id)
  ) {
    throw new Error(`${plan.name} product verification failed`);
  }
}

const endpoints = await polar.webhooks.listWebhookEndpoints({ limit: 100 });
const endpoint = endpoints.result.items.find((item) => item.url === required.webhookUrl);
const expectedEvents = new Set([
  "subscription.created",
  "subscription.updated",
  "subscription.active",
  "subscription.canceled",
  "subscription.uncanceled",
  "subscription.revoked",
  "subscription.past_due",
]);
if (
  !endpoint ||
  endpoint.secret !== required.webhookSecret ||
  !endpoint.enabled ||
  endpoint.format !== "raw" ||
  expectedEvents.size !== endpoint.events.length ||
  endpoint.events.some((event) => !expectedEvents.has(event))
) {
  throw new Error("Polar webhook endpoint verification failed");
}

console.log(JSON.stringify({
  status: readinessIssues.length === 0 ? "verified" : "resources_verified",
  checkoutReady: readinessIssues.length === 0,
  readinessIssues,
  environment: env.POLAR_SERVER,
  organizationId: organization.id,
  meterId,
  products: planIds.map((planId) => ({
    planId,
    productId: required[`${planId}ProductId`],
    benefitId: required[`${planId}BenefitId`],
  })),
  webhookEndpointId: endpoint.id,
}, null, 2));

if (readinessIssues.length > 0) {
  throw new Error("Polar resources are valid, but the organization is not checkout-ready");
}
