import { rename, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Polar } from "@polar-sh/sdk";
import { planCapabilities, type BillingInterval } from "@tab/billing";
import { env } from "./env.ts";

const CONFIGURATION_VERSION = "local-first-v1";
const ENV_FILE_URL = new URL("../.dev.vars", import.meta.url);
const LEGACY_RESOURCE_KEYS = [
  "POLAR_AUTOCOMPLETE_METER_ID",
  "POLAR_PRODUCT_ID_FREE",
  "POLAR_CREDITS_BENEFIT_ID_FREE",
  "POLAR_PRODUCT_ID_PRO",
  "POLAR_CREDITS_BENEFIT_ID_PRO",
  "POLAR_PRODUCT_ID_MAX",
  "POLAR_CREDITS_BENEFIT_ID_MAX",
] as const;
const CURRENT_RESOURCE_KEYS = [
  "POLAR_DEEP_COMPLETE_METER_ID",
  "POLAR_CREDITS_BENEFIT_ID_PRO_MONTHLY",
  "POLAR_PRODUCT_ID_PRO_MONTHLY",
  "POLAR_PRODUCT_ID_PRO_ANNUAL",
] as const;

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

function isDeepCompleteBenefit(benefit: Benefit, meterId: string): boolean {
  return (
    benefit.type === "meter_credit" &&
    !benefit.isDeleted &&
    benefit.properties.meterId === meterId &&
    benefit.properties.units === planCapabilities.pro.deepCompletesPerMonth &&
    !benefit.properties.rollover
  );
}

function isProProduct(product: Product, interval: BillingInterval): boolean {
  const expectedPrice =
    (interval === "annual"
      ? planCapabilities.pro.annualPriceUsd
      : planCapabilities.pro.monthlyPriceUsd) * 100;
  return (
    !product.isArchived &&
    product.metadata.planId === "pro" &&
    product.metadata.billingInterval === interval &&
    product.recurringInterval === (interval === "annual" ? "year" : "month") &&
    product.prices.some(
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
    const configured = await polar.meters.get({
      id: env.POLAR_DEEP_COMPLETE_METER_ID,
    });
    if (!isDeepCompleteMeter(configured)) {
      throw new Error(
        "POLAR_DEEP_COMPLETE_METER_ID does not reference the expected Deep Complete meter",
      );
    }
    return configured;
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
      clauses: [
        { property: "name", operator: "eq", value: "deep_complete.used" },
      ],
    },
    aggregation: { func: "sum", property: "creditsSpent" },
    metadata: {
      slug: "deep_complete.used",
      configurationVersion: CONFIGURATION_VERSION,
    },
    ...organizationScope,
  });
}

async function resolveBenefit(meterId: string): Promise<Benefit> {
  const configuredBenefitId =
    env.POLAR_CREDITS_BENEFIT_ID_PRO_MONTHLY ??
    env.POLAR_CREDITS_BENEFIT_ID_PRO;
  if (configuredBenefitId) {
    const configured = await polar.benefits.get({
      id: configuredBenefitId,
    });
    if (isDeepCompleteBenefit(configured, meterId)) return configured;
  }

  const listed = await polar.benefits.list({
    ...organizationScope,
    typeFilter: "meter_credit",
    metadata: { planId: "pro" },
    limit: 100,
  });
  const existing = listed.result.items.find((benefit) =>
    isDeepCompleteBenefit(benefit, meterId),
  );
  if (existing) return existing;

  return polar.benefits.create({
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
      configurationVersion: CONFIGURATION_VERSION,
    },
    ...organizationScope,
  });
}

