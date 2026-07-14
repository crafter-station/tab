import {
  LocalSuggestionActivityResponseSchema,
  RecordTelemetryEventsRequestSchema,
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

    const parseResult = RecordTelemetryEventsRequestSchema.safeParse(payload);
    if (!parseResult.success) {
      return c.json(
        createErrorResponse(
          "invalid_request",
          formatValidationIssues(parseResult.error.issues),
        ),
        400,
      );
    }

    const device = c.get("device");

    for (const request of parseResult.data) {
      try {
        await deps.telemetryService.record({
          id: request.eventId,
          eventType: request.eventType,
          requestId: request.requestId,
          userId: device.userId,
          deviceId: device.deviceId,
          timestamp: request.timestamp,
          suggestionLength: request.suggestionLength,
          latencyMs: request.latencyMs,
          errorCode: request.errorCode,
          modelId: request.modelId,
          inferenceSource: request.inferenceSource,
          trigger: request.trigger,
          acceptedWordCount: request.acceptedWordCount,
          acceptedCharacterCount: request.acceptedCharacterCount,
          applicationCategory: request.applicationCategory,
          memoryUsed: request.memoryUsed,
          memoryCount: request.memoryCount,
        });
      } catch {
        // Telemetry ingestion is best-effort; one failed event must not block the batch.
      }
    }

    return c.json(
      TelemetryEventsResponseSchema.parse({ status: "ok", data: { recorded: true } }),
      200,
    );
  });
}
