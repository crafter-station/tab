import {
  ApiResponseSchema,
  SuggestionRequestSchema,
  type Suggestion,
  type SuggestionRequest,
} from "@tab/contracts";
import type { RequestableTypingContextSnapshot } from "./typing-context.ts";

export type ApiSuggestionClientDependencies = {
  apiBaseUrl: string;
  deviceId: string;
  appVersion: string;
  platform: string;
  memoryEnabled?: boolean | (() => boolean);
  getCustomWritingInstructions?: () => string | undefined;
  fetch?: typeof globalThis.fetch;
  getAuthorizationHeader?: () => Promise<string | null>;
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
  const http = deps.fetch ?? globalThis.fetch;

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
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const authorization = await deps.getAuthorizationHeader?.();
      if (authorization) {
        headers.Authorization = authorization;
      }

      const response = await http(`${deps.apiBaseUrl}/suggestions`, {
        method: "POST",
        headers,
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
