import type { Suggestion, ActiveApplication } from "@tabb/contracts";
import { createSafeTypingContextSnapshot, type SafeTypingContextSnapshot } from "./typing-context.ts";

export type TypingContextSnapshot = {
  context: string;
  activeApplication: ActiveApplication | null;
  secureInput: boolean;
  paused?: boolean;
  privateContext?: boolean;
  contextSource?: SafeTypingContextSnapshot["contextSource"];
  memoryEligible?: boolean;
};

export type SuggestionLoopState =
  | { status: "idle" }
  | { status: "debouncing"; timer: ReturnType<typeof setTimeout>; contextHash: string }
  | { status: "showing"; suggestion: Suggestion; contextHash: string; expiryTimer: ReturnType<typeof setTimeout> };

export type SuggestionLoopDependencies = {
  getContext(): TypingContextSnapshot;
  requestSuggestion(context: string): Promise<Suggestion | null>;
  onShowSuggestion(suggestion: Suggestion): void;
  onHideSuggestion(): void;
  onRequestStarted?: (context: string) => void;
  onRequestFinished?: (suggestion: Suggestion | null) => void;
  onSecretLikeContextDetected?: () => void;
  debounceMs: number;
  maxVisibleMs?: number;
};

function safeSnapshot(snapshot: TypingContextSnapshot): SafeTypingContextSnapshot {
  if ("requestable" in snapshot && "sanitizedContext" in snapshot && "contextHash" in snapshot) {
    return snapshot as SafeTypingContextSnapshot;
  }

  return createSafeTypingContextSnapshot({
    context: snapshot.context,
    activeApplication: snapshot.activeApplication,
    secureInput: snapshot.secureInput,
    paused: snapshot.paused ?? false,
    privateContext: snapshot.privateContext ?? false,
    contextSource: snapshot.contextSource ?? "typed_text",
    memoryEligible: snapshot.memoryEligible ?? true,
  });
}

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
    const snapshot = safeSnapshot(deps.getContext());
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

        const latest = safeSnapshot(deps.getContext());
        if (latest.contextHash !== hash) {
          state = { status: "idle" };
          return;
        }

        deps.onRequestStarted?.(latest.sanitizedContext);
        const suggestion = await deps.requestSuggestion(latest.sanitizedContext);

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
