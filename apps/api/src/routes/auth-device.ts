import {
  DeviceAuthorizeResponseSchema,
  DeviceListResponseSchema,
  DeviceTokenExchangeRequestSchema,
  DeviceTokenExchangeResponseSchema,
} from "@tab/contracts";
import type { ApiApp } from "../api-types.ts";
import type { AuthInstance } from "../auth.ts";
import type { BillingService } from "../billing.ts";
import type { DeviceTokenService } from "../device-tokens.ts";
import { requireSession } from "../http/auth.ts";
import { createErrorResponse, formatValidationIssues } from "../http/responses.ts";

export function registerDeviceAuthRoutes(
  app: ApiApp,
  deps: {
    auth: AuthInstance;
    billingService: BillingService;
    deviceTokenService: DeviceTokenService;
  },
) {
  app.post("/api/auth/device/authorize", async (c) => {
    const sessionCheck = await requireSession(c, deps.auth);
    if (!sessionCheck.ok) return sessionCheck.response;

    const code = await deps.deviceTokenService.createExchangeCode(
      sessionCheck.session.user.id,
    );

    return c.json(DeviceAuthorizeResponseSchema.parse({ code }), 200);
  });

  app.post("/api/auth/device/exchange", async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json(
        createErrorResponse("invalid_request", "Request body must be valid JSON."),
        400,
      );
    }

    const parseResult = DeviceTokenExchangeRequestSchema.safeParse(payload);
    if (!parseResult.success) {
      return c.json(
        createErrorResponse(
          "invalid_request",
          formatValidationIssues(parseResult.error.issues),
        ),
        400,
      );
    }

    const exchange = await deps.deviceTokenService.consumeExchangeCode(
      parseResult.data.code,
    );
    if (!exchange) {
      return c.json(
        createErrorResponse("invalid_request", "Invalid or expired exchange code."),
        400,
      );
    }

    const activeDevices = await deps.deviceTokenService.activeDeviceCount(
      exchange.userId,
    );
    const entitlement = await deps.billingService.getStatus(exchange.userId, {
      activeDevices,
    });
    const linked = await deps.deviceTokenService.createDeviceTokenWithinLimit(
      exchange.userId,
      {
        deviceId: parseResult.data.deviceId,
        platform: parseResult.data.platform,
        appVersion: parseResult.data.appVersion,
      },
      entitlement.capabilities.personalDeviceLimit,
    );
    if (!linked) {
      return c.json(
        createErrorResponse(
          "device_limit_reached",
          "This account has reached its connected Mac limit.",
          {
            capability: "devices",
            limit: entitlement.capabilities.personalDeviceLimit,
            used: entitlement.devices.active,
            upgradeUrl: "/pricing",
          },
        ),
        409,
      );
    }

    return c.json(
      DeviceTokenExchangeResponseSchema.parse({ token: linked.token }),
      200,
    );
  });

  app.post("/api/auth/device/revoke", async (c) => {
    const sessionCheck = await requireSession(c, deps.auth);
    if (!sessionCheck.ok) return sessionCheck.response;

    let payload: { deviceId?: string } = {};
    try {
      payload = (await c.req.json()) as { deviceId?: string };
    } catch {
      // allow empty body
    }

    if (!payload.deviceId) {
      return c.json(createErrorResponse("invalid_request", "deviceId is required."), 400);
    }

    const revoked = await deps.deviceTokenService.revokeDevice(
      sessionCheck.session.user.id,
      payload.deviceId,
    );

    if (!revoked) {
      return c.json(createErrorResponse("invalid_request", "Device not found."), 404);
    }

    return c.json({ ok: true }, 200);
  });

  app.get("/api/auth/devices", async (c) => {
    const sessionCheck = await requireSession(c, deps.auth);
    if (!sessionCheck.ok) return sessionCheck.response;

    const devices = await deps.deviceTokenService.listDevices(
      sessionCheck.session.user.id,
    );

    return c.json(
      DeviceListResponseSchema.parse({
        status: "ok",
        data: {
          devices: devices.map((device) => ({
            ...deps.deviceTokenService.getDeviceMetadata(device),
            id: device.id,
            deviceId: device.deviceId,
          })),
        },
      }),
      200,
    );
  });
}
