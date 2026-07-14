import {
  LocalAcceptanceUsageRequestSchema,
  LocalAcceptanceUsageResponseSchema,
} from "@tab/contracts";
import type { ApiApp } from "../api-types.ts";
import type { BillingService } from "../billing.ts";
import { readJsonRequest } from "../http/request.ts";
import { createErrorResponse } from "../http/responses.ts";

export function registerUsageRoutes(
  app: ApiApp,
  deps: { billingService: BillingService },
) {
  app.post("/api/usage/local-acceptances", async (c) => {
    const request = await readJsonRequest(c.req, LocalAcceptanceUsageRequestSchema);
    if (!request.ok) {
      return c.json(
        createErrorResponse("invalid_request", request.message),
        400,
      );
    }

    const device = c.get("device");
    const status = await deps.billingService.recordLocalAcceptedWords({
      userId: device.userId,
      acceptanceId: request.data.acceptanceId,
      localDay: request.data.localDay,
      acceptedAt: new Date(request.data.acceptedAt),
      words: request.data.wordCount,
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
