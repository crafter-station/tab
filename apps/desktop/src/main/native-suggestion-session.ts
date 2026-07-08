import type {
  ActiveApplication,
  RecordTelemetryEventRequest,
  Suggestion,
  SuggestionContextSource,
} from "@tab/contracts";
import { acceptAndInsertSuggestion, type InsertionDependencies } from "./acceptance.ts";
import type { AppContextSnapshot } from "./app-context.ts";
import {
  createApplicationCompatibilityStore,
  type ApplicationCompatibilityStore,
} from "./application-compatibility.ts";
import { generateLocalSuggestion } from "./suggestion-engine.ts";
import { createSuggestionLoop, type SuggestionSource } from "./suggestion-loop.ts";
import { createPoliteTriggerPolicy, type TriggerPolicy } from "./trigger-policy.ts";
import {
  createSafeTextSessionSnapshot,
  isPrivateTextSessionSnapshot,
  isReliableTextSessionSnapshot,
  type RequestableTypingContextSnapshot,
  type SafeTypingContextSnapshot,
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
  readonly getLocalSuggestion?: SuggestionSource;
  readonly requestSuggestion: SuggestionSource;
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
  readonly compatibilityStore?: ApplicationCompatibilityStore;
  readonly getAppContext?: (snapshot: SafeTypingContextSnapshot) => AppContextSnapshot;
  readonly clearAppContext?: () => void;
};

