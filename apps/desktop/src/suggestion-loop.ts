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
  | { status: "showing"; suggestion: Suggestion; contextHash: string };

export type SuggestionLoopDependencies = {
  getContext(): TypingContextSnapshot;
  requestSuggestion(context: string): Promise<Suggestion | null>;
  onShowSuggestion(suggestion: Suggestion): void;
  onHideSuggestion(): void;
  onSecretLikeContextDetected?: () => void;
  debounceMs: number;
};

function contextHash(snapshot: TypingContextSnapshot): string {
  return `${snapshot.activeApplication?.bundleId ?? "none"}:${snapshot.context}:${snapshot.secureInput}`;
}

export function createSuggestionLoop(deps: SuggestionLoopDependencies) {
  let state: SuggestionLoopState = { status: "idle" };

  function hideIfShowing(): void {
    if (state.status === "showing") {
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

    if (
      snapshot.secureInput ||
      snapshot.paused ||
      snapshot.privateContext ||
      snapshot.context.trim().length === 0
    ) {
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

        const suggestion = await deps.requestSuggestion(redaction.text);

        if (state.status !== "debouncing" || state.contextHash !== hash) {
          return;
        }

        if (!suggestion) {
          state = { status: "idle" };
          return;
        }

        state = { status: "showing", suggestion, contextHash: hash };
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
