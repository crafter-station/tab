import type {
  ActiveApplication,
  RecordTelemetryEventRequest,
  Suggestion,
  SuggestionContextSource,
} from "@tabb/contracts";
import { acceptAndInsertSuggestion, type InsertionDependencies } from "./acceptance.ts";
import { createSuggestionLoop } from "./suggestion-loop.ts";
import { createPoliteTriggerPolicy, type TriggerPolicy } from "./trigger-policy.ts";
import {
  createSafeTextSessionSnapshot,
  isReliableTextSessionSnapshot,
  type RequestableTypingContextSnapshot,
  type TextSessionSnapshot,
  type TypingContextBuffer,
  type TypingDeletionUnit,
} from "./typing-context.ts";

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

type RecordInteractionTelemetry = (event: RecordTelemetryEventRequest) => void | Promise<void>;

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
  readonly recordInteractionTelemetry?: RecordInteractionTelemetry;
  readonly triggerPolicy?: TriggerPolicy;
};

type VisibleSuggestionTelemetry = {
  readonly requestId: string;
  readonly activeApplicationBundleId?: string;
  readonly suggestionLength: number;
};

type InteractionTelemetryEventType = RecordTelemetryEventRequest["eventType"];

function activeApplicationKey(app: ActiveApplication | null): string | null {
  if (!app) return null;
  return `${app.bundleId}:${app.windowId ?? "window-unknown"}`;
}

const SUGGESTION_ID_PREFIX = "sg-";

