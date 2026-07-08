import type { ActiveApplication, Suggestion, SuggestionContextSource } from "@tabb/contracts";
import { acceptAndInsertSuggestion, type InsertionDependencies } from "./acceptance.ts";
import { createSuggestionLoop } from "./suggestion-loop.ts";
import type { RequestableTypingContextSnapshot, TypingContextBuffer, TypingDeletionUnit } from "./typing-context.ts";

export type NativeSuggestionSessionOutputs = {
  readonly showSuggestion: (suggestion: Suggestion) => void;
  readonly clearSuggestion: () => void;
  readonly hideOverlay: () => void;
  readonly showDebugContext: () => void;
  readonly resetDebugApiState: () => void;
  readonly onRequestStarted?: (context: string) => void;
  readonly onRequestFinished?: (suggestion: Suggestion | null) => void;
  readonly onSecretLikeContextDetected?: () => void;
};

export type NativeSuggestionSessionDependencies = {
  readonly typingContext: TypingContextBuffer;
  readonly requestSuggestion: (snapshot: RequestableTypingContextSnapshot) => Promise<Suggestion | null>;
  readonly getContextSource: () => SuggestionContextSource;
  readonly outputs: NativeSuggestionSessionOutputs;
  readonly createAcceptanceDependencies: (
    getCurrentSuggestion: () => Suggestion | null,
    getPreviouslyActiveApplication: () => ActiveApplication | null,
  ) => InsertionDependencies;
  readonly debounceMs: number;
  readonly maxVisibleMs?: number;
};

function activeApplicationKey(app: ActiveApplication | null): string | null {
  if (!app) return null;
  return `${app.bundleId}:${app.windowId ?? "window-unknown"}`;
}

export function createNativeSuggestionSession(deps: NativeSuggestionSessionDependencies) {
  let currentSuggestion: Suggestion | null = null;
  let previouslyActiveApplication: ActiveApplication | null = null;
  let observationPaused = false;
  const { outputs } = deps;

  const suggestionLoop = createSuggestionLoop({
    getContext: () => deps.typingContext.getSnapshot(),
    requestSuggestion: deps.requestSuggestion,
    onShowSuggestion: (suggestion) => {
      currentSuggestion = suggestion;
      outputs.showSuggestion(suggestion);
    },
    onHideSuggestion: () => {
      currentSuggestion = null;
      outputs.hideOverlay();
    },
    onRequestStarted: outputs.onRequestStarted,
    onRequestFinished: outputs.onRequestFinished,
    onSecretLikeContextDetected: () => {
      deps.typingContext.clear();
      outputs.onSecretLikeContextDetected?.();
    },
    debounceMs: deps.debounceMs,
    maxVisibleMs: deps.maxVisibleMs,
  });

  function contextChanged(): void {
    outputs.resetDebugApiState();
    currentSuggestion = null;
    outputs.clearSuggestion();
    suggestionLoop.onContextChanged();
    outputs.showDebugContext();
  }

  function clearContext(): void {
    deps.typingContext.clear();
    outputs.resetDebugApiState();
    currentSuggestion = null;
    suggestionLoop.invalidate();
  }

  return {
    appendText(text: string): void {
      if (observationPaused) return;
      deps.typingContext.appendText(text, deps.getContextSource());
      contextChanged();
    },
    appendPastedText(text: string): void {
      if (observationPaused) return;
      deps.typingContext.appendPastedText(text);
      contextChanged();
    },
    deleteBackward(unit: TypingDeletionUnit = "character"): void {
      if (observationPaused) return;
      deps.typingContext.deleteBackward(unit);
      contextChanged();
    },
    setActiveApplication(bundleId: string | null, windowId: string | null = null): void {
      if (observationPaused) return;

      const activeApplication = bundleId ? { bundleId, ...(windowId ? { windowId } : {}) } : null;
      const previousActiveKey = activeApplicationKey(deps.typingContext.getState().activeApplication);
      const nextActiveKey = activeApplicationKey(activeApplication);

      const isTabb = bundleId?.toLowerCase().includes("tabb") ?? false;
      if (activeApplication && !isTabb) {
        previouslyActiveApplication = activeApplication;
      }

      if (nextActiveKey === previousActiveKey) {
        return;
      }

      deps.typingContext.setActiveApplication(activeApplication);
      contextChanged();
    },
    setSecureInput(active: boolean): void {
      deps.typingContext.setSecureInput(active);
      contextChanged();
    },
    setPaused(active: boolean): void {
      observationPaused = active;
      deps.typingContext.setPaused(active);
      outputs.resetDebugApiState();
      if (active) {
        clearContext();
      }
      outputs.showDebugContext();
    },
    async acceptCurrentSuggestion(): Promise<void> {
      const result = await acceptAndInsertSuggestion(
        deps.createAcceptanceDependencies(
          () => currentSuggestion,
          () => previouslyActiveApplication,
        ),
      );

      if (result === "inserted") {
        outputs.hideOverlay();
        clearContext();
      }
    },
    clearContext,
    getCurrentSuggestion: () => currentSuggestion,
    getPreviouslyActiveApplication: () => previouslyActiveApplication,
    isPaused: () => observationPaused,
    getLoopState: () => suggestionLoop.getState(),
  };
}
