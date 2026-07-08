import { DesktopStatusResponseSchema } from "@tab/contracts";
import type { ApiApp } from "../api-types.ts";
import type { BillingService } from "../billing.ts";

export function registerStatusRoutes(
  app: ApiApp,
  deps: { billingService: BillingService },
) {
  app.get("/api/status", async (c) => {
    const device = c.get("device");
    const quotaCheck = await deps.billingService.checkQuota(device.userId);

    return c.json(
      DesktopStatusResponseSchema.parse({
        status: "ok",
        data: {
          authenticated: true,
          deviceRevoked: false,
          userId: device.userId,
          planId: quotaCheck.entitlement.planId,
          quota: quotaCheck.quota,
          usage: quotaCheck.usage,
          resetAt: quotaCheck.resetAt.toISOString(),
        },
      }),
      200,
    );
  });
}
