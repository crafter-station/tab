import type { Suggestion } from "@tabb/contracts";
import {
  isRequestableTypingContextSnapshot,
  type RequestableTypingContextSnapshot,
  type SafeTypingContextSnapshot,
} from "./typing-context.ts";

export type SuggestionLoopState =
  | { status: "idle" }
  | { status: "debouncing"; timer: ReturnType<typeof setTimeout>; contextHash: string }
  | { status: "showing"; suggestion: Suggestion; contextHash: string; expiryTimer: ReturnType<typeof setTimeout> };

export type SuggestionLoopDependencies = {
  getContext(): SafeTypingContextSnapshot;
  requestSuggestion(snapshot: RequestableTypingContextSnapshot): Promise<Suggestion | null>;
  onShowSuggestion(suggestion: Suggestion): void;
  onHideSuggestion(): void;
  onRequestStarted?: (context: string) => void;
  onRequestFinished?: (suggestion: Suggestion | null) => void;
  onSecretLikeContextDetected?: () => void;
  debounceMs: number;
  maxVisibleMs?: number;
};

export function createSuggestionLoop(deps: SuggestionLoopDependencies) {
  let state: SuggestionLoopState = { status: "idle" };

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
        if (state.status !== "debouncing" || state.contextHash !== hash) {
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

        deps.onRequestStarted?.(latest.sanitizedContext);
        const suggestion = await deps.requestSuggestion(latest);

        if (state.status !== "debouncing" || state.contextHash !== hash) {
          return;
        }

        deps.onRequestFinished?.(suggestion);

        if (!suggestion) {
          state = { status: "idle" };
          return;
        }

        const expiryTimer = setTimeout(() => {
          if (state.status !== "showing" || state.contextHash !== hash) {
            return;
          }
          deps.onHideSuggestion();
          state = { status: "idle" };
        }, deps.maxVisibleMs ?? 4_000);

        state = { status: "showing", suggestion, contextHash: hash, expiryTimer };
        deps.onShowSuggestion(suggestion);
      }, deps.debounceMs),
    };
  }

  return {
    onContextChanged,
    invalidate,
    getState: () => state,
  };
}
