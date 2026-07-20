import type { Suggestion } from "@tab/contracts";
import type { SuggestionSource } from "./suggestion-source.ts";
import {
  isRequestableTypingContextSnapshot,
  type RequestableTypingContextSnapshot,
  type SafeTypingContextSnapshot,
} from "./typing-context.ts";
import type { TriggerPolicy } from "./trigger-policy.ts";
import { createSuggestionPresentation } from "./suggestion-presentation.ts";

export type DeepCompleteDependencies = {
  getContext(): SafeTypingContextSnapshot;
  requestCloudSuggestion: SuggestionSource;
  onShowSuggestion(suggestion: Suggestion, expiresAtMs: number): void;
  onHideSuggestion(): void;
  onSuggestionStale?: (suggestion: Suggestion) => void;
  onRequestStarted?: (context: string) => void;
  onRequestFinished?: (suggestion: Suggestion | null) => void;
  onSecretLikeContextDetected?: () => void;
  triggerPolicy?: TriggerPolicy;
  maxVisibleMs?: number;
  onDiagnostic?: (diagnostic: DeepCompleteDiagnostic) => void;
};

export type DeepCompleteDiagnostic =
  | { readonly stage: "cloud-request-started" }
  | { readonly stage: "cloud-request-outcome"; readonly outcome: "suggestion" | "empty" | "failed" }
  | { readonly stage: "overlay-presentation"; readonly outcome: "presented" | "suppressed" };

export function createDeepComplete(deps: DeepCompleteDependencies) {
  let requestVersion = 0;
  let activeRequest: {
    contextHash: string;
    controller: AbortController;
    request: Promise<Suggestion | null>;
  } | null = null;
  const presentation = createSuggestionPresentation(deps);

  function invalidate(): void {
    requestVersion += 1;
    activeRequest?.controller.abort();
    activeRequest = null;
    presentation.clear(false);
  }

  function show(
    snapshot: RequestableTypingContextSnapshot,
    suggestion: Suggestion,
    expiresAtMs = Date.now() + (deps.maxVisibleMs ?? 4_000),
  ): Suggestion | null {
    const presented = presentation.present(snapshot, suggestion, expiresAtMs) !== null;
    deps.onDiagnostic?.({
      stage: "overlay-presentation",
      outcome: presented ? "presented" : "suppressed",
    });
    return presented ? suggestion : null;
  }

  async function requestNow(): Promise<Suggestion | null> {
    const snapshot = deps.getContext();
    if (!isRequestableTypingContextSnapshot(snapshot)) {
      if (snapshot.suppressionReason === "secret_like_context") deps.onSecretLikeContextDetected?.();
      invalidate();
      return null;
    }

    if (activeRequest?.contextHash === snapshot.contextHash) return activeRequest.request;

    invalidate();
    const version = requestVersion;
    const controller = new AbortController();
    deps.onRequestStarted?.(snapshot.sanitizedContext);
    deps.onDiagnostic?.({ stage: "cloud-request-started" });
    const request = (async () => {
      try {
        const suggestion = await deps.requestCloudSuggestion(snapshot, { signal: controller.signal });
        deps.onDiagnostic?.({
          stage: "cloud-request-outcome",
          outcome: suggestion ? "suggestion" : "empty",
        });
        return suggestion;
      } catch {
        deps.onDiagnostic?.({ stage: "cloud-request-outcome", outcome: "failed" });
        return null;
      }
    })();
    activeRequest = { contextHash: snapshot.contextHash, controller, request };
    const suggestion = await request;
    if (activeRequest?.controller === controller) activeRequest = null;
    if (requestVersion !== version) {
      deps.onDiagnostic?.({ stage: "overlay-presentation", outcome: "suppressed" });
      return null;
    }

    const latest = deps.getContext();
    if (latest.contextHash !== snapshot.contextHash || !isRequestableTypingContextSnapshot(latest)) {
      deps.onDiagnostic?.({ stage: "overlay-presentation", outcome: "suppressed" });
      return null;
    }
    deps.onRequestFinished?.(suggestion);
    if (!suggestion) {
      deps.onDiagnostic?.({ stage: "overlay-presentation", outcome: "suppressed" });
      return null;
    }
    return show(latest, suggestion);
  }

  function restore(suggestion: Suggestion, contextHash: string, expiresAtMs: number): boolean {
    const current = deps.getContext();
    if (
      current.contextHash !== contextHash ||
      !isRequestableTypingContextSnapshot(current)
    ) {
      return false;
    }

    invalidate();
    return presentation.restore(suggestion, contextHash, expiresAtMs) !== null;
  }

  return { requestNow, restore, invalidate };
}
