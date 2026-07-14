import {
  LocalAcceptanceUsageRequestSchema,
  LocalAcceptanceUsageResponseSchema,
} from "@tab/contracts";
import type { AllowanceState } from "@tab/contracts";
import type { AcceptedWordLedgerEvent } from "./accepted-word-ledger.ts";
import type { DeviceApiClient } from "./device-api-client.ts";

export function createLocalAcceptanceUsageClient(deps: {
  api: Pick<DeviceApiClient, "requestAuthorized">;
}) {
  return async function synchronizeLocalAcceptance(
    event: AcceptedWordLedgerEvent,
  ): Promise<AllowanceState | null> {
    const payload = LocalAcceptanceUsageRequestSchema.parse({
      acceptanceId: event.acceptanceId,
      localDay: event.localDay,
      acceptedAt: event.acceptedAt,
      wordCount: event.wordCount,
      characterCount: event.characterCount,
    });
    try {
      const response = await deps.api.requestAuthorized(
        "/api/usage/local-acceptances",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );
      if (!response) return null;
      if (!response.ok) return null;
      const parsed = LocalAcceptanceUsageResponseSchema.safeParse(
        (await response.json()) as unknown,
      );
      return parsed.success ? parsed.data.data.localAcceptedWords : null;
    } catch {
      return null;
    }
  };
}
