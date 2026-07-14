import {
  RecordTelemetryEventRequestSchema,
  TelemetryEventsResponseSchema,
  type RecordTelemetryEventRequest,
} from "@tab/contracts";
import type { DeviceApiClient } from "./device-api-client.ts";

export type DesktopTelemetryClientDependencies = {
  readonly api: Pick<DeviceApiClient, "request">;
};

export function createDesktopTelemetryClient(deps: DesktopTelemetryClientDependencies) {
  const pending: Array<{
    event: RecordTelemetryEventRequest;
    resolve: () => void;
  }> = [];
  let flushScheduled = false;

  async function sendBatch(events: RecordTelemetryEventRequest[]): Promise<void> {
    try {
      const response = await deps.api.request("/telemetry/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(events),
      });

      if (!response.ok) return;

      const body = (await response.json()) as unknown;
      const parsedBody = TelemetryEventsResponseSchema.safeParse(body);
      if (!parsedBody.success) return;
    } catch {
      // Interaction telemetry is best-effort and must never block desktop input.
    }
  }

  function flush(): void {
    flushScheduled = false;
    const batch = pending.splice(0, pending.length);
    const requests: Array<Promise<void>> = [];
    for (let index = 0; index < batch.length; index += 20) {
      requests.push(sendBatch(batch.slice(index, index + 20).map(({ event }) => event)));
    }
    void Promise.all(requests).finally(() => {
      for (const item of batch) item.resolve();
    });
  }

  return function recordInteractionTelemetry(event: RecordTelemetryEventRequest): Promise<void> {
    const parsed = RecordTelemetryEventRequestSchema.safeParse(event);
    if (!parsed.success) return Promise.resolve();

    return new Promise((resolve) => {
      pending.push({ event: parsed.data, resolve });
      if (!flushScheduled) {
        flushScheduled = true;
        queueMicrotask(flush);
      }
    });
  };
}
