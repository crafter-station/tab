import { describe, expect, it } from "bun:test";
import type { RecordTelemetryEventRequest } from "@tab/contracts";
import { createDesktopTelemetryClient } from "../apps/desktop/src/main/telemetry-client.ts";

function event(eventType: RecordTelemetryEventRequest["eventType"]): RecordTelemetryEventRequest {
  return {
    eventType,
    eventId: crypto.randomUUID(),
    requestId: "request-1",
    timestamp: new Date().toISOString(),
    inferenceSource: "local",
    trigger: "automatic",
  };
}

describe("desktop telemetry client", () => {
  it("sends synchronously adjacent events in one request", async () => {
    const requests: RequestInit[] = [];
    const client = createDesktopTelemetryClient({
      apiBaseUrl: "https://api.example.com",
      getAuthorizationHeader: async () => "Bearer device-token",
      fetch: async (_input, init) => {
        requests.push(init ?? {});
        return Response.json({ status: "ok", data: { recorded: true } });
      },
    });

    await Promise.all([
      client(event("suggestion_generated")),
      client(event("suggestion_shown")),
    ]);

    expect(requests).toHaveLength(1);
    expect(JSON.parse(String(requests[0]?.body))).toEqual([
      expect.objectContaining({ eventType: "suggestion_generated" }),
      expect.objectContaining({ eventType: "suggestion_shown" }),
    ]);
  });
});
