import type { Suggestion } from "@tabb/contracts";
import {
  isRequestableTypingContextSnapshot,
  type RequestableTypingContextSnapshot,
  type SafeTypingContextSnapshot,
} from "./typing-context.ts";
import type { TriggerPolicy } from "./trigger-policy.ts";

export type SuggestionLoopState =
  | { status: "idle" }
  | { status: "debouncing"; timer: ReturnType<typeof setTimeout>; contextHash: string }
  | { status: "showing"; suggestion: Suggestion; contextHash: string; expiryTimer: ReturnType<typeof setTimeout> };

export type SuggestionLoopDependencies = {
  getContext(): SafeTypingContextSnapshot;
  getLocalSuggestion?(snapshot: RequestableTypingContextSnapshot): Promise<Suggestion | null> | Suggestion | null;
  requestSuggestion(snapshot: RequestableTypingContextSnapshot): Promise<Suggestion | null>;
  onShowSuggestion(suggestion: Suggestion): void;
  onHideSuggestion(): void;
  onRequestStarted?: (context: string) => void;
  onRequestFinished?: (suggestion: Suggestion | null) => void;
  onSuggestionStale?: (suggestion: Suggestion) => void;
  onSecretLikeContextDetected?: () => void;
  triggerPolicy?: TriggerPolicy;
  debounceMs: number;
  maxVisibleMs?: number;
};

export function createSuggestionLoop(deps: SuggestionLoopDependencies) {
  let state: SuggestionLoopState = { status: "idle" };

  function isCurrentDebouncedContext(hash: string): boolean {
    return state.status === "debouncing" && state.contextHash === hash;
  }

  function tryShowSuggestion(
    snapshot: RequestableTypingContextSnapshot,
    suggestion: Suggestion,
    hash: string,
  ): void {
    const showDecision = deps.triggerPolicy?.onSuggestionCandidate(snapshot, suggestion);
    if (showDecision && !showDecision.allow) {
      state = { status: "idle" };
      return;
    }

    const expiryTimer = setTimeout(() => {
      if (state.status !== "showing" || state.contextHash !== hash) {
        return;
      }
      deps.triggerPolicy?.recordStale(deps.getContext());
      deps.onSuggestionStale?.(state.suggestion);
      deps.onHideSuggestion();
      state = { status: "idle" };
    }, deps.maxVisibleMs ?? 4_000);

    state = { status: "showing", suggestion, contextHash: hash, expiryTimer };
    deps.onShowSuggestion(suggestion);
  }

  async function getLocalSuggestion(snapshot: RequestableTypingContextSnapshot): Promise<Suggestion | null> {
    if (!deps.getLocalSuggestion) return null;

    try {
      return await deps.getLocalSuggestion(snapshot);
    } catch {
      return null;
    }
  }

  function hideIfShowing(): void {
    if (state.status === "showing") {
      clearTimeout(state.expiryTimer);
      deps.onHideSuggestion();
    }
  }

  function invalidate(): void {
    if (state.status === "debouncing") {
      clearTimeout(state.timer);
    }
    hideIfShowing();
    state = { status: "idle" };
  }

  function onContextChanged(): void {
    const snapshot = deps.getContext();
    const hash = snapshot.contextHash;

    if (!snapshot.requestable) {
      if (snapshot.suppressionReason === "secret_like_context") {
        deps.onSecretLikeContextDetected?.();
      }
      invalidate();
      return;
    }

    const triggerDecision = deps.triggerPolicy?.onContextChanged(snapshot);
    if (triggerDecision && !triggerDecision.allow) {
      invalidate();
      return;
    }

    if (state.status === "showing" && state.contextHash !== hash) {
      invalidate();
    }

    if (state.status === "debouncing") {
      clearTimeout(state.timer);
    }

    state = {
      status: "debouncing",
      contextHash: hash,
      timer: setTimeout(async () => {
        if (!isCurrentDebouncedContext(hash)) {
          return;
        }

        const latest = deps.getContext();
        if (latest.contextHash !== hash) {
          state = { status: "idle" };
          return;
        }

        if (!isRequestableTypingContextSnapshot(latest)) {
          state = { status: "idle" };
          return;
        }

        const localSuggestion = await getLocalSuggestion(latest);
        if (!isCurrentDebouncedContext(hash)) {
          return;
        }

        if (localSuggestion) {
          tryShowSuggestion(latest, localSuggestion, hash);
          return;
        }

        deps.onRequestStarted?.(latest.sanitizedContext);
        const suggestion = await deps.requestSuggestion(latest);

        if (!isCurrentDebouncedContext(hash)) {
          return;
        }

        deps.onRequestFinished?.(suggestion);

        if (!suggestion) {
          state = { status: "idle" };
          return;
        }

        tryShowSuggestion(latest, suggestion, hash);
      }, deps.debounceMs),
    };
  }

  return {
    onContextChanged,
    invalidate,
    getState: () => state,
  };
}
