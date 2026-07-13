import {
  LocalSuggestionActivityResponseSchema,
  RecordTelemetryEventRequestSchema,
  TelemetryEventsResponseSchema,
} from "@tab/contracts";
import type { ApiApp } from "../api-types.ts";
import type { TelemetryService } from "../telemetry.ts";
import { createErrorResponse, formatValidationIssues } from "../http/responses.ts";
import type { AuthInstance } from "../auth.ts";
import { requireSession } from "../http/auth.ts";

export function registerTelemetryRoutes(
  app: ApiApp,
  deps: { telemetryService: TelemetryService; auth: AuthInstance },
) {
  app.get("/api/activity/local-suggestions", async (c) => {
    const session = await requireSession(c, deps.auth);
    if (!session.ok) return session.response;

    const activity = await deps.telemetryService.getLocalSuggestionActivity(
      session.session.user.id,
      new Date(),
    );
    return c.json(LocalSuggestionActivityResponseSchema.parse({ status: "ok", data: activity }), 200);
  });

  app.post("/telemetry/events", async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json(
        createErrorResponse("invalid_request", "Request body must be valid JSON."),
        400,
      );
    }

    const parseResult = RecordTelemetryEventRequestSchema.safeParse(payload);
    if (!parseResult.success) {
      return c.json(
        createErrorResponse(
          "invalid_request",
          formatValidationIssues(parseResult.error.issues),
        ),
        400,
      );
    }

    const request = parseResult.data;
    const device = c.get("device");

    try {
      await deps.telemetryService.record({
        eventType: request.eventType,
        requestId: request.requestId,
        userId: device.userId,
        deviceId: device.deviceId,
        timestamp: request.timestamp,
        activeApplicationBundleId: request.activeApplicationBundleId,
        suggestionLength: request.suggestionLength,
        latencyMs: request.latencyMs,
        modelId: request.modelId,
      });
    } catch {
      // Telemetry ingestion is best-effort; still return success to the client
      // so acceptance/dismissal reporting does not block typing.
    }

    return c.json(
      TelemetryEventsResponseSchema.parse({ status: "ok", data: { recorded: true } }),
      200,
    );
  });
}
