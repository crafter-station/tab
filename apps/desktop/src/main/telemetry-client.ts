import {
  RecordTelemetryEventRequestSchema,
  TelemetryEventsResponseSchema,
  type RecordTelemetryEventRequest,
} from "@tabb/contracts";

export type DesktopTelemetryClientDependencies = {
  readonly apiBaseUrl: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly getAuthorizationHeader?: () => Promise<string | null>;
};

export function createDesktopTelemetryClient(deps: DesktopTelemetryClientDependencies) {
  const http = deps.fetch ?? globalThis.fetch;

  return async function recordInteractionTelemetry(event: RecordTelemetryEventRequest): Promise<void> {
    const parsed = RecordTelemetryEventRequestSchema.safeParse(event);
    if (!parsed.success) return;

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const authorization = await deps.getAuthorizationHeader?.();
      if (authorization) {
        headers.Authorization = authorization;
      }

      const response = await http(`${deps.apiBaseUrl}/telemetry/events`, {
        method: "POST",
        headers,
        body: JSON.stringify(parsed.data),
      });

      if (!response.ok) return;

      const body = (await response.json()) as unknown;
      TelemetryEventsResponseSchema.safeParse(body);
    } catch {
      // Interaction telemetry is best-effort and must never block desktop input.
    }
  };
}
