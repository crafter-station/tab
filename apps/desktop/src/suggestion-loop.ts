import type { Suggestion, ActiveApplication } from "@tabb/contracts";
import { redactSensitiveText } from "@tabb/redaction";

export type TypingContextSnapshot = {
  context: string;
  activeApplication: ActiveApplication | null;
  secureInput: boolean;
  paused?: boolean;
  privateContext?: boolean;
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

function contextHash(snapshot: TypingContextSnapshot): string {
  return `${snapshot.activeApplication?.bundleId ?? "none"}:${snapshot.activeApplication?.windowId ?? "window-unknown"}:${snapshot.context}:${snapshot.secureInput}`;
}

function shouldSuppressSuggestions(snapshot: TypingContextSnapshot): boolean {
  return Boolean(
    snapshot.secureInput ||
      snapshot.paused ||
      snapshot.privateContext ||
      snapshot.context.trim().length === 0,
  );
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
    const snapshot = deps.getContext();
    const hash = contextHash(snapshot);

    if (shouldSuppressSuggestions(snapshot)) {
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
        if (contextHash(latest) !== hash) {
          state = { status: "idle" };
          return;
        }

        // Redact obvious secrets locally before any suggestion request can be
        // sent to an API. If secret-like values are detected, treat this as
        // secret-like context detection per ADR-0018 and suppress the request.
        const redaction = redactSensitiveText(latest.context);
        if (redaction.redactions.length > 0) {
          deps.onSecretLikeContextDetected?.();
          invalidate();
          return;
        }

        deps.onRequestStarted?.(redaction.text);
        const suggestion = await deps.requestSuggestion(redaction.text);

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
