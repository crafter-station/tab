import { planQuotas } from "@tabb/billing";
import {
  BillingCheckoutResponseSchema,
  BillingPortalResponseSchema,
  BillingQuotaResponseSchema,
} from "@tabb/contracts";
import type { ApiApp } from "../api-types.ts";
import type { AuthInstance } from "../auth.ts";
import { BillingWebhookHandler, type BillingCheckoutClient, type BillingService } from "../billing.ts";
import { requireSession } from "../http/auth.ts";
import { createErrorResponse } from "../http/responses.ts";

export function registerBillingRoutes(
  app: ApiApp,
  deps: {
    auth: AuthInstance;
    billingService: BillingService;
    billingCheckoutClient: BillingCheckoutClient;
  },
) {
  app.get("/api/billing/quota", async (c) => {
    const sessionCheck = await requireSession(c, deps.auth);
    if (!sessionCheck.ok) return sessionCheck.response;

    const quotaCheck = await deps.billingService.checkQuota(sessionCheck.session.user.id);

    return c.json(
      BillingQuotaResponseSchema.parse({
        status: "ok",
        data: {
          planId: quotaCheck.entitlement.planId,
          quota: quotaCheck.quota,
          usage: quotaCheck.usage,
          resetAt: quotaCheck.resetAt.toISOString(),
          upgradeUrl: quotaCheck.ok ? undefined : "/pricing",
        },
      }),
      200,
    );
  });

  app.get("/api/billing/checkout", async (c) => {
    const sessionCheck = await requireSession(c, deps.auth);
    if (!sessionCheck.ok) return sessionCheck.response;

    const planIdParam = c.req.query("plan");
    if (!planIdParam || !(planIdParam in planQuotas)) {
      return c.json(createErrorResponse("invalid_request", "Invalid plan."), 400);
    }

    try {
      const url = await deps.billingCheckoutClient.createCheckoutUrl(
        planIdParam as keyof typeof planQuotas,
        sessionCheck.session.user.id,
      );
      return c.json(BillingCheckoutResponseSchema.parse({ status: "ok", data: { url } }), 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Checkout creation failed.";
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
      return c.json(BillingPortalResponseSchema.parse({ status: "ok", data: { url } }), 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Portal creation failed.";
      return c.json(createErrorResponse("provider_failure", message), 503);
    }
  });

  app.post("/api/billing/webhook", async (c) => {
    const webhookHandler = new BillingWebhookHandler({ storage: deps.billingService.storage });
    const body = await c.req.text();
    const validation = webhookHandler.validateRequest(body, {
      "webhook-id": c.req.header("webhook-id"),
      "webhook-timestamp": c.req.header("webhook-timestamp"),
      "webhook-signature": c.req.header("webhook-signature"),
    });

    if (!validation.valid) {
      return c.json(createErrorResponse("invalid_request", validation.reason), 400);
    }

    await webhookHandler.handle(validation.payload);
    return c.json({ ok: true }, 200);
  });
}
