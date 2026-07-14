import { describe, expect, it } from "bun:test";
import { BillingDestinationService } from "../apps/api/src/billing-destinations.ts";
import {
  BillingService,
  InMemoryBillingStorage,
  type BillingCheckoutClient,
} from "../apps/api/src/billing.ts";

const now = new Date("2026-07-14T12:00:00.000Z");
const user = {
  id: "user-1",
  email: "user@example.com",
  name: "Example User",
  emailVerified: true,
} as const;

function createCheckoutClient(options: {
  portalUrl?: string;
  portalError?: Error;
} = {}) {
  const calls: Array<{ method: "checkout" | "portal"; subscriptionId?: string }> = [];
  const client: BillingCheckoutClient = {
    async createCheckoutUrl(_planId, _interval, _user, subscriptionId) {
      calls.push({ method: "checkout", subscriptionId });
      return "https://checkout.example/session";
    },
    async createPortalUrl() {
      calls.push({ method: "portal" });
      if (options.portalError) throw options.portalError;
      return options.portalUrl ?? "https://portal.example/account";
    },
  };
  return { calls, client };
}

describe("BillingDestinationService", () => {
  it("upgrades the existing Free subscription through checkout", async () => {
    const billing = new BillingService({
      storage: new InMemoryBillingStorage(),
      now: () => now,
    });
    await billing.applyEntitlement({
      userId: user.id,
      planId: "free",
      polarCustomerId: "customer-free",
      polarSubscriptionId: "subscription-free",
      status: "active",
      currentPeriodStart: new Date("2026-07-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
      cachedAt: now,
    });
    const checkout = createCheckoutClient();
    const destinations = new BillingDestinationService(
      billing,
      checkout.client,
      () => now,
    );

    expect(await destinations.createPlanChangeUrl(user, "pro")).toBe(
      "https://checkout.example/session",
    );
    expect(checkout.calls).toEqual([
      { method: "checkout", subscriptionId: "subscription-free" },
    ]);
  });

  it("sends active paid subscribers to the customer portal", async () => {
    const billing = new BillingService({
      storage: new InMemoryBillingStorage(),
      now: () => now,
    });
    await billing.applyEntitlement({
      userId: user.id,
      planId: "pro",
      polarCustomerId: "customer-paid",
      polarSubscriptionId: "subscription-paid",
      status: "active",
      currentPeriodStart: new Date("2026-07-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
      cachedAt: now,
    });
    const checkout = createCheckoutClient();
    const destinations = new BillingDestinationService(
      billing,
      checkout.client,
      () => now,
    );

    expect(await destinations.createPlanChangeUrl(user, "max")).toBe(
      "https://portal.example/account",
    );
    expect(checkout.calls).toEqual([{ method: "portal" }]);
  });

  it("falls back to the app portal route when Polar cannot open the portal", async () => {
    const billing = new BillingService({
      storage: new InMemoryBillingStorage(),
      now: () => now,
    });
    await billing.applyEntitlement({
      userId: user.id,
      planId: "pro",
      polarCustomerId: "customer-paid",
      polarSubscriptionId: "subscription-paid",
      status: "active",
      currentPeriodStart: new Date("2026-07-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
      cachedAt: now,
    });
    const checkout = createCheckoutClient({
      portalError: new Error("Polar unavailable"),
    });
    const destinations = new BillingDestinationService(
      billing,
      checkout.client,
      () => now,
    );

    expect(await destinations.createPlanChangeUrl(user, "max")).toBe(
      "/billing/portal",
    );
    expect(checkout.calls).toEqual([{ method: "portal" }]);
  });

  it("opens the portal from cached billing state for an unverified account", async () => {
    let provisioningAttempts = 0;
    const billing = new BillingService({
      storage: new InMemoryBillingStorage(),
      now: () => now,
      provisioningClient: {
        async provisionFreeSubscription() {
          provisioningAttempts += 1;
          throw new Error("Provisioning should not run");
        },
        async getSubscription() {
          throw new Error("Reconciliation should not run");
        },
      },
    });
    await billing.applyEntitlement({
      userId: user.id,
      planId: "free",
      polarCustomerId: "customer-free",
      status: "inactive",
      cachedAt: now,
    });
    const checkout = createCheckoutClient();
    const destinations = new BillingDestinationService(
      billing,
      checkout.client,
      () => now,
    );

    expect(
      await destinations.createPortalUrl({ ...user, emailVerified: false }),
    ).toBe("https://portal.example/account");
    expect(provisioningAttempts).toBe(0);
    expect(checkout.calls).toEqual([{ method: "portal" }]);
  });
});
