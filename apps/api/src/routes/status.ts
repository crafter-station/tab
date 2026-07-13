import { DesktopStatusResponseSchema } from "@tab/contracts";
import type { ApiApp } from "../api-types.ts";
import type { BillingService } from "../billing.ts";
import type { TelemetryService } from "../telemetry.ts";

export function registerStatusRoutes(
  app: ApiApp,
  deps: { billingService: BillingService; telemetryService: TelemetryService },
) {
  app.get("/api/status", async (c) => {
    const device = c.get("device");
    const [quotaCheck, localSuggestionActivity] = await Promise.all([
      deps.billingService.checkQuota(device.userId),
      deps.telemetryService.getLocalSuggestionActivity(device.userId),
    ]);

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
          localSuggestionActivity,
        },
      }),
      200,
    );
  });
}
