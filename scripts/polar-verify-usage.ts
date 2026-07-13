import { Polar } from "@polar-sh/sdk";
import { env } from "./env.ts";

const accessToken = env.POLAR_ACCESS_TOKEN;
if (!accessToken) {
  throw new Error("POLAR_ACCESS_TOKEN is required");
}

const meterId = env.POLAR_DEEP_COMPLETE_METER_ID;
if (!meterId) {
  throw new Error("POLAR_DEEP_COMPLETE_METER_ID is required");
}

const productId = env.POLAR_PRODUCT_ID_PRO_MONTHLY;
if (!productId) {
  throw new Error("POLAR_PRODUCT_ID_PRO_MONTHLY is required");
}
const benefitId = env.POLAR_CREDITS_BENEFIT_ID_PRO_MONTHLY;
if (!benefitId) {
  throw new Error("POLAR_CREDITS_BENEFIT_ID_PRO_MONTHLY is required");
}

const polar = new Polar({ accessToken, server: env.POLAR_SERVER });
const organizationScope = env.POLAR_SEND_ORGANIZATION_ID
  ? { organizationId: env.POLAR_ORGANIZATION_ID }
  : {};

const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const externalCustomerId = `tab-polar-usage-${runId}`;
const requestId = `tab-polar-usage-request-${runId}`;
const timestamp = new Date();
const startTimestamp = new Date(timestamp.getTime() - 60_000);
const endTimestamp = new Date(timestamp.getTime() + 60 * 60_000);
const grantedCredits = 300;
const expectedQuantity = 1 - grantedCredits;
const expectedBalance = grantedCredits - 1;

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function getCustomerMeter() {
  const customerMeters = await polar.customerMeters.list({
    externalCustomerId,
    meterId,
    limit: 1,
  });

  return customerMeters.result.items[0];
}

async function getMeterQuantity(): Promise<number> {
  const quantities = await polar.meters.quantities({
    id: meterId,
    externalCustomerId,
    startTimestamp,
    endTimestamp,
    interval: "day",
  });

  return quantities.total;
}

let customerId: string | undefined;

try {
  const [product, benefit] = await Promise.all([
    polar.products.get({ id: productId }),
    polar.benefits.get({ id: benefitId }),
  ]);
  if (!product.benefits.some((item) => item.id === benefitId)) {
    throw new Error("The monthly Pro product does not grant the configured benefit");
  }
  if (
    benefit.type !== "meter_credit" ||
    benefit.properties.meterId !== meterId ||
    benefit.properties.units !== grantedCredits
  ) {
    throw new Error("The configured Pro benefit does not match the Deep Complete meter");
  }

  const customer = await polar.customers.create({
    type: "individual",
    email: `polar-usage+${runId}@cueva.io`,
    externalId: externalCustomerId,
    name: "Tab Polar Usage Verify",
    metadata: { source: "tab-polar-verify-usage" },
    ...organizationScope,
  });
  customerId = customer.id;

  await polar.events.ingest({
    events: [
      {
        name: "deep_complete.used",
        externalCustomerId,
        externalId: `${requestId}-grant`,
        timestamp,
        metadata: {
          requestId: `${requestId}-grant`,
          creditsSpent: -grantedCredits,
        },
        organizationId: env.POLAR_SEND_ORGANIZATION_ID
          ? env.POLAR_ORGANIZATION_ID
          : undefined,
      },
      {
        name: "deep_complete.used",
        externalCustomerId,
        externalId: requestId,
        timestamp,
        metadata: {
          requestId,
          creditsSpent: 1,
        },
        organizationId: env.POLAR_SEND_ORGANIZATION_ID
          ? env.POLAR_ORGANIZATION_ID
          : undefined,
      },
    ],
  });

  let quantity = 0;
  let customerMeter = await getCustomerMeter();

  for (let attempt = 1; attempt <= 12; attempt++) {
    quantity = await getMeterQuantity();
    customerMeter = await getCustomerMeter();

    if (
      quantity === expectedQuantity &&
      customerMeter &&
      customerMeter.balance === expectedBalance
    ) {
      break;
    }

    await delay(2_500);
  }

  if (quantity !== expectedQuantity) {
    throw new Error(
      `Expected Polar meter quantity ${expectedQuantity}, got ${quantity}`,
    );
  }

  if (!customerMeter) {
    throw new Error("Expected Polar customer meter to exist");
  }

  if (customerMeter.balance !== expectedBalance) {
    throw new Error(
      `Expected Polar customer meter balance ${expectedBalance}, got ${customerMeter.balance}`,
    );
  }

  console.log("Polar usage verification passed", {
    externalCustomerId,
    grantedCredits,
    meterQuantity: quantity,
    consumedUnits: customerMeter.consumedUnits,
    creditedUnits: customerMeter.creditedUnits,
    balance: customerMeter.balance,
  });
} finally {
  if (customerId) {
    await polar.customers.delete({ id: customerId, anonymize: true });
  }
}
