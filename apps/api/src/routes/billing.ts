import { isPaidPlanId } from "@tab/billing";
import {
  BillingCheckoutResponseSchema,
  BillingPortalResponseSchema,
  BillingStatusResponseSchema,
} from "@tab/contracts";
import type { Context } from "hono";
import type { ApiApp, ApiBindings, ApiVariables } from "../api-types.ts";
import type { AuthInstance } from "../auth.ts";
import {
  hasActivePolarEntitlement,
  type BillingCheckoutClient,
  type BillingService,
} from "../billing.ts";
import type { DeviceTokenService } from "../device-tokens.ts";
import { requireSession } from "../http/auth.ts";
import { createErrorResponse } from "../http/responses.ts";

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

  app.post("/api/billing/reconcile", async (c) => {
    const sessionCheck = await requireSession(c, deps.auth);
    if (!sessionCheck.ok) return sessionCheck.response;
    await deps.billingService.reconcileEntitlement(sessionCheck.session.user.id);
    return c.json({ status: "ok", data: { reconciled: true } }, 200);
  });

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
    if (!isPaidPlanId(planId) || interval !== "monthly") {
      return c.json(
        createErrorResponse("invalid_request", "Invalid plan or billing interval."),
        400,
      );
    }

    const userId = sessionCheck.session.user.id;
    await deps.billingService.initializeAccount(userId);
    const entitlement = await deps.billingService.provisionAccount({
      id: userId,
      email: sessionCheck.session.user.email,
      name: sessionCheck.session.user.name,
    });
    if (hasActivePolarEntitlement(entitlement, new Date())) {
      if (entitlement.planId === planId) {
        return c.json(
          BillingCheckoutResponseSchema.parse({
            status: "ok",
            data: { url: "/dashboard" },
          }),
          200,
        );
      }
      if (deps.billingCheckoutClient.changePlan && entitlement.polarSubscriptionId) {
        const requested = c.req.query("proration") ?? "next_period";
        if (requested !== "invoice" && requested !== "next_period" && requested !== "reset") {
          return c.json(
            createErrorResponse("invalid_request", "Invalid plan change timing."),
            400,
          );
        }
        try {
          await deps.billingCheckoutClient.changePlan(
            planId,
            entitlement.polarSubscriptionId,
            requested,
          );
          return c.json(
            BillingCheckoutResponseSchema.parse({
              status: "ok",
              data: { url: "/dashboard?billing=success" },
            }),
            200,
          );
        } catch (error) {
          return c.json(
            createErrorResponse(
              "provider_failure",
              error instanceof Error ? error.message : "Plan change failed.",
            ),
            503,
          );
        }
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
        planId,
        "monthly",
        {
          id: userId,
          email: sessionCheck.session.user.email,
          name: sessionCheck.session.user.name,
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

  app.post("/api/billing/downgrade", async (c) => {
    const sessionCheck = await requireSession(c, deps.auth);
    if (!sessionCheck.ok) return sessionCheck.response;
    const entitlement = await deps.billingService.getEntitlement(
      sessionCheck.session.user.id,
    );
    if (
      !deps.billingCheckoutClient.changePlan ||
      !entitlement.polarSubscriptionId ||
      entitlement.planId === "free"
    ) {
      return c.json(
        createErrorResponse("plan_change_required", "No paid subscription can be downgraded."),
        409,
      );
    }
    try {
      await deps.billingCheckoutClient.changePlan(
        "free",
        entitlement.polarSubscriptionId,
        "next_period",
      );
      return c.json({ status: "ok", data: { scheduled: true } }, 200);
    } catch (error) {
      return c.json(
        createErrorResponse(
          "provider_failure",
          error instanceof Error ? error.message : "Downgrade failed.",
        ),
        503,
      );
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
