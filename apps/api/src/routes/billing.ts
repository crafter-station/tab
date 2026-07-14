import { isPaidPlanId } from "@tab/billing";
import {
  BillingCheckoutResponseSchema,
  BillingPortalResponseSchema,
  BillingStatusResponseSchema,
} from "@tab/contracts";
import type { Context } from "hono";
import type { ApiApp, ApiBindings, ApiVariables } from "../api-types.ts";
import {
  hasActivePolarEntitlement,
  type BillingCheckoutClient,
  type BillingService,
} from "../billing.ts";
import type { DeviceTokenService } from "../device-tokens.ts";
import { createErrorResponse } from "../http/responses.ts";

export function registerBillingRoutes(
  app: ApiApp,
  deps: {
    billingService: BillingService;
    billingCheckoutClient: BillingCheckoutClient;
    deviceTokenService: DeviceTokenService;
  },
) {
  const billingStatus = async (
    c: Context<{ Bindings: ApiBindings; Variables: ApiVariables }>,
  ) => {
    const session = c.get("session");
    if (session.user.emailVerified) {
      const provisioning = deps.billingService.provisionAccount({
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
      });
      try {
        c.executionCtx.waitUntil(provisioning);
      } catch {
        await provisioning;
      }
    }
    const devices = await deps.deviceTokenService.listDevices(
      session.user.id,
    );
    const status = await deps.billingService.getStatus(
      session.user.id,
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

  app.post("/api/billing/reconcile", async (c) => {
    await deps.billingService.reconcileEntitlement(c.get("session").user.id);
    return c.json({ status: "ok", data: { reconciled: true } }, 200);
  });

  app.get("/api/billing/checkout", async (c) => {
    const session = c.get("session");
    if (!session.user.emailVerified) {
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
    if (!isPaidPlanId(planId) || interval !== "monthly") {
      return c.json(
        createErrorResponse("invalid_request", "Invalid plan or billing interval."),
        400,
      );
    }

    const userId = session.user.id;
    await deps.billingService.initializeAccount(userId);
    const entitlement = await deps.billingService.provisionAccount({
      id: userId,
      email: session.user.email,
      name: session.user.name,
    });
    if (hasActivePolarEntitlement(entitlement, new Date())) {
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
        planId,
        "monthly",
        {
          id: userId,
          email: session.user.email,
          name: session.user.name,
        },
        entitlement.polarSubscriptionId?.startsWith("pending:")
          ? undefined
          : entitlement.polarSubscriptionId,
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
    const session = c.get("session");
    const userId = session.user.id;
    const entitlement = session.user.emailVerified
      ? await deps.billingService.provisionAccount({
          id: userId,
          email: session.user.email,
          name: session.user.name,
        })
      : await deps.billingService.getEntitlement(userId);
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
    const body = await c.req.text();
    const validation = deps.billingService.validatePaidEntitlementEvent(body, {
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
    await deps.billingService.applyPaidEntitlementEvent({
      ...validation.payload,
      id: c.req.header("webhook-id") ?? validation.payload.id,
    });
    return c.json({ ok: true }, 200);
  });
}
