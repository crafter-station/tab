import type { PaidPlanId } from "@tab/billing";
import {
  hasActivePolarEntitlement,
  type BillingCheckoutClient,
  type BillingService,
} from "./billing.ts";

export type BillingUser = {
  readonly id: string;
  readonly email: string;
  readonly name?: string;
  readonly emailVerified: boolean;
};

export class BillingDestinationService {
  constructor(
    private readonly billingService: BillingService,
    private readonly checkoutClient: BillingCheckoutClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createPlanChangeUrl(user: BillingUser, planId: PaidPlanId): Promise<string> {
    await this.billingService.initializeAccount(user.id);
    const entitlement = await this.billingService.provisionAccount(user);

    if (hasActivePolarEntitlement(entitlement, this.now())) {
      try {
        return await this.checkoutClient.createPortalUrl(
          user.id,
          entitlement.polarCustomerId,
        );
      } catch {
        return "/billing/portal";
      }
    }

    return this.checkoutClient.createCheckoutUrl(
      planId,
      "monthly",
      user,
      entitlement.polarSubscriptionId?.startsWith("pending:")
        ? undefined
        : entitlement.polarSubscriptionId,
    );
  }

  async createPortalUrl(user: BillingUser): Promise<string> {
    const entitlement = user.emailVerified
      ? await this.billingService.provisionAccount(user)
      : await this.billingService.getEntitlement(user.id);
    return this.checkoutClient.createPortalUrl(
      user.id,
      entitlement.polarCustomerId,
    );
  }
}
