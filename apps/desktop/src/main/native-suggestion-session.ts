import type {
  ActiveApplication,
  RecordTelemetryEventRequest,
  Suggestion,
  SuggestionContextSource,
} from "@tab/contracts";
import { acceptAndInsertSuggestion, type InsertionDependencies } from "./acceptance.ts";
import type { AppContextSnapshot } from "./app-context.ts";
import { createHash } from "node:crypto";
import type { AppContextSnapshotState } from "./app-context-extractor.ts";
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
  readonly setSuggestionLoading?: (loading: boolean) => void;
  readonly onRequestStarted?: (context: string) => void;
  readonly onRequestFinished?: (suggestion: Suggestion | null) => void;
  readonly onSecretLikeContextDetected?: () => void;
};

type RecordInteractionTelemetry = (event: RecordTelemetryEventRequest) => void | Promise<void>;

export type NativeSuggestionSessionDependencies = {
  readonly typingContext: TypingContextBuffer;
  readonly getLocalSuggestion?: SuggestionSource;
  readonly fallbackToCloudOnLocalMiss?: boolean;
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
  readonly localSuggestionModelId?: string;
  readonly triggerPolicy?: TriggerPolicy;
  readonly onSuggestionDiagnostic?: (event: string, details: Record<string, unknown>) => void;
  readonly compatibilityStore?: ApplicationCompatibilityStore;
  readonly getAppContext?: (snapshot: SafeTypingContextSnapshot) => AppContextSnapshot;
  readonly getAppContextState?: (snapshot: SafeTypingContextSnapshot) => AppContextSnapshotState;
  readonly clearAppContext?: () => void;
  readonly appContextGraceMs?: number;
};

type VisibleSuggestionTelemetry = {
  readonly requestId: string;
  readonly activeApplicationBundleId?: string;
  readonly suggestionLength: number;
  readonly visibleSinceMs: number;
  readonly modelId?: string;
};

type InteractionTelemetryEventType = RecordTelemetryEventRequest["eventType"];

function activeApplicationKey(app: ActiveApplication | null): string | null {
  if (!app) return null;
  return `${app.bundleId}:${app.windowId ?? "window-unknown"}`;
}

const SUGGESTION_ID_PREFIX = "sg-";
const GHOSTTY_BUNDLE_ID = "com.mitchellh.ghostty";

