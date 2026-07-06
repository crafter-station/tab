import {
  ApiResponseSchema,
  SuggestionRequestSchema,
  type Suggestion,
  type SuggestionRequest,
} from "@tabb/contracts";
import { redactSensitiveText } from "@tabb/redaction";
import type { TypingContextState } from "./typing-context.ts";

export type ApiSuggestionClientDependencies = {
  apiBaseUrl: string;
  deviceId: string;
  appVersion: string;
  platform: string;
  getState(): TypingContextState;
  fetch?: typeof globalThis.fetch;
};

function buildContextHash(state: TypingContextState, context: string): string {
  return `${state.activeApplication?.bundleId ?? "none"}:${context}:${state.secureInput}`;
}

export function createApiSuggestionClient(deps: ApiSuggestionClientDependencies) {
  const http = deps.fetch ?? globalThis.fetch;

  return async function requestSuggestion(context: string): Promise<Suggestion | null> {
    const state = deps.getState();

    if (!state.activeApplication) {
      return null;
    }

    const redaction = redactSensitiveText(context);
    const requestId = crypto.randomUUID();
    const contextHash = buildContextHash(state, context);

    const payload: SuggestionRequest = {
      requestId,
      deviceId: deps.deviceId,
      typingContext: redaction.text,
      contextSource: state.contextSource,
      redaction: {
        applied: redaction.redactions.length > 0,
        redactionCount: redaction.redactions.length,
        kinds: [...new Set(redaction.redactions.map((r) => r.kind))],
      },
      activeApplication: state.activeApplication,
      memoryEnabled: true,
      contextHash,
      clientMetadata: {
        appVersion: deps.appVersion,
        platform: deps.platform,
      },
    };

    const parsed = SuggestionRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return null;
    }

    try {
      const response = await http(`${deps.apiBaseUrl}/suggestions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });

      if (!response.ok) {
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
