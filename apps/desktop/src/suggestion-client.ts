import {
  ApiResponseSchema,
  SuggestionRequestSchema,
  type Suggestion,
  type SuggestionRequest,
} from "@tabb/contracts";
import { redactSensitiveText } from "@tabb/redaction";
import type { TypingContextState } from "./typing-context.ts";

type ActiveTypingContextState = TypingContextState & {
  activeApplication: NonNullable<TypingContextState["activeApplication"]>;
};

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

function buildSuggestionRequest(
  deps: ApiSuggestionClientDependencies,
  state: ActiveTypingContextState,
  context: string,
): SuggestionRequest {
  const redaction = redactSensitiveText(context);

  return {
    requestId: crypto.randomUUID(),
    deviceId: deps.deviceId,
    typingContext: redaction.text,
    contextSource: state.contextSource,
    redaction: {
      applied: redaction.redactions.length > 0,
      redactionCount: redaction.redactions.length,
      kinds: [...new Set(redaction.redactions.map((redaction) => redaction.kind))],
    },
    activeApplication: state.activeApplication,
    memoryEnabled: true,
    contextHash: buildContextHash(state, context),
    clientMetadata: {
      appVersion: deps.appVersion,
      platform: deps.platform,
    },
  };
}

export function createApiSuggestionClient(deps: ApiSuggestionClientDependencies) {
  const http = deps.fetch ?? globalThis.fetch;

  return async function requestSuggestion(context: string): Promise<Suggestion | null> {
    const state = deps.getState();

    if (!state.activeApplication) {
      return null;
    }

    const payload = buildSuggestionRequest(
      deps,
      { ...state, activeApplication: state.activeApplication },
      context,
    );
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
