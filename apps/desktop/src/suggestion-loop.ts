import type { Suggestion, ActiveApplication } from "@tabb/contracts";

export type TypingContextSnapshot = {
  context: string;
  activeApplication: ActiveApplication | null;
  secureInput: boolean;
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
  debounceMs: number;
};

function contextHash(snapshot: TypingContextSnapshot): string {
  return `${snapshot.activeApplication?.bundleId ?? "none"}:${snapshot.context}:${snapshot.secureInput}`;
}

export function createSuggestionLoop(deps: SuggestionLoopDependencies) {
  let state: SuggestionLoopState = { status: "idle" };
  let requestSequence = 0;

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

    if (snapshot.secureInput || snapshot.context.trim().length === 0) {
      invalidate();
      return;
    }

    if (state.status === "showing" && state.contextHash !== hash) {
      invalidate();
    }

    if (state.status === "debouncing") {
      clearTimeout(state.timer);
    }

    const currentSequence = ++requestSequence;

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

        const suggestion = await deps.requestSuggestion(latest.context);

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