export function createNativeSuggestionSession(deps: NativeSuggestionSessionDependencies) {
  let currentSuggestion: Suggestion | null = null;
  let visibleSuggestionTelemetry: VisibleSuggestionTelemetry | null = null;
  let previouslyActiveApplication: ActiveApplication | null = null;
  let observationPaused = false;
  let textSessionSnapshot: TextSessionSnapshot | null = null;
  const { outputs } = deps;
  const triggerPolicy = deps.triggerPolicy ?? createPoliteTriggerPolicy();

  function requestIdFromSuggestion(suggestion: Suggestion): string {
    if (suggestion.id.startsWith(SUGGESTION_ID_PREFIX)) {
      return suggestion.id.slice(SUGGESTION_ID_PREFIX.length);
    }

    return suggestion.id;
  }

  function buildTelemetry(suggestion: Suggestion): VisibleSuggestionTelemetry {
    const activeApplication = deps.typingContext.getState().activeApplication;
    return {
      requestId: requestIdFromSuggestion(suggestion),
      activeApplicationBundleId: activeApplication?.bundleId,
      suggestionLength: suggestion.text.length,
    };
  }

  function clearVisibleSuggestion(): void {
    currentSuggestion = null;
    visibleSuggestionTelemetry = null;
  }

  function buildTelemetryEvent(
    eventType: InteractionTelemetryEventType,
  ): RecordTelemetryEventRequest | null {
    if (!visibleSuggestionTelemetry) return null;

    const event: RecordTelemetryEventRequest = {
      eventType,
      requestId: visibleSuggestionTelemetry.requestId,
      timestamp: new Date().toISOString(),
      suggestionLength: visibleSuggestionTelemetry.suggestionLength,
    };

    if (visibleSuggestionTelemetry.activeApplicationBundleId) {
      event.activeApplicationBundleId = visibleSuggestionTelemetry.activeApplicationBundleId;
    }

    return event;
  }

  function recordInteractionTelemetry(eventType: InteractionTelemetryEventType): void {
    if (!deps.recordInteractionTelemetry) return;

    const event = buildTelemetryEvent(eventType);
    if (!event) return;

    Promise.resolve(deps.recordInteractionTelemetry(event)).catch(() => {
      // Interaction telemetry is best-effort and must never interrupt typing or acceptance.
    });
  }

  const suggestionLoop = createSuggestionLoop({
    getContext: () => {
      if (textSessionSnapshot) {
        return createSafeTextSessionSnapshot(textSessionSnapshot);
      }

      return deps.typingContext.getSnapshot();
    },
    requestSuggestion: deps.requestSuggestion,
    onShowSuggestion: (suggestion) => {
      currentSuggestion = suggestion;
      visibleSuggestionTelemetry = buildTelemetry(suggestion);
      outputs.showSuggestion(suggestion);
    },
    onHideSuggestion: () => {
      clearVisibleSuggestion();
      outputs.hideOverlay();
    },
    onRequestStarted: outputs.onRequestStarted,
    onRequestFinished: outputs.onRequestFinished,
    onSuggestionStale: () => {
      recordInteractionTelemetry("suggestion_stale");
      clearVisibleSuggestion();
    },
    onSecretLikeContextDetected: () => {
      deps.typingContext.clear();
      outputs.onSecretLikeContextDetected?.();
    },
    debounceMs: deps.debounceMs,
    maxVisibleMs: deps.maxVisibleMs,
    triggerPolicy,
  });

  function contextChanged(): void {
    if (currentSuggestion) {
      triggerPolicy.recordDismissal(currentSafeSnapshot());
      recordInteractionTelemetry("suggestion_dismissed");
    }
    outputs.resetDebugApiState();
    clearVisibleSuggestion();
    outputs.clearSuggestion();
    suggestionLoop.onContextChanged();
    outputs.showDebugContext();
  }

  function setPreviouslyActiveApplication(activeApplication: ActiveApplication | null): void {
    const isTabb = activeApplication?.bundleId.toLowerCase().includes("tabb") ?? false;
    if (activeApplication && !isTabb) {
      previouslyActiveApplication = activeApplication;
    }
  }

  function clearTextSessionSnapshot(): void {
    textSessionSnapshot = null;
  }

  function currentSafeSnapshot() {
    if (textSessionSnapshot) {
      return createSafeTextSessionSnapshot(textSessionSnapshot);
    }

    return deps.typingContext.getSnapshot();
  }

  function clearContext(recordDismissed = true): void {
    if (recordDismissed && currentSuggestion) {
      triggerPolicy.recordDismissal(currentSafeSnapshot());
      recordInteractionTelemetry("suggestion_dismissed");
    }
    clearTextSessionSnapshot();
    deps.typingContext.clear();
    outputs.resetDebugApiState();
    clearVisibleSuggestion();
    suggestionLoop.invalidate();
  }

  return {
    appendText(text: string): void {
      if (observationPaused) return;
      clearTextSessionSnapshot();
      deps.typingContext.appendText(text, deps.getContextSource());
      contextChanged();
    },
    appendPastedText(text: string): void {
      if (observationPaused) return;
      clearTextSessionSnapshot();
      deps.typingContext.appendPastedText(text);
      contextChanged();
    },
    deleteBackward(unit: TypingDeletionUnit = "character"): void {
      if (observationPaused) return;
      clearTextSessionSnapshot();
      deps.typingContext.deleteBackward(unit);
      contextChanged();
    },
    setActiveApplication(bundleId: string | null, windowId: string | null = null): void {
      if (observationPaused) return;
      clearTextSessionSnapshot();

      const activeApplication = bundleId ? { bundleId, ...(windowId ? { windowId } : {}) } : null;
      const previousActiveKey = activeApplicationKey(deps.typingContext.getState().activeApplication);
      const nextActiveKey = activeApplicationKey(activeApplication);

      setPreviouslyActiveApplication(activeApplication);

      if (nextActiveKey === previousActiveKey) {
        return;
      }

      deps.typingContext.setActiveApplication(activeApplication);
      contextChanged();
    },
    setSecureInput(active: boolean): void {
      clearTextSessionSnapshot();
      deps.typingContext.setSecureInput(active);
      contextChanged();
    },
    applyTextSessionSnapshot(snapshot: TextSessionSnapshot): void {
      if (observationPaused) return;
      textSessionSnapshot = isReliableTextSessionSnapshot(snapshot) ? snapshot : null;
      if (textSessionSnapshot) {
        setPreviouslyActiveApplication(textSessionSnapshot.activeApplication);
      }
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
