import { isPlanId, type BillingInterval } from "@tab/billing";
import {
  BillingCheckoutResponseSchema,
  BillingPortalResponseSchema,
  BillingStatusResponseSchema,
} from "@tab/contracts";
import type { Context } from "hono";
import type { ApiApp, ApiBindings, ApiVariables } from "../api-types.ts";
import type { AuthInstance } from "../auth.ts";
import {
  BillingWebhookHandler,
  hasActivePolarEntitlement,
  type BillingCheckoutClient,
  type BillingService,
} from "../billing.ts";
import type { DeviceTokenService } from "../device-tokens.ts";
import { requireSession } from "../http/auth.ts";
import { createErrorResponse } from "../http/responses.ts";

function isBillingInterval(value: string | undefined): value is BillingInterval {
  return value === "monthly" || value === "annual";
}

export function registerBillingRoutes(
  app: ApiApp,
  deps: {
    auth: AuthInstance;
    billingService: BillingService;
    billingCheckoutClient: BillingCheckoutClient;
    deviceTokenService: DeviceTokenService;
  },
) {
  const billingStatus = async (
    c: Context<{ Bindings: ApiBindings; Variables: ApiVariables }>,
  ) => {
    const sessionCheck = await requireSession(c, deps.auth);
    if (!sessionCheck.ok) return sessionCheck.response;
    const devices = await deps.deviceTokenService.listDevices(
      sessionCheck.session.user.id,
    );
    const status = await deps.billingService.getStatus(
      sessionCheck.session.user.id,
      { activeDevices: devices.filter((device) => !device.revoked).length },
    );
    return c.json(
      BillingStatusResponseSchema.parse({ status: "ok", data: status }),
      200,
    );
  };

  app.get("/api/billing/status", billingStatus);
  // Existing clients can transition without assigning new meaning to legacy
  // usage rows; only the response contract is versioned to capability status.
  app.get("/api/billing/quota", billingStatus);

  app.get("/api/billing/checkout", async (c) => {
    const sessionCheck = await requireSession(c, deps.auth);
    if (!sessionCheck.ok) return sessionCheck.response;
    if (!sessionCheck.session.user.emailVerified) {
      return c.json(
        createErrorResponse(
          "email_unverified",
          "Verify your email address before starting checkout.",
        ),
        403,
      );
    }

    const planId = c.req.query("plan");
    const interval = c.req.query("interval") ?? "monthly";
    if (!isPlanId(planId) || planId !== "pro" || !isBillingInterval(interval)) {
      return c.json(
        createErrorResponse("invalid_request", "Invalid plan or billing interval."),
        400,
      );
    }

    const userId = sessionCheck.session.user.id;
    const entitlement = await deps.billingService.getEntitlement(userId);
    if (hasActivePolarEntitlement(entitlement)) {
      if (entitlement.billingInterval === interval) {
        return c.json(
          BillingCheckoutResponseSchema.parse({
            status: "ok",
            data: { url: "/dashboard" },
          }),
          200,
        );
      }
      try {
        const url = await deps.billingCheckoutClient.createPortalUrl(
          userId,
          entitlement.polarCustomerId,
        );
        return c.json(
          BillingCheckoutResponseSchema.parse({ status: "ok", data: { url } }),
          200,
        );
      } catch {
        return c.json(
          BillingCheckoutResponseSchema.parse({
            status: "ok",
            data: { url: "/billing/portal" },
          }),
          200,
        );
      }
    }

    try {
      const url = await deps.billingCheckoutClient.createCheckoutUrl(
        "pro",
        interval,
        {
          id: userId,
          email: sessionCheck.session.user.email,
          name: sessionCheck.session.user.name,
        },
      );
      return c.json(
        BillingCheckoutResponseSchema.parse({ status: "ok", data: { url } }),
        200,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Checkout creation failed.";
      return c.json(createErrorResponse("provider_failure", message), 503);
    }
  });

  app.get("/api/billing/portal", async (c) => {
    const sessionCheck = await requireSession(c, deps.auth);
    if (!sessionCheck.ok) return sessionCheck.response;
    const userId = sessionCheck.session.user.id;
    const entitlement = await deps.billingService.getEntitlement(userId);
    try {
      const url = await deps.billingCheckoutClient.createPortalUrl(
        userId,
        entitlement.polarCustomerId,
      );
      return c.json(
        BillingPortalResponseSchema.parse({ status: "ok", data: { url } }),
        200,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Portal creation failed.";
      return c.json(createErrorResponse("provider_failure", message), 503);
    }
  });

  app.post("/api/billing/webhook", async (c) => {
    const webhookHandler = new BillingWebhookHandler({
      storage: deps.billingService.storage,
    });
    const body = await c.req.text();
    const validation = webhookHandler.validateRequest(body, {
      "webhook-id": c.req.header("webhook-id"),
      "webhook-timestamp": c.req.header("webhook-timestamp"),
      "webhook-signature": c.req.header("webhook-signature"),
    });
    if (!validation.valid) {
      return c.json(
        createErrorResponse("invalid_request", validation.reason),
        400,
      );
    }
    await webhookHandler.handle(validation.payload);
    return c.json({ ok: true }, 200);
  });
}