async function resolveProduct(interval: BillingInterval): Promise<Product> {
  const configuredId =
    interval === "monthly"
      ? env.POLAR_PRODUCT_ID_PRO_MONTHLY
      : env.POLAR_PRODUCT_ID_PRO_ANNUAL;
  if (configuredId) {
    const configured = await polar.products.get({ id: configuredId });
    if (!isProProduct(configured, interval)) {
      throw new Error(
        `Configured Pro ${interval} product does not match the local-first plan`,
      );
    }
    return configured;
  }

  const listed = await polar.products.list({
    ...organizationScope,
    metadata: { planId: "pro", billingInterval: interval },
    isArchived: false,
    isRecurring: true,
    limit: 100,
  });
  const existing = listed.result.items.find((product) =>
    isProProduct(product, interval),
  );
  if (existing) return existing;

  const annual = interval === "annual";
  return polar.products.create({
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
    metadata: {
      planId: "pro",
      billingInterval: interval,
      configurationVersion: CONFIGURATION_VERSION,
    },
    ...organizationScope,
  });
}

async function replaceResourceVariables(values: Record<string, string>): Promise<void> {
  const envPath = fileURLToPath(ENV_FILE_URL);
  const input = await Bun.file(envPath).text();
  const managedKeys = new Set<string>([
    ...LEGACY_RESOURCE_KEYS,
    ...CURRENT_RESOURCE_KEYS,
  ]);
  const replacementLines = CURRENT_RESOURCE_KEYS.map(
    (key) => `${key}=${values[key]}`,
  );
  const lines = input.replaceAll("\r\n", "\n").replace(/\n$/, "").split("\n");
  const output: string[] = [];
  let inserted = false;

  for (const line of lines) {
    const key = /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1];
    if (key && managedKeys.has(key)) {
      if (!inserted) {
        output.push(...replacementLines);
        inserted = true;
      }
      continue;
    }
    output.push(line);
  }

  if (!inserted) {
    if (output.at(-1) !== "") output.push("");
    output.push(...replacementLines);
  }

  const temporaryPath = `${envPath}.tmp-${crypto.randomUUID()}`;
  await Bun.write(temporaryPath, `${output.join("\n")}\n`);
  try {
    await rename(temporaryPath, envPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

const meter = await resolveMeter();
const benefit = await resolveBenefit(meter.id);
const products = Object.fromEntries(
  await Promise.all(
    (["monthly", "annual"] as const).map(async (interval) => {
      const product = await resolveProduct(interval);
      const updated = await polar.products.updateBenefits({
        id: product.id,
        productBenefitsUpdate: {
          benefits: interval === "monthly" ? [benefit.id] : [],
        },
      });
      return [interval, updated] as const;
    }),
  ),
) as Record<BillingInterval, Product>;

if (!isDeepCompleteMeter(meter)) throw new Error("Deep Complete meter verification failed");
if (!isDeepCompleteBenefit(benefit, meter.id)) {
  throw new Error("Pro Deep Complete benefit verification failed");
}
for (const interval of ["monthly", "annual"] as const) {
  const product = products[interval];
  if (
    !isProProduct(product, interval) ||
    product.benefits.some((productBenefit) => productBenefit.id === benefit.id) !==
      (interval === "monthly")
  ) {
    throw new Error(`Pro ${interval} product verification failed`);
  }
}

await replaceResourceVariables({
  POLAR_DEEP_COMPLETE_METER_ID: meter.id,
  POLAR_CREDITS_BENEFIT_ID_PRO_MONTHLY: benefit.id,
  POLAR_PRODUCT_ID_PRO_MONTHLY: products.monthly.id,
  POLAR_PRODUCT_ID_PRO_ANNUAL: products.annual.id,
});

console.log(
  JSON.stringify(
    {
      status: "migrated",
      environment: env.POLAR_SERVER,
      configurationVersion: CONFIGURATION_VERSION,
      resources: {
        deepCompleteMeterId: meter.id,
        proBenefitId: benefit.id,
        proMonthlyProductId: products.monthly.id,
        proAnnualProductId: products.annual.id,
      },
      replacedVariables: LEGACY_RESOURCE_KEYS,
      envFile: fileURLToPath(ENV_FILE_URL),
    },
    null,
    2,
  ),
);
