import { Polar } from "@polar-sh/sdk";
import { env } from "./env.ts";

const accessToken = env.POLAR_ACCESS_TOKEN;
if (!accessToken) {
  throw new Error("POLAR_ACCESS_TOKEN is required");
}

const meterId = env.POLAR_AUTOCOMPLETE_METER_ID;
if (!meterId) {
  throw new Error("POLAR_AUTOCOMPLETE_METER_ID is required");
}

const productId = env.POLAR_PRODUCT_ID_FREE;
if (!productId) {
  throw new Error("POLAR_PRODUCT_ID_FREE is required");
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

async function getPortalCustomerMeter(customerSession: string) {
  const customerMeters = await polar.customerPortal.customerMeters.list(
    { customerSession },
    { meterId, limit: 1 },
  );

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
  const customer = await polar.customers.create({
    type: "individual",
    email: `polar-usage+${runId}@cueva.io`,
    externalId: externalCustomerId,
    name: "Tab Polar Usage Verify",
    metadata: { source: "tab-polar-verify-usage" },
    ...organizationScope,
  });
  customerId = customer.id;

  const subscription = await polar.subscriptions.create({
    productId,
    externalCustomerId,
    metadata: { source: "tab-polar-verify-usage" },
  });

  const customerSession = await polar.customerSessions.create({
    externalCustomerId,
  });

  await polar.events.ingest({
    events: [
      {
        name: "autocomplete.used",
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
  let portalCustomerMeter = await getPortalCustomerMeter(customerSession.token);

  for (let attempt = 1; attempt <= 12; attempt++) {
    quantity = await getMeterQuantity();
    customerMeter = await getCustomerMeter();
    portalCustomerMeter = await getPortalCustomerMeter(customerSession.token);

    if (
      quantity > 0 &&
      customerMeter &&
      customerMeter.consumedUnits > 0 &&
      portalCustomerMeter &&
      portalCustomerMeter.consumedUnits > 0
    ) {
      break;
    }

    await delay(2_500);
  }

  if (quantity <= 0) {
    throw new Error(`Expected Polar meter quantity > 0, got ${quantity}`);
  }

  if (!customerMeter) {
    throw new Error("Expected Polar customer meter to exist");
  }

  if (customerMeter.consumedUnits <= 0) {
    throw new Error(
      `Expected Polar customer meter consumed units > 0, got ${customerMeter.consumedUnits}`,
    );
  }

  if (!portalCustomerMeter) {
    throw new Error("Expected Polar portal customer meter to exist");
  }

  if (portalCustomerMeter.consumedUnits <= 0) {
    throw new Error(
      `Expected Polar portal customer meter consumed units > 0, got ${portalCustomerMeter.consumedUnits}`,
    );
  }

  console.log("Polar usage verification passed", {
    externalCustomerId,
    subscriptionId: subscription.id,
    meterQuantity: quantity,
    consumedUnits: customerMeter.consumedUnits,
    creditedUnits: customerMeter.creditedUnits,
    balance: customerMeter.balance,
    portalConsumedUnits: portalCustomerMeter.consumedUnits,
    portalCreditedUnits: portalCustomerMeter.creditedUnits,
    portalBalance: portalCustomerMeter.balance,
  });
} finally {
  if (customerId) {
    await polar.customers.delete({ id: customerId, anonymize: true });
  }
}