export function createNativeSuggestionSession(deps: NativeSuggestionSessionDependencies) {
  let currentSuggestion: Suggestion | null = null;
  let visibleSuggestionTelemetry: VisibleSuggestionTelemetry | null = null;
  let replacingSuggestion = false;
  let previouslyActiveApplication: ActiveApplication | null = null;
  let observationPaused = false;
  let textSessionSnapshot: TextSessionSnapshot | null = null;
  let ambientTerminalSnapshot: TextSessionSnapshot | null = null;
  let visibleTextSessionTarget: TextSessionSnapshot | null = null;
  let lastContextHash: string | null = null;
  let appContextGraceTimer: ReturnType<typeof setTimeout> | null = null;
  let explicitRequestInFlight = false;
  let appContextChangedDuringExplicitRequest = false;
  const { outputs } = deps;
  const compatibilityStore = deps.compatibilityStore ?? createApplicationCompatibilityStore();
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
      visibleSinceMs: Date.now(),
      ...(suggestion.id.startsWith("sg-local-") && deps.localSuggestionModelId
        ? { modelId: deps.localSuggestionModelId }
        : {}),
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

    if (visibleSuggestionTelemetry.modelId) {
      event.modelId = visibleSuggestionTelemetry.modelId;
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

  function finishReplacement(): void {
    if (!replacingSuggestion) return;
    replacingSuggestion = false;
    outputs.setSuggestionLoading?.(false);
  }

  function presentSuggestion(suggestion: Suggestion): void {
    currentSuggestion = suggestion;
    visibleTextSessionTarget = currentSafeSnapshot().textSession ?? null;
    visibleSuggestionTelemetry = buildTelemetry(suggestion);
    outputs.showSuggestion(suggestion);
    finishReplacement();
  }

  function canRefreshVisibleSuggestionInPlace(snapshot: SafeTypingContextSnapshot): boolean {
    if (!currentSuggestion || !snapshot.requestable) return false;
    if (!visibleTextSessionTarget && !snapshot.textSession) {
      return visibleSuggestionTelemetry?.activeApplicationBundleId === snapshot.activeApplication?.bundleId;
    }
    if (!visibleTextSessionTarget || !snapshot.textSession) return false;

    return (
      activeApplicationKey(visibleTextSessionTarget.activeApplication) === activeApplicationKey(snapshot.textSession.activeApplication) &&
      visibleTextSessionTarget.focusedElementId === snapshot.textSession.focusedElementId &&
      visibleTextSessionTarget.textElementId === snapshot.textSession.textElementId
    );
  }

  const suggestionLoop = createSuggestionLoop({
    getContext: () => currentSafeSnapshot(),
    getLocalSuggestion: deps.getLocalSuggestion ?? ((snapshot) => generateLocalSuggestion(snapshot.sanitizedContext)),
    fallbackToCloudOnLocalMiss: deps.fallbackToCloudOnLocalMiss,
    requestSuggestion: deps.requestSuggestion,
    onShowSuggestion: presentSuggestion,
    onShowPartialSuggestion: presentSuggestion,
    onHideSuggestion: () => {
      if (replacingSuggestion) return;
      clearVisibleSuggestion();
      outputs.hideOverlay();
    },
    onRequestStarted: outputs.onRequestStarted,
    onRequestFinished: outputs.onRequestFinished,
    onAutomaticRequestFinished: (suggestion) => {
      if (suggestion || !replacingSuggestion) return;
      finishReplacement();
      clearVisibleSuggestion();
      outputs.hideOverlay();
    },
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
    onDiagnostic: deps.onSuggestionDiagnostic,
  });

  function clearAppContextGraceTimer(): void {
    if (!appContextGraceTimer) return;
    clearTimeout(appContextGraceTimer);
    appContextGraceTimer = null;
  }

  function contextChanged(options: {
    suppressUnchangedTextSession?: boolean;
    forceClearVisibleSuggestion?: boolean;
  } = {}): void {
    const resolved = currentContextState();
    const snapshot = resolved.snapshot;
    if (options.suppressUnchangedTextSession && snapshot.contextHash === lastContextHash) {
      return;
    }
    lastContextHash = snapshot.contextHash;

    const preserveVisibleSuggestion = !options.forceClearVisibleSuggestion
      && canRefreshVisibleSuggestionInPlace(snapshot);
    if (currentSuggestion && !replacingSuggestion) {
      recordDismissal(snapshot);
    }
    outputs.resetDebugApiState();
    if (preserveVisibleSuggestion) {
      replacingSuggestion = true;
      outputs.setSuggestionLoading?.(true);
    } else {
      finishReplacement();
      clearVisibleSuggestion();
      outputs.clearSuggestion();
    }
    clearAppContextGraceTimer();
    if (resolved.pending) {
      suggestionLoop.invalidate();
      const heldHash = snapshot.contextHash;
      appContextGraceTimer = setTimeout(() => {
        appContextGraceTimer = null;
        const latest = currentContextState();
        if (latest.snapshot.contextHash !== heldHash) {
          contextChanged();
          return;
        }
        suggestionLoop.onContextChanged();
      }, deps.appContextGraceMs ?? 175);
    } else {
      suggestionLoop.onContextChanged();
    }
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
    ambientTerminalSnapshot = null;
  }

  function hasUsableTextSessionContext(snapshot: TextSessionSnapshot): boolean {
    return snapshot.activeApplication?.bundleId !== GHOSTTY_BUNDLE_ID
      && (snapshot.surroundingContext?.beforeCaret?.length ?? 0) > 0;
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

  function appContextInput(snapshot: SafeTypingContextSnapshot): SafeTypingContextSnapshot {
    return ambientTerminalSnapshot ? { ...snapshot, textSession: ambientTerminalSnapshot } : snapshot;
  }

  function appContextFingerprint(appContext: AppContextSnapshot, revision: number): string {
    const value = JSON.stringify({
      revision,
      status: appContext.metadata.status,
      fragments: appContext.fragments.map((fragment) => [fragment.provider, fragment.kind, fragment.text]),
    });
    return createHash("sha256").update(value).digest("hex").slice(0, 16);
  }

  function withAppContext(snapshot: SafeTypingContextSnapshot): {
    snapshot: SafeTypingContextSnapshot;
    pending: boolean;
    revision: number;
  } {
    if (!snapshot.requestable || (!deps.getAppContext && !deps.getAppContextState)) {
      return { snapshot, pending: false, revision: 0 };
    }

    const input = appContextInput(snapshot);
    const state = deps.getAppContextState?.(input) ?? {
      snapshot: deps.getAppContext?.(input) ?? { fragments: [], metadata: { status: "empty" } },
      pending: false,
      revision: 0,
    };
    const appContext = state.snapshot;
    compatibilityStore.recordAppContextSnapshot(snapshot.activeApplication, appContext);
    const contextHash = `${snapshot.contextHash}:app-context:${appContextFingerprint(appContext, state.revision)}`;
    if (appContext.metadata.status !== "available" || appContext.fragments.length === 0) {
      return { ...state, snapshot: { ...snapshot, contextHash } };
    }

    return { ...state, snapshot: { ...snapshot, contextHash, appContext } };
  }

  function currentContextState(): { snapshot: SafeTypingContextSnapshot; pending: boolean; revision: number } {
    const snapshot = textSessionSnapshot
      ? createSafeTextSessionSnapshot(textSessionSnapshot)
      : deps.typingContext.getSnapshot();

    return withAppContext(snapshot);
  }

  function currentSafeSnapshot(): SafeTypingContextSnapshot {
    return currentContextState().snapshot;
  }

  function clearContext(recordDismissed = true): void {
    if (recordDismissed && currentSuggestion) {
      recordDismissal(currentSafeSnapshot());
    }
    lastContextHash = null;
    clearAppContextGraceTimer();
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
      textSessionSnapshot = null;
      deps.typingContext.appendText(text, deps.getContextSource());
      contextChanged();
    },
    appendPastedText(text: string): void {
      if (observationPaused) return;
      textSessionSnapshot = null;
      deps.typingContext.appendPastedText(text);
      contextChanged();
    },
    deleteBackward(unit: TypingDeletionUnit = "character"): void {
      if (observationPaused) return;
      textSessionSnapshot = null;
      deps.typingContext.deleteBackward(unit, deps.getContextSource());
      contextChanged();
    },
    invalidateContext(): void {
      if (observationPaused) return;
      clearContext(false);
      outputs.clearSuggestion();
      outputs.showDebugContext();
    },
    appContextChanged(): void {
      if (observationPaused) return;
      if (explicitRequestInFlight) {
        appContextChangedDuringExplicitRequest = true;
        clearAppContextGraceTimer();
        suggestionLoop.invalidate();
        clearVisibleSuggestion();
        outputs.clearSuggestion();
        return;
      }
      contextChanged({ forceClearVisibleSuggestion: true });
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
      ambientTerminalSnapshot = snapshot.activeApplication?.bundleId === GHOSTTY_BUNDLE_ID
        && isReliableTextSessionSnapshot(snapshot)
        && !snapshot.secureLike
        ? snapshot
        : null;
      textSessionSnapshot = isReliableTextSessionSnapshot(snapshot) && hasUsableTextSessionContext(snapshot)
        ? snapshot
        : null;
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
      if (replacingSuggestion) return;
      const acceptedSuggestion = currentSuggestion;
      const acceptedFromTextSession = textSessionSnapshot !== null;
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
        if (acceptedSuggestion && !acceptedFromTextSession) {
          suggestionLoop.invalidate();
          clearVisibleSuggestion();
          deps.typingContext.appendText(acceptedSuggestion.text, deps.getContextSource());
          lastContextHash = null;
          contextChanged();
        } else {
          clearContext(false);
        }
      }
    },
    async requestSuggestionNow(): Promise<void> {
      if (observationPaused) {
        return;
      }
      const previousSuggestion = currentSuggestion;
      const previousTextSessionTarget = visibleTextSessionTarget;
      const previousTelemetry = visibleSuggestionTelemetry;
      replacingSuggestion = true;
      outputs.setSuggestionLoading?.(true);
      if (currentSuggestion) {
        recordDismissal(currentSafeSnapshot());
      }
      outputs.resetDebugApiState();
      clearVisibleSuggestion();
      explicitRequestInFlight = true;
      try {
        let contextRetryCount = 0;
        do {
          appContextChangedDuringExplicitRequest = false;
          await suggestionLoop.requestCloudSuggestionNow();
          contextRetryCount += 1;
        } while (appContextChangedDuringExplicitRequest && !observationPaused && contextRetryCount < 3);
        if (!currentSuggestion && previousSuggestion) {
          currentSuggestion = previousSuggestion;
          visibleTextSessionTarget = previousTextSessionTarget;
          visibleSuggestionTelemetry = previousTelemetry;
          outputs.showSuggestion(previousSuggestion);
        }
      } finally {
        explicitRequestInFlight = false;
        appContextChangedDuringExplicitRequest = false;
        replacingSuggestion = false;
        outputs.setSuggestionLoading?.(false);
      }
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
