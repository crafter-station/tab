import {
  LocalAcceptanceUsageRequestSchema,
  LocalAcceptanceUsageResponseSchema,
} from "@tab/contracts";
import type { AllowanceState } from "@tab/contracts";
import type { AcceptedWordLedgerEvent } from "./accepted-word-ledger.ts";

export function createLocalAcceptanceUsageClient(deps: {
  apiBaseUrl: string;
  fetch?: typeof globalThis.fetch;
  getAuthorizationHeader?: () => Promise<string | null>;
}) {
  const http = deps.fetch ?? globalThis.fetch;
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
      const authorization = await deps.getAuthorizationHeader?.();
      if (!authorization) return null;
      const response = await http(
        `${deps.apiBaseUrl}/api/usage/local-acceptances`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authorization,
          },
          body: JSON.stringify(payload),
        },
      );
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
