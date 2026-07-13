import { DesktopStatusResponseSchema } from "@tab/contracts";
import type { ApiApp } from "../api-types.ts";
import type { BillingService } from "../billing.ts";
import type { DeviceTokenService } from "../device-tokens.ts";
import type { TelemetryService } from "../telemetry.ts";

export function registerStatusRoutes(
  app: ApiApp,
  deps: {
    billingService: BillingService;
    telemetryService: TelemetryService;
    deviceTokenService: DeviceTokenService;
  },
) {
  app.get("/api/status", async (c) => {
    const device = c.get("device");
    const localDay = c.req.query("localDay");
    const validLocalDay = localDay && /^\d{4}-\d{2}-\d{2}$/.test(localDay)
      ? localDay
      : undefined;
    const localResetAt = c.req.query("localResetAt");
    const parsedLocalResetAt = localResetAt ? new Date(localResetAt) : null;
    const validLocalResetAt =
      parsedLocalResetAt && !Number.isNaN(parsedLocalResetAt.getTime())
        ? parsedLocalResetAt
        : undefined;
    const [devices, localSuggestionActivity] = await Promise.all([
      deps.deviceTokenService.listDevices(device.userId),
      deps.telemetryService.getLocalSuggestionActivity(device.userId),
    ]);
    const entitlement = await deps.billingService.getStatus(device.userId, {
      localDay: validLocalDay,
      localResetAt: validLocalResetAt,
      activeDevices: devices.filter((candidate) => !candidate.revoked).length,
    });

    return c.json(
      DesktopStatusResponseSchema.parse({
        status: "ok",
        data: {
          authenticated: true,
          deviceRevoked: false,
          userId: device.userId,
          entitlement,
          localSuggestionActivity,
        },
      }),
      200,
    );
  });
}
