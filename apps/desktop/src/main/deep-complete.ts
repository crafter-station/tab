import type { Suggestion } from "@tab/contracts";
import type { SuggestionSource } from "./suggestion-source.ts";
import {
  isRequestableTypingContextSnapshot,
  type RequestableTypingContextSnapshot,
  type SafeTypingContextSnapshot,
} from "./typing-context.ts";
import type { TriggerPolicy } from "./trigger-policy.ts";

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
};

export function createDeepComplete(deps: DeepCompleteDependencies) {
  let requestVersion = 0;
  let activeRequest: {
    contextHash: string;
    controller: AbortController;
    request: Promise<Suggestion | null>;
  } | null = null;
  let visibleTimer: ReturnType<typeof setTimeout> | null = null;

  function invalidate(): void {
    requestVersion += 1;
    activeRequest?.controller.abort();
    activeRequest = null;
    if (visibleTimer) clearTimeout(visibleTimer);
    visibleTimer = null;
  }

  function show(
    snapshot: RequestableTypingContextSnapshot,
    suggestion: Suggestion,
    expiresAtMs = Date.now() + (deps.maxVisibleMs ?? 4_000),
  ): Suggestion | null {
    const decision = deps.triggerPolicy?.onSuggestionCandidate(snapshot, suggestion);
    if (decision && !decision.allow) return null;

    const remainingVisibleMs = expiresAtMs - Date.now();
    if (remainingVisibleMs <= 0) return null;
    visibleTimer = setTimeout(() => {
      const current = deps.getContext();
      if (current.contextHash !== snapshot.contextHash) return;
      deps.triggerPolicy?.recordStale(current);
      deps.onSuggestionStale?.(suggestion);
      deps.onHideSuggestion();
      visibleTimer = null;
    }, remainingVisibleMs);
    deps.onShowSuggestion(suggestion, expiresAtMs);
    return suggestion;
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
    const request = (async () => {
      try {
        return await deps.requestCloudSuggestion(snapshot, { signal: controller.signal });
      } catch {
        return null;
      }
    })();
    activeRequest = { contextHash: snapshot.contextHash, controller, request };
    const suggestion = await request;
    if (activeRequest?.controller === controller) activeRequest = null;
    if (requestVersion !== version) return null;

    const latest = deps.getContext();
    if (latest.contextHash !== snapshot.contextHash || !isRequestableTypingContextSnapshot(latest)) return null;
    deps.onRequestFinished?.(suggestion);
    if (!suggestion) return null;
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
    return show(current, suggestion, expiresAtMs) !== null;
  }

  return { requestNow, restore, invalidate };
}
