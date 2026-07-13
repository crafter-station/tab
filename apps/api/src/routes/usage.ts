import {
  LocalAcceptanceUsageRequestSchema,
  LocalAcceptanceUsageResponseSchema,
} from "@tab/contracts";
import type { ApiApp } from "../api-types.ts";
import type { BillingService } from "../billing.ts";
import { createErrorResponse, formatValidationIssues } from "../http/responses.ts";

export function registerUsageRoutes(
  app: ApiApp,
  deps: { billingService: BillingService },
) {
  app.post("/api/usage/local-acceptances", async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json(
        createErrorResponse("invalid_request", "Request body must be valid JSON."),
        400,
      );
    }

    const parsed = LocalAcceptanceUsageRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return c.json(
        createErrorResponse(
          "invalid_request",
          formatValidationIssues(parsed.error.issues),
        ),
        400,
      );
    }

    const device = c.get("device");
    const status = await deps.billingService.recordLocalAcceptedWords({
      userId: device.userId,
      acceptanceId: parsed.data.acceptanceId,
      localDay: parsed.data.localDay,
      words: parsed.data.wordCount,
    });
    return c.json(
      LocalAcceptanceUsageResponseSchema.parse({
        status: "ok",
        data: { localAcceptedWords: status.localAcceptedWords },
      }),
      200,
    );
  });
}
