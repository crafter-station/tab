import { planQuotas, type PlanId } from "@tabb/billing";
import {
  BillingCheckoutResponseSchema,
  BillingPortalResponseSchema,
  BillingQuotaResponseSchema,
} from "@tabb/contracts";
import type { ApiApp } from "../api-types.ts";
import type { AuthInstance } from "../auth.ts";
import {
  BillingWebhookHandler,
  hasActivePolarEntitlement,
  type BillingCheckoutClient,
  type PlanChangeOptions,
  type BillingService,
} from "../billing.ts";
import { requireSession } from "../http/auth.ts";
import { createErrorResponse } from "../http/responses.ts";

function isPlanId(planId: string | undefined): planId is PlanId {
  return Boolean(planId && planId in planQuotas);
}

function getPlanChangeProrationBehavior(
  currentPlanId: PlanId,
  targetPlanId: PlanId,
): PlanChangeOptions["prorationBehavior"] | undefined {
  if (currentPlanId === "pro" && targetPlanId === "max") return "prorate";
  if (currentPlanId === "max" && targetPlanId === "pro") return "next_period";
  return undefined;
}

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

    if (!quotaCheck.ok && quotaCheck.reason === "billing_required") {
      return c.json(
        createErrorResponse(
          "billing_required",
          "Choose the free plan in Polar to continue using Tabb.",
          {
            quota: quotaCheck.quota,
            usage: quotaCheck.usage,
            resetAt: quotaCheck.resetAt.toISOString(),
            upgradeUrl: "/billing/checkout?plan=free",
          },
        ),
        402,
      );
    }

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
    if (!isPlanId(planId)) {
      return c.json(createErrorResponse("invalid_request", "Invalid plan."), 400);
    }

    const userId = sessionCheck.session.user.id;
    const entitlement = await deps.billingService.getEntitlement(userId);
    const hasActivePaidSubscription =
      entitlement.planId !== "free" && hasActivePolarEntitlement(entitlement);

    if (hasActivePaidSubscription) {
      if (planId === entitlement.planId) {
        return c.json(
          BillingCheckoutResponseSchema.parse({ status: "ok", data: { url: "/dashboard" } }),
          200,
        );
      }

      if (planId === "free") {
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
            BillingCheckoutResponseSchema.parse({ status: "ok", data: { url: "/billing/portal" } }),
            200,
          );
        }
      }

      const prorationBehavior = getPlanChangeProrationBehavior(
        entitlement.planId,
        planId,
      );
      if (!prorationBehavior) {
        return c.json(
          createErrorResponse(
            "plan_change_required",
            "Plan Change is required for active paid subscriptions.",
          ),
          409,
        );
      }

      const subscriptionId = entitlement.polarSubscriptionId;
      if (!subscriptionId) {
        return c.json(createErrorResponse("invalid_request", "Missing subscription ID."), 400);
      }

      try {
        await deps.billingCheckoutClient.changePlan({
          subscriptionId,
          targetPlanId: planId,
          prorationBehavior,
        });
        if (prorationBehavior === "prorate") {
          await deps.billingService.applyEntitlement({
            ...entitlement,
            planId,
            cachedAt: new Date(),
          });
        }
        return c.json(
          BillingCheckoutResponseSchema.parse({ status: "ok", data: { url: "/dashboard" } }),
          200,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown provider error.";
        return c.json(createErrorResponse("provider_failure", `Plan Change failed: ${message}`), 503);
      }
    }

    try {
      const url = await deps.billingCheckoutClient.createCheckoutUrl(
        planId,
        {
          id: userId,
          email: sessionCheck.session.user.email,
          name: sessionCheck.session.user.name,
        },
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
