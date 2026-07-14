import {
  LocalSuggestionActivityResponseSchema,
  RecordTelemetryEventsRequestSchema,
  TelemetryEventsResponseSchema,
} from "@tab/contracts";
import type { ApiApp } from "../api-types.ts";
import type { TelemetryService } from "../telemetry.ts";
import { readJsonRequest } from "../http/request.ts";
import { createErrorResponse } from "../http/responses.ts";
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
    const request = await readJsonRequest(c.req, RecordTelemetryEventsRequestSchema);
    if (!request.ok) {
      return c.json(
        createErrorResponse("invalid_request", request.message),
        400,
      );
    }

    const device = c.get("device");

    for (const event of request.data) {
      try {
        await deps.telemetryService.record({
          id: event.eventId,
          eventType: event.eventType,
          requestId: event.requestId,
          userId: device.userId,
          deviceId: device.deviceId,
          timestamp: event.timestamp,
          suggestionLength: event.suggestionLength,
          latencyMs: event.latencyMs,
          errorCode: event.errorCode,
          modelId: event.modelId,
          inferenceSource: event.inferenceSource,
          trigger: event.trigger,
          acceptedWordCount: event.acceptedWordCount,
          acceptedCharacterCount: event.acceptedCharacterCount,
          applicationCategory: event.applicationCategory,
          memoryUsed: event.memoryUsed,
          memoryCount: event.memoryCount,
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
