import {
  ApiResponseSchema,
  SuggestionRequestSchema,
  type Suggestion,
  type SuggestionRequest,
} from "@tab/contracts";
import type { RequestableTypingContextSnapshot } from "./typing-context.ts";
import type { DeviceApiClient } from "./device-api-client.ts";

export type ApiSuggestionClientDependencies = {
  api: Pick<DeviceApiClient, "request">;
  deviceId: string;
  appVersion: string;
  platform: string;
  memoryEnabled?: boolean | (() => boolean);
  getCustomWritingInstructions?: () => string | undefined;
  onEntitlementError?: () => void;
};

function getMemoryEnabledPreference(deps: ApiSuggestionClientDependencies): boolean {
  if (typeof deps.memoryEnabled === "function") {
    return deps.memoryEnabled();
  }

  if (typeof deps.memoryEnabled === "boolean") {
    return deps.memoryEnabled;
  }

  return true;
}

function buildSuggestionRequest(
  deps: ApiSuggestionClientDependencies,
  snapshot: RequestableTypingContextSnapshot,
): SuggestionRequest {
  return {
    requestId: crypto.randomUUID(),
    deviceId: deps.deviceId,
    mode: "deep_complete",
    typingContext: snapshot.sanitizedContext,
    contextSource: snapshot.contextSource,
    redaction: snapshot.redaction,
    activeApplication: snapshot.activeApplication,
    memoryEnabled: getMemoryEnabledPreference(deps) && snapshot.memoryEligible,
    contextHash: snapshot.contextHash,
    appContext: snapshot.appContext,
    customWritingInstructions: deps.getCustomWritingInstructions?.(),
    clientMetadata: {
      appVersion: deps.appVersion,
      platform: deps.platform,
    },
  };
}

export function createApiSuggestionClient(deps: ApiSuggestionClientDependencies) {
  return async function requestSuggestion(
    snapshot: RequestableTypingContextSnapshot,
    options?: { signal?: AbortSignal },
  ): Promise<Suggestion | null> {
    const payload = buildSuggestionRequest(deps, snapshot);
    const parsed = SuggestionRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return null;
    }

    try {
      const response = await deps.api.request("/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
        signal: options?.signal,
      });

      if (!response.ok) {
        if (response.status === 402) {
          const error = ApiResponseSchema.safeParse(
            (await response.json()) as unknown,
          );
          if (
            error.success &&
            error.data.status === "error" &&
            error.data.error.code === "quota_exhausted"
          ) {
            deps.onEntitlementError?.();
          }
        }
        return null;
      }

      const body = (await response.json()) as unknown;
      const apiResponse = ApiResponseSchema.safeParse(body);

      if (!apiResponse.success || apiResponse.data.status === "error") {
        return null;
      }

      return apiResponse.data.data.suggestions[0] ?? null;
    } catch {
      // Fail silently for transient network or backend failures so typing is
      // never interrupted (PRD user story 23 and ADR-0030).
      return null;
    }
  };
}
