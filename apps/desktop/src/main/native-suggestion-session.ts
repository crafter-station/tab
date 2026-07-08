import type {
  ActiveApplication,
  RecordTelemetryEventRequest,
  Suggestion,
  SuggestionContextSource,
} from "@tabb/contracts";
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
  readonly recordInteractionTelemetry?: (event: RecordTelemetryEventRequest) => void | Promise<void>;
};

type VisibleSuggestionTelemetry = {
  readonly requestId: string;
  readonly activeApplicationBundleId?: string;
  readonly suggestionLength: number;
};

function activeApplicationKey(app: ActiveApplication | null): string | null {
  if (!app) return null;
  return `${app.bundleId}:${app.windowId ?? "window-unknown"}`;
}

export function createNativeSuggestionSession(deps: NativeSuggestionSessionDependencies) {
  let currentSuggestion: Suggestion | null = null;
  let currentTelemetry: VisibleSuggestionTelemetry | null = null;
  let previouslyActiveApplication: ActiveApplication | null = null;
  let observationPaused = false;
  const { outputs } = deps;

  function requestIdFromSuggestion(suggestion: Suggestion): string {
    return suggestion.id.startsWith("sg-") ? suggestion.id.slice(3) : suggestion.id;
  }

  function buildTelemetry(suggestion: Suggestion): VisibleSuggestionTelemetry {
    const activeApplication = deps.typingContext.getState().activeApplication;
    return {
      requestId: requestIdFromSuggestion(suggestion),
      activeApplicationBundleId: activeApplication?.bundleId,
      suggestionLength: suggestion.text.length,
    };
  }

  function recordInteractionTelemetry(eventType: RecordTelemetryEventRequest["eventType"]): void {
    if (!currentTelemetry || !deps.recordInteractionTelemetry) return;

    const event: RecordTelemetryEventRequest = {
      eventType,
      requestId: currentTelemetry.requestId,
      timestamp: new Date().toISOString(),
      ...(currentTelemetry.activeApplicationBundleId
        ? { activeApplicationBundleId: currentTelemetry.activeApplicationBundleId }
        : {}),
      suggestionLength: currentTelemetry.suggestionLength,
    };

    Promise.resolve(deps.recordInteractionTelemetry(event)).catch(() => {
      // Interaction telemetry is best-effort and must never interrupt typing or Acceptance.
    });
  }

  const suggestionLoop = createSuggestionLoop({
    getContext: () => deps.typingContext.getSnapshot(),
    requestSuggestion: deps.requestSuggestion,
    onShowSuggestion: (suggestion) => {
      currentSuggestion = suggestion;
      currentTelemetry = buildTelemetry(suggestion);
      outputs.showSuggestion(suggestion);
    },
    onHideSuggestion: () => {
      currentSuggestion = null;
      currentTelemetry = null;
      outputs.hideOverlay();
    },
    onRequestStarted: outputs.onRequestStarted,
    onRequestFinished: outputs.onRequestFinished,
    onSuggestionStale: () => {
      recordInteractionTelemetry("suggestion_stale");
      currentSuggestion = null;
      currentTelemetry = null;
    },
    onSecretLikeContextDetected: () => {
      deps.typingContext.clear();
      outputs.onSecretLikeContextDetected?.();
    },
    debounceMs: deps.debounceMs,
    maxVisibleMs: deps.maxVisibleMs,
  });

  function contextChanged(): void {
    if (currentSuggestion) {
      recordInteractionTelemetry("suggestion_dismissed");
    }
    outputs.resetDebugApiState();
    currentSuggestion = null;
    currentTelemetry = null;
    outputs.clearSuggestion();
    suggestionLoop.onContextChanged();
    outputs.showDebugContext();
  }

  function clearContext(recordDismissed = true): void {
    if (recordDismissed && currentSuggestion) {
      recordInteractionTelemetry("suggestion_dismissed");
    }
    deps.typingContext.clear();
    outputs.resetDebugApiState();
    currentSuggestion = null;
    currentTelemetry = null;
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
        recordInteractionTelemetry("suggestion_accepted");
        outputs.hideOverlay();
        clearContext(false);
      }
    },
    clearContext,
    getCurrentSuggestion: () => currentSuggestion,
    getPreviouslyActiveApplication: () => previouslyActiveApplication,
    isPaused: () => observationPaused,
    getLoopState: () => suggestionLoop.getState(),
  };
}
