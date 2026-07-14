import {
  LocalSuggestionActivityResponseSchema,
  RecordTelemetryEventsRequestSchema,
  TelemetryEventsResponseSchema,
} from "@tab/contracts";
import type { ApiApp } from "../api-types.ts";
import type { TelemetryService } from "../telemetry.ts";
import { readJsonRequest } from "../http/request.ts";
import { createErrorResponse } from "../http/responses.ts";

export function registerTelemetryRoutes(
  app: ApiApp,
  deps: { telemetryService: TelemetryService },
) {
  app.get("/api/activity/local-suggestions", async (c) => {
    const activity = await deps.telemetryService.getLocalSuggestionActivity(
      c.get("session").user.id,
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
    await deps.telemetryService.recordDeviceEvents(request.data, {
      userId: device.userId,
      deviceId: device.deviceId,
    });

    return c.json(
      TelemetryEventsResponseSchema.parse({ status: "ok", data: { recorded: true } }),
      200,
    );
  });
}
