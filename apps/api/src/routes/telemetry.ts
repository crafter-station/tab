import { RecordTelemetryEventRequestSchema, TelemetryEventsResponseSchema } from "@tabb/contracts";
import type { ApiApp } from "../api-types.ts";
import type { TelemetryService } from "../telemetry.ts";
import { createErrorResponse, formatValidationIssues } from "../http/responses.ts";

export function registerTelemetryRoutes(
  app: ApiApp,
  deps: { telemetryService: TelemetryService },
) {
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