type VisibleSuggestionTelemetry = {
  readonly requestId: string;
  readonly activeApplicationBundleId?: string;
  readonly suggestionLength: number;
  readonly visibleSinceMs: number;
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
  let visibleTextSessionTarget: TextSessionSnapshot | null = null;
  let lastContextHash: string | null = null;
  const { outputs } = deps;
  const compatibilityStore = deps.compatibilityStore ?? createApplicationCompatibilityStore();
  const triggerPolicy = deps.triggerPolicy ?? createPoliteTriggerPolicy({ compatibilityStore });

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
      visibleSinceMs: Date.now(),
    };
  }

  function interactionLatencyMs(telemetry: VisibleSuggestionTelemetry): number {
    return Math.max(0, Date.now() - telemetry.visibleSinceMs);
  }

  function clearVisibleSuggestion(): void {
    currentSuggestion = null;
    visibleTextSessionTarget = null;
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
      latencyMs: interactionLatencyMs(visibleSuggestionTelemetry),
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

  function recordDismissal(snapshot: SafeTypingContextSnapshot): void {
    compatibilityStore.recordDismissal(snapshot);
    triggerPolicy.recordDismissal(snapshot);
    recordInteractionTelemetry("suggestion_dismissed");
  }

  const suggestionLoop = createSuggestionLoop({
    getContext: () => currentSafeSnapshot(),
    getLocalSuggestion: deps.getLocalSuggestion ?? ((snapshot) => generateLocalSuggestion(snapshot.sanitizedContext)),
    requestSuggestion: deps.requestSuggestion,
    onShowSuggestion: (suggestion) => {
      currentSuggestion = suggestion;
      visibleTextSessionTarget = currentSafeSnapshot().textSession ?? null;
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
      compatibilityStore.recordStale(currentSafeSnapshot());
      recordInteractionTelemetry("suggestion_stale");
      clearVisibleSuggestion();
    },
    onSecretLikeContextDetected: () => {
      deps.clearAppContext?.();
      deps.typingContext.clear();
      outputs.onSecretLikeContextDetected?.();
    },
    debounceMs: deps.debounceMs,
    maxVisibleMs: deps.maxVisibleMs,
    triggerPolicy,
  });

  function contextChanged(options: { suppressUnchangedTextSession?: boolean } = {}): void {
    const snapshot = currentSafeSnapshot();
    if (options.suppressUnchangedTextSession && snapshot.contextHash === lastContextHash) {
      return;
    }
    lastContextHash = snapshot.contextHash;

    if (currentSuggestion) {
      recordDismissal(snapshot);
    }
    outputs.resetDebugApiState();
    clearVisibleSuggestion();
    outputs.clearSuggestion();
    suggestionLoop.onContextChanged();
    outputs.showDebugContext();
  }

  function setPreviouslyActiveApplication(activeApplication: ActiveApplication | null): void {
    const isTab = activeApplication?.bundleId.toLowerCase().includes("tab") ?? false;
    if (activeApplication && !isTab) {
      previouslyActiveApplication = activeApplication;
    }
  }

  function clearTextSessionSnapshot(): void {
    textSessionSnapshot = null;
  }

  function invalidateVisibleSuggestionWithoutContextChange(): void {
    if (!currentSuggestion) return;

    recordDismissal(currentSafeSnapshot());
    outputs.resetDebugApiState();
    outputs.clearSuggestion();
    suggestionLoop.invalidate();
    clearVisibleSuggestion();
    outputs.showDebugContext();
  }

  function withAppContext(snapshot: SafeTypingContextSnapshot): SafeTypingContextSnapshot {
    if (!snapshot.requestable || !deps.getAppContext) {
      return snapshot;
    }

    const appContext = deps.getAppContext(snapshot);
    compatibilityStore.recordAppContextSnapshot(snapshot.activeApplication, appContext);
    if (appContext.metadata.status !== "available" || appContext.fragments.length === 0) {
      return snapshot;
    }

    return { ...snapshot, appContext };
  }

  function currentSafeSnapshot(): SafeTypingContextSnapshot {
    const snapshot = textSessionSnapshot
      ? createSafeTextSessionSnapshot(textSessionSnapshot)
      : deps.typingContext.getSnapshot();

    return withAppContext(snapshot);
  }

  function clearContext(recordDismissed = true): void {
    if (recordDismissed && currentSuggestion) {
      recordDismissal(currentSafeSnapshot());
    }
    lastContextHash = null;
    clearTextSessionSnapshot();
    deps.clearAppContext?.();
    deps.typingContext.clear();
    outputs.resetDebugApiState();
    clearVisibleSuggestion();
    suggestionLoop.invalidate();
  }

  return {
    appendText(text: string): void {
      if (observationPaused) return;
      if (textSessionSnapshot) {
        invalidateVisibleSuggestionWithoutContextChange();
        return;
      }
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

      deps.clearAppContext?.();
      deps.typingContext.setActiveApplication(activeApplication);
      contextChanged();
    },
    setSecureInput(active: boolean): void {
      clearTextSessionSnapshot();
      if (active) {
        deps.clearAppContext?.();
      }
      deps.typingContext.setSecureInput(active);
      contextChanged();
    },
    applyTextSessionSnapshot(snapshot: TextSessionSnapshot): void {
      if (observationPaused) return;
      compatibilityStore.recordTextSessionSnapshot(snapshot);
      textSessionSnapshot = isReliableTextSessionSnapshot(snapshot) ? snapshot : null;
      if (textSessionSnapshot) {
        setPreviouslyActiveApplication(textSessionSnapshot.activeApplication);
        if (isPrivateTextSessionSnapshot(textSessionSnapshot)) {
          deps.clearAppContext?.();
          deps.typingContext.clear();
        }
      }
      contextChanged({ suppressUnchangedTextSession: true });
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
      const insertionDeps = deps.createAcceptanceDependencies(
        () => currentSuggestion,
        () => previouslyActiveApplication,
      );
      const result = await acceptAndInsertSuggestion({
        ...insertionDeps,
        getVisibleTextSessionTarget: () => visibleTextSessionTarget,
        getCurrentTextSessionTarget: () => textSessionSnapshot,
        shouldPreferClipboardFallback: (targetApp) => compatibilityStore.shouldPreferClipboardInsertion(targetApp),
        recordInsertionOutcome: (strategy, outcome, targetApp) => {
          compatibilityStore.recordInsertionOutcome(targetApp, strategy, outcome);
        },
      });

      if (result === "inserted") {
        compatibilityStore.recordAcceptance(currentSafeSnapshot());
        recordInteractionTelemetry("suggestion_accepted");
        outputs.hideOverlay();
        clearContext(false);
      }
    },
    async requestSuggestionNow(): Promise<void> {
      if (observationPaused) return;
      if (currentSuggestion) {
        recordDismissal(currentSafeSnapshot());
      }
      outputs.resetDebugApiState();
      clearVisibleSuggestion();
      outputs.clearSuggestion();
      await suggestionLoop.requestCloudSuggestionNow();
      outputs.showDebugContext();
    },
    clearContext,
    getCurrentSuggestion: () => currentSuggestion,
    getCurrentSnapshot: () => currentSafeSnapshot(),
    getPreviouslyActiveApplication: () => previouslyActiveApplication,
    isPaused: () => observationPaused,
    getLoopState: () => suggestionLoop.getState(),
  };
}
