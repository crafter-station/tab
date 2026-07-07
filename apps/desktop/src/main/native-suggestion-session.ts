import type { ActiveApplication, Suggestion, SuggestionContextSource } from "@tabb/contracts";
import { acceptAndInsertSuggestion, type InsertionDependencies } from "./acceptance.ts";
import { createSuggestionLoop } from "./suggestion-loop.ts";
import type { TypingContextBuffer } from "./typing-context.ts";

export type NativeSuggestionSessionDependencies = {
  readonly typingContext: TypingContextBuffer;
  readonly requestSuggestion: (context: string) => Promise<Suggestion | null>;
  readonly getContextSource: () => SuggestionContextSource;
  readonly showSuggestion: (suggestion: Suggestion) => void;
  readonly clearSuggestion: () => void;
  readonly hideOverlay: () => void;
  readonly showDebugContext: () => void;
  readonly resetDebugApiState: () => void;
  readonly onRequestStarted?: (context: string) => void;
  readonly onRequestFinished?: (suggestion: Suggestion | null) => void;
  readonly onSecretLikeContextDetected?: () => void;
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

  const suggestionLoop = createSuggestionLoop({
    getContext: () => deps.typingContext.getState(),
    requestSuggestion: deps.requestSuggestion,
    onShowSuggestion: (suggestion) => {
      currentSuggestion = suggestion;
      deps.showSuggestion(suggestion);
    },
    onHideSuggestion: () => {
      currentSuggestion = null;
      deps.hideOverlay();
    },
    onRequestStarted: deps.onRequestStarted,
    onRequestFinished: deps.onRequestFinished,
    onSecretLikeContextDetected: () => {
      deps.typingContext.clear();
      deps.onSecretLikeContextDetected?.();
    },
    debounceMs: deps.debounceMs,
    maxVisibleMs: deps.maxVisibleMs,
  });

  function contextChanged(): void {
    deps.resetDebugApiState();
    currentSuggestion = null;
    deps.clearSuggestion();
    suggestionLoop.onContextChanged();
    deps.showDebugContext();
  }

  function clearContext(): void {
    deps.typingContext.clear();
    deps.resetDebugApiState();
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
      deps.resetDebugApiState();
      if (active) {
        clearContext();
      }
      deps.showDebugContext();
    },
    async acceptCurrentSuggestion(): Promise<void> {
      const result = await acceptAndInsertSuggestion(
        deps.createAcceptanceDependencies(
          () => currentSuggestion,
          () => previouslyActiveApplication,
        ),
      );

      if (result === "inserted") {
        deps.hideOverlay();
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
