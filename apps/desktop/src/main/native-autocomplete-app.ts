import type {
  ApplicationCategory,
  ActiveApplication,
  RecordTelemetryEventRequest,
  Suggestion,
  SuggestionContextSource,
} from "@tab/contracts";
import { classifyTypingContextSource } from "@tab/memory-policy";
import {
  createSuggestionAcceptance,
  type InsertionDependencies,
  type SuggestionProvenance as AcceptanceSuggestionProvenance,
} from "./acceptance.ts";
import type { AppContextSnapshot } from "./app-context.ts";
import { createHash } from "node:crypto";
import { detectSensitiveData } from "@tab/redaction";
import type { AppContextSnapshotState } from "./app-context-extractor.ts";
import type {
  AppContextAccessibilityTree,
  AppContextExtractor,
} from "./app-context-extractor.ts";
import type { MemoryExtractionDispatcher } from "./memory-extraction-dispatcher.ts";
import {
  createApplicationCompatibilityStore,
  type ApplicationCompatibilityStore,
} from "./application-compatibility.ts";
import { generateLocalSuggestion } from "./suggestion-engine.ts";
import { createAutomaticSuggestion } from "./automatic-suggestion.ts";
import { createDeepComplete } from "./deep-complete.ts";
import type { SuggestionSource } from "./suggestion-source.ts";
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
  readonly showSuggestion: (suggestion: Suggestion, provenance: SuggestionProvenance) => void;
  readonly clearSuggestion: () => void;
  readonly hideOverlay: () => void;
  readonly showDebugContext: () => void;
  readonly resetDebugApiState: () => void;
  readonly setSuggestionRefreshing?: (refreshing: boolean) => void;
  readonly onRequestStarted?: (context: string) => void;
  readonly onRequestFinished?: (suggestion: Suggestion | null) => void;
  readonly onSecretLikeContextDetected?: () => void;
  readonly showGuidance?: (message: string) => void;
};

type RecordInteractionTelemetry = (event: RecordTelemetryEventRequest) => void | Promise<void>;

type NativeSuggestionSessionDependencies = {
  readonly typingContext: TypingContextBuffer;
  readonly getAutomaticSuggestion?: SuggestionSource;
  readonly requestDeepComplete: SuggestionSource;
  readonly getContextSource: () => SuggestionContextSource;
  readonly outputs: NativeSuggestionSessionOutputs;
  readonly createAcceptanceDependencies: (
    getCurrentSuggestion: () => Suggestion | null,
    getPreviouslyActiveApplication: () => ActiveApplication | null,
  ) => InsertionDependencies;
  readonly debounceMs: number;
  readonly maxVisibleMs?: number;
  readonly recordInteractionTelemetry?: RecordInteractionTelemetry;
  readonly canAcceptLocalSuggestion?: () => boolean;
  readonly onLocalAllowanceExhausted?: () => void;
  readonly recordAcceptedUsage?: (event: {
    readonly acceptanceId: string;
    readonly acceptedAt: string;
    readonly wordCount: number;
    readonly characterCount: number;
  }) => void | Promise<void>;
  readonly onLocalSuggestionAccepted?: (suggestionId: string) => void;
  readonly localSuggestionModelId?: string;
  readonly getLocalSuggestionModelId?: () => string | undefined;
  readonly triggerPolicy?: TriggerPolicy;
  readonly onSuggestionDiagnostic?: (event: string, details: Record<string, unknown>) => void;
  readonly compatibilityStore?: ApplicationCompatibilityStore;
  readonly getAppContext?: (snapshot: SafeTypingContextSnapshot) => AppContextSnapshot;
  readonly getAppContextState?: (snapshot: SafeTypingContextSnapshot) => AppContextSnapshotState;
  readonly clearAppContext?: () => void;
  readonly appContextGraceMs?: number;
};

export type NativeAutocompleteAppDependencies = Omit<
  NativeSuggestionSessionDependencies,
  "getContextSource" | "getAppContext" | "getAppContextState" | "clearAppContext"
> & {
  readonly typingContext: TypingContextBuffer;
  readonly appContext: AppContextExtractor;
  readonly memoryExtraction: MemoryExtractionDispatcher;
  readonly getContextSource?: () => SuggestionContextSource;
};

type VisibleSuggestionTelemetry = {
  readonly requestId: string;
  readonly activeApplicationBundleId?: string;
  readonly suggestionLength: number;
  readonly visibleSinceMs: number;
  readonly modelId?: string;
  readonly inferenceSource: "local" | "deep_complete";
  readonly trigger: "automatic" | "explicit";
  readonly applicationCategory: ApplicationCategory;
};

export type SuggestionProvenance = AcceptanceSuggestionProvenance;

type VisibleSuggestion = {
  readonly suggestion: Suggestion;
  readonly provenance: SuggestionProvenance;
  readonly expiresAtMs: number;
};

type InteractionTelemetryEventType = RecordTelemetryEventRequest["eventType"];

function activeApplicationKey(app: ActiveApplication | null): string | null {
  if (!app) return null;
  return `${app.bundleId}:${app.windowId ?? "window-unknown"}`;
}

const SUGGESTION_ID_PREFIX = "sg-";
const GHOSTTY_BUNDLE_ID = "com.mitchellh.ghostty";

function applicationCategory(bundleId: string | undefined): ApplicationCategory {
  const normalized = bundleId?.toLowerCase() ?? "";
  if (normalized.includes("terminal") || normalized.includes("ghostty")) {
    return "terminal";
  }
  if (
    normalized.includes("slack") ||
    normalized.includes("mail") ||
    normalized.includes("messages") ||
    normalized.includes("whatsapp")
  ) {
    return "communication";
  }
  if (
    normalized.includes("xcode") ||
    normalized.includes("code") ||
    normalized.includes("zed") ||
    normalized.includes("github")
  ) {
    return "development";
  }
  if (normalized.includes("notes") || normalized.includes("obsidian")) {
    return "documents";
  }
  return normalized ? "productivity" : "other";
}

function createNativeSuggestionSession(deps: NativeSuggestionSessionDependencies) {
  let visibleSuggestion: VisibleSuggestion | null = null;
  let visibleSuggestionTelemetry: VisibleSuggestionTelemetry | null = null;
  let replacingSuggestion = false;
  let previouslyActiveApplication: ActiveApplication | null = null;
  let observationPaused = false;
  let textSessionSnapshot: TextSessionSnapshot | null = null;
  let latestTextSessionSnapshot: TextSessionSnapshot | null = null;
  let explicitRequestTarget: TextSessionSnapshot | null = null;
  let explicitRequestAction: "deep_complete" | "rewrite" | null = null;
  let ambientTerminalSnapshot: TextSessionSnapshot | null = null;
  let visibleTextSessionTarget: TextSessionSnapshot | null = null;
  let lastContextHash: string | null = null;
  let appContextGraceTimer: ReturnType<typeof setTimeout> | null = null;
  let explicitRequestInFlight = false;
  let appContextChangedDuringExplicitRequest = false;
  let acceptanceInFlight = false;
  let lastGeneratedLocalRequestId: string | null = null;
  const { outputs } = deps;
  const compatibilityStore = deps.compatibilityStore ?? createApplicationCompatibilityStore();
  const triggerPolicy = deps.triggerPolicy ?? createPoliteTriggerPolicy();

  function requestIdFromSuggestion(suggestion: Suggestion): string {
    if (suggestion.id.startsWith(SUGGESTION_ID_PREFIX)) {
      return suggestion.id.slice(SUGGESTION_ID_PREFIX.length);
    }

    return suggestion.id;
  }

  function buildTelemetry(suggestion: Suggestion, provenance: SuggestionProvenance): VisibleSuggestionTelemetry {
    const activeApplication = deps.typingContext.getState().activeApplication;
    const local = provenance === "automatic";
    const localSuggestionModelId = deps.getLocalSuggestionModelId?.() ?? deps.localSuggestionModelId;
    return {
      requestId: requestIdFromSuggestion(suggestion),
      activeApplicationBundleId: activeApplication?.bundleId,
      suggestionLength: suggestion.text.length,
      visibleSinceMs: Date.now(),
      inferenceSource: local ? "local" : "deep_complete",
      trigger: local ? "automatic" : "explicit",
      applicationCategory: applicationCategory(activeApplication?.bundleId),
      ...(local && localSuggestionModelId
        ? { modelId: localSuggestionModelId }
        : {}),
    };
  }

  function interactionLatencyMs(telemetry: VisibleSuggestionTelemetry): number {
    return Math.max(0, Date.now() - telemetry.visibleSinceMs);
  }

  function clearVisibleSuggestion(): void {
    visibleSuggestion = null;
    visibleTextSessionTarget = null;
    visibleSuggestionTelemetry = null;
  }

  function buildTelemetryEvent(
    eventType: InteractionTelemetryEventType,
    options: {
      eventId?: string;
      acceptedWordCount?: number;
      acceptedCharacterCount?: number;
    } = {},
  ): RecordTelemetryEventRequest | null {
    if (!visibleSuggestionTelemetry) return null;

    const event: RecordTelemetryEventRequest = {
      eventType,
      eventId: options.eventId ?? crypto.randomUUID(),
      requestId: visibleSuggestionTelemetry.requestId,
      timestamp: new Date().toISOString(),
      suggestionLength: visibleSuggestionTelemetry.suggestionLength,
      latencyMs: interactionLatencyMs(visibleSuggestionTelemetry),
      inferenceSource: visibleSuggestionTelemetry.inferenceSource,
      trigger: visibleSuggestionTelemetry.trigger,
      applicationCategory: visibleSuggestionTelemetry.applicationCategory,
    };

    if (options.acceptedWordCount !== undefined) {
      event.acceptedWordCount = options.acceptedWordCount;
    }
    if (options.acceptedCharacterCount !== undefined) {
      event.acceptedCharacterCount = options.acceptedCharacterCount;
    }

    if (visibleSuggestionTelemetry.modelId) {
      event.modelId = visibleSuggestionTelemetry.modelId;
    }

    return event;
  }

  function recordInteractionTelemetry(
    eventType: InteractionTelemetryEventType,
    options?: {
      eventId?: string;
      acceptedWordCount?: number;
      acceptedCharacterCount?: number;
    },
  ): void {
    if (!deps.recordInteractionTelemetry) return;

    const event = buildTelemetryEvent(eventType, options);
    if (!event) return;

    Promise.resolve(deps.recordInteractionTelemetry(event)).catch(() => {
      // Interaction telemetry is best-effort and must never interrupt typing or acceptance.
    });
  }

  function recordLocalGenerated(suggestion: Suggestion): void {
    if (!deps.recordInteractionTelemetry) return;
    const telemetry = buildTelemetry(suggestion, "automatic");
    if (telemetry.inferenceSource !== "local") return;
    if (lastGeneratedLocalRequestId === telemetry.requestId) return;
    lastGeneratedLocalRequestId = telemetry.requestId;
    Promise.resolve(
      deps.recordInteractionTelemetry({
        eventType: "suggestion_generated",
        eventId: crypto.randomUUID(),
        requestId: telemetry.requestId,
        timestamp: new Date().toISOString(),
        suggestionLength: telemetry.suggestionLength,
        latencyMs: 0,
        modelId: telemetry.modelId,
        inferenceSource: "local",
        trigger: "automatic",
        applicationCategory: telemetry.applicationCategory,
      }),
    ).catch(() => {});
  }

  function recordLocalFailure(): void {
    if (!deps.recordInteractionTelemetry) return;
    const activeApplication = deps.typingContext.getState().activeApplication;
    Promise.resolve(
      deps.recordInteractionTelemetry({
        eventType: "suggestion_error",
        eventId: crypto.randomUUID(),
        requestId: `local-${crypto.randomUUID()}`,
        timestamp: new Date().toISOString(),
        inferenceSource: "local",
        trigger: "automatic",
        applicationCategory: applicationCategory(activeApplication?.bundleId),
        errorCode: "provider_failure",
      }),
    ).catch(() => {});
  }

  function recordDismissal(snapshot: SafeTypingContextSnapshot): void {
    compatibilityStore.recordDismissal(snapshot);
    triggerPolicy.recordDismissal(snapshot);
    recordInteractionTelemetry("suggestion_dismissed");
  }

  function finishReplacement(): void {
    if (!replacingSuggestion) return;
    replacingSuggestion = false;
    outputs.setSuggestionRefreshing?.(false);
  }

  function presentSuggestion(
    suggestion: Suggestion,
    provenance: SuggestionProvenance,
    expiresAtMs: number,
  ): void {
    const previousTelemetry = visibleSuggestionTelemetry;
    visibleSuggestion = { suggestion, provenance, expiresAtMs };
    visibleTextSessionTarget = currentSafeSnapshot().textSession ?? null;
    const nextTelemetry = buildTelemetry(suggestion, provenance);
    const sameRequest =
      previousTelemetry?.requestId === nextTelemetry.requestId &&
      previousTelemetry.inferenceSource === nextTelemetry.inferenceSource;
    visibleSuggestionTelemetry = sameRequest
      ? { ...nextTelemetry, visibleSinceMs: previousTelemetry.visibleSinceMs }
      : nextTelemetry;
    if (
      visibleSuggestionTelemetry.inferenceSource === "local" &&
      !sameRequest
    ) {
      recordInteractionTelemetry("suggestion_shown");
    }
    outputs.showSuggestion(suggestion, provenance);
    finishReplacement();
  }

  function canRefreshVisibleSuggestionInPlace(snapshot: SafeTypingContextSnapshot): boolean {
    if (!visibleSuggestion || !snapshot.requestable) return false;
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

  const automaticSuggestion = createAutomaticSuggestion({
    getContext: () => currentSafeSnapshot(),
    getLocalSuggestion: deps.getAutomaticSuggestion ?? ((snapshot) => generateLocalSuggestion(snapshot.sanitizedContext)),
    onShowSuggestion: (suggestion, expiresAtMs) => presentSuggestion(suggestion, "automatic", expiresAtMs),
    onHideSuggestion: () => {
      if (replacingSuggestion) return;
      clearVisibleSuggestion();
      outputs.hideOverlay();
    },
    onRequestFinished: (suggestion) => {
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
    onSuggestionGenerated: recordLocalGenerated,
    onSuggestionFailed: recordLocalFailure,
    onSecretLikeContextDetected: () => {
      deps.clearAppContext?.();
      deps.typingContext.clearAll();
      outputs.onSecretLikeContextDetected?.();
    },
    debounceMs: deps.debounceMs,
    maxVisibleMs: deps.maxVisibleMs,
    triggerPolicy,
    onDiagnostic: deps.onSuggestionDiagnostic,
  });

  const deepComplete = createDeepComplete({
    getContext: () => currentSafeSnapshot(),
    requestCloudSuggestion: deps.requestDeepComplete,
    onShowSuggestion: (suggestion, expiresAtMs) => {
      presentSuggestion(suggestion, explicitRequestAction ?? "deep_complete", expiresAtMs);
    },
    onHideSuggestion: () => {
      if (visibleSuggestion?.provenance !== "automatic") clearVisibleSuggestion();
      outputs.hideOverlay();
    },
    onSuggestionStale: () => {
      compatibilityStore.recordStale(currentSafeSnapshot());
      recordInteractionTelemetry("suggestion_stale");
      clearVisibleSuggestion();
    },
    onRequestStarted: outputs.onRequestStarted,
    onRequestFinished: outputs.onRequestFinished,
    onSecretLikeContextDetected: () => {
      deps.clearAppContext?.();
      deps.typingContext.clearAll();
      outputs.onSecretLikeContextDetected?.();
    },
    triggerPolicy,
    maxVisibleMs: deps.maxVisibleMs,
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
    deepComplete.invalidate();
    lastContextHash = snapshot.contextHash;

    const preserveVisibleSuggestion = visibleSuggestion?.provenance !== "rewrite"
      && !options.forceClearVisibleSuggestion
      && canRefreshVisibleSuggestionInPlace(snapshot);
    if (visibleSuggestion && !replacingSuggestion) {
      recordDismissal(snapshot);
    }
    outputs.resetDebugApiState();
    if (preserveVisibleSuggestion) {
      replacingSuggestion = true;
      outputs.setSuggestionRefreshing?.(true);
    } else {
      finishReplacement();
      clearVisibleSuggestion();
      outputs.clearSuggestion();
    }
    clearAppContextGraceTimer();
    if (resolved.pending) {
      automaticSuggestion.invalidate();
      const heldHash = snapshot.contextHash;
      appContextGraceTimer = setTimeout(() => {
        appContextGraceTimer = null;
        const latest = currentContextState();
        if (latest.snapshot.contextHash !== heldHash) {
          contextChanged();
          return;
        }
        automaticSuggestion.onContextChanged();
      }, deps.appContextGraceMs ?? 175);
    } else {
      automaticSuggestion.onContextChanged();
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
    latestTextSessionSnapshot = null;
    ambientTerminalSnapshot = null;
  }

  function hasUsableTextSessionContext(snapshot: TextSessionSnapshot): boolean {
    return snapshot.activeApplication?.bundleId !== GHOSTTY_BUNDLE_ID
      && (snapshot.surroundingContext?.beforeCaret?.length ?? 0) > 0;
  }

  function explicitAction(): "deep_complete" | "rewrite" | "oversized" | "none" {
    const textSession = latestTextSessionSnapshot;
    const snapshot = textSession ? createSafeTextSessionSnapshot(textSession) : null;
    const range = textSession?.selectedRange;
    if (
      observationPaused || !snapshot?.requestable || !textSession ||
      textSession.accessibilityReliability !== "reliable" || textSession.secureLike ||
      !textSession.activeApplication?.windowId || !textSession.focusedElementId ||
      !textSession.textElementId || !range
    ) return "none";
    if (range.length === 0) return "deep_complete";
    if (textSession.selectedText === undefined || textSession.selectedText.length !== range.length) return "none";
    if (detectSensitiveData([
      textSession.selectedText,
      textSession.surroundingContext?.beforeCaret ?? "",
      textSession.surroundingContext?.afterCaret ?? "",
    ].join("\n")).hasSensitiveData) return "none";
    return range.length > 2_000 ? "oversized" : "rewrite";
  }

  function holdVisibleSuggestionUntilTextSessionRefresh(): void {
    if (!visibleSuggestion) return;

    recordDismissal(currentSafeSnapshot());
    outputs.resetDebugApiState();
    replacingSuggestion = true;
    outputs.setSuggestionRefreshing?.(true);
    automaticSuggestion.invalidate();
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
    const requestTarget = explicitRequestTarget ?? textSessionSnapshot;
    const snapshot = requestTarget
      ? createSafeTextSessionSnapshot(requestTarget)
      : deps.typingContext.getSnapshot();

    return withAppContext(snapshot);
  }

  function currentSafeSnapshot(): SafeTypingContextSnapshot {
    return currentContextState().snapshot;
  }

  function clearContext(recordDismissed = true): void {
    if (recordDismissed && visibleSuggestion) {
      recordDismissal(currentSafeSnapshot());
    }
    lastContextHash = null;
    clearAppContextGraceTimer();
    clearTextSessionSnapshot();
    deps.clearAppContext?.();
    deps.typingContext.clear();
    outputs.resetDebugApiState();
    clearVisibleSuggestion();
    automaticSuggestion.invalidate();
    deepComplete.invalidate();
  }

  const suggestionAcceptance = createSuggestionAcceptance({
    canAcceptLocalSuggestion: deps.canAcceptLocalSuggestion,
    onLocalAllowanceExhausted: deps.onLocalAllowanceExhausted,
    recordAcceptance: () => compatibilityStore.recordAcceptance(currentSafeSnapshot()),
    recordInteractionTelemetry: ({
      acceptanceId,
      acceptedWordCount,
      acceptedCharacterCount,
    }) => {
      recordInteractionTelemetry("suggestion_accepted", {
        eventId: acceptanceId,
        acceptedWordCount,
        acceptedCharacterCount,
      });
    },
    recordAcceptedUsage: deps.recordAcceptedUsage,
    onLocalSuggestionAccepted: deps.onLocalSuggestionAccepted,
  });

  return {
    appendText(text: string): void {
      if (observationPaused) return;
      if (textSessionSnapshot) {
        holdVisibleSuggestionUntilTextSessionRefresh();
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
        deepComplete.invalidate();
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
      if (
        explicitRequestTarget &&
        createSafeTextSessionSnapshot(explicitRequestTarget).contextHash !== createSafeTextSessionSnapshot(snapshot).contextHash
      ) {
        explicitRequestTarget = null;
      }
      latestTextSessionSnapshot = snapshot;
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
          deps.typingContext.clearAll();
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
      if (replacingSuggestion || acceptanceInFlight) return;
      const acceptedVisibleSuggestion = visibleSuggestion;
      const acceptedSuggestion = acceptedVisibleSuggestion?.suggestion ?? null;
      acceptanceInFlight = true;
      const acceptedFromTextSession = textSessionSnapshot !== null;
      const insertionDeps = deps.createAcceptanceDependencies(
        () => visibleSuggestion?.suggestion ?? null,
        () => previouslyActiveApplication,
      );
      let result;
      try {
        result = await suggestionAcceptance.accept({
          candidate: acceptedVisibleSuggestion,
          insertion: {
            ...insertionDeps,
            getVisibleTextSessionTarget: () => visibleTextSessionTarget,
            getCurrentTextSessionTarget: () => textSessionSnapshot,
            shouldPreferClipboardFallback: (targetApp) => compatibilityStore.shouldPreferClipboardInsertion(targetApp),
            recordInsertionOutcome: (strategy, outcome, targetApp) => {
              compatibilityStore.recordInsertionOutcome(targetApp, strategy, outcome);
            },
          },
        });
      } finally {
        acceptanceInFlight = false;
      }

      if (result === "allowance_exhausted") {
        clearVisibleSuggestion();
        outputs.hideOverlay();
        return;
      }

      if (result === "inserted") {
        outputs.hideOverlay();
        if (acceptedSuggestion && !acceptedFromTextSession) {
          automaticSuggestion.invalidate();
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
      const action = explicitAction();
      if (action === "none") return;
      if (action === "oversized") {
        clearVisibleSuggestion();
        outputs.showGuidance?.("Select up to 2,000 characters");
        return;
      }
      const requestTarget = latestTextSessionSnapshot;
      if (!requestTarget) return;
      const previousVisibleSuggestion = visibleSuggestion;
      const previousContextHash = currentSafeSnapshot().contextHash;
      explicitRequestTarget = requestTarget;
      explicitRequestAction = action;
      replacingSuggestion = true;
      automaticSuggestion.suspend();
      outputs.setSuggestionRefreshing?.(true);
      if (visibleSuggestion) {
        recordDismissal(currentSafeSnapshot());
      }
      outputs.resetDebugApiState();
      explicitRequestInFlight = true;
      try {
        let contextRetryCount = 0;
        let deepCompleteSuggestion: Suggestion | null = null;
        do {
          appContextChangedDuringExplicitRequest = false;
          deepCompleteSuggestion = await deepComplete.requestNow();
          contextRetryCount += 1;
        } while (appContextChangedDuringExplicitRequest && !observationPaused && contextRetryCount < 3);
        if (
          !deepCompleteSuggestion &&
          previousVisibleSuggestion
        ) {
          const restored = previousVisibleSuggestion.provenance === "automatic"
            ? automaticSuggestion.restore(
              previousVisibleSuggestion.suggestion,
              previousContextHash,
              previousVisibleSuggestion.expiresAtMs,
            )
            : deepComplete.restore(
              previousVisibleSuggestion.suggestion,
              previousContextHash,
              previousVisibleSuggestion.expiresAtMs,
            );
          if (!restored) {
            clearVisibleSuggestion();
            outputs.hideOverlay();
          }
        }
      } finally {
        explicitRequestInFlight = false;
        explicitRequestTarget = null;
        explicitRequestAction = null;
        appContextChangedDuringExplicitRequest = false;
        replacingSuggestion = false;
        automaticSuggestion.resume();
        outputs.setSuggestionRefreshing?.(false);
      }
      outputs.showDebugContext();
    },
    clearContext,
    getCurrentSuggestion: () => visibleSuggestion?.suggestion ?? null,
    getVisibleSuggestion: () => visibleSuggestion,
    getCurrentSnapshot: () => currentSafeSnapshot(),
    getPreviouslyActiveApplication: () => previouslyActiveApplication,
    isPaused: () => observationPaused,
    getLoopState: () => automaticSuggestion.getState(),
  };
}

function activeApplicationFromState(
  typingContext: TypingContextBuffer,
): ActiveApplication | null {
  return typingContext.getState().activeApplication;
}

export function createNativeAutocompleteApp(
  deps: NativeAutocompleteAppDependencies,
) {
  const getContextSource =
    deps.getContextSource ??
    (() =>
      classifyTypingContextSource(
        activeApplicationFromState(deps.typingContext),
      ));
  let clearingAppContext = false;
  const session = createNativeSuggestionSession({
    ...deps,
    getContextSource,
    getAppContext: (snapshot) => deps.appContext.getSnapshot(snapshot),
    getAppContextState: deps.appContext.getSnapshotState
      ? (snapshot) => deps.appContext.getSnapshotState!(snapshot)
      : undefined,
    clearAppContext: () => {
      clearingAppContext = true;
      try {
        deps.appContext.clear();
      } finally {
        clearingAppContext = false;
      }
    },
  });
  deps.appContext.subscribe?.(() => {
    if (!clearingAppContext) session.appContextChanged();
  });

  return {
    appendText(text: string): void {
      if (session.isPaused()) return;
      const activeApplication = activeApplicationFromState(deps.typingContext);
      if (activeApplication) {
        deps.memoryExtraction.append({
          text,
          source: getContextSource(),
          activeApplication,
        });
      }
      session.appendText(text);
    },
    appendPastedText: (text: string) => session.appendPastedText(text),
    deleteBackward: (unit: TypingDeletionUnit = "character") =>
      session.deleteBackward(unit),
    invalidateContext: () => session.invalidateContext(),
    setActiveApplication: (
      bundleId: string | null,
      windowId: string | null = null,
    ) => session.setActiveApplication(bundleId, windowId),
    setSecureInput: (active: boolean) => session.setSecureInput(active),
    applyTextSessionSnapshot(snapshot: TextSessionSnapshot): void {
      if (!session.isPaused()) deps.appContext.ingestTextSession?.(snapshot);
      if (snapshot.accessibilityReliability === "unavailable") {
        deps.appContext.ingestAccessibilityTree({
          activeApplication: snapshot.activeApplication,
          accessibilityTree: null,
        });
      }
      session.applyTextSessionSnapshot(snapshot);
    },
    ingestAppContextTree(accessibilityTree: AppContextAccessibilityTree): void {
      deps.appContext.ingestAccessibilityTree({
        activeApplication: activeApplicationFromState(deps.typingContext),
        accessibilityTree,
      });
    },
    setPaused: (active: boolean) => session.setPaused(active),
    acceptCurrentSuggestion: () => session.acceptCurrentSuggestion(),
    requestSuggestionNow: () => session.requestSuggestionNow(),
    clearContext: () => session.clearContext(),
    getCurrentSuggestion: () => session.getCurrentSuggestion(),
    getVisibleSuggestion: () => session.getVisibleSuggestion(),
    getCurrentSnapshot: () => session.getCurrentSnapshot(),
    getPreviouslyActiveApplication: () =>
      session.getPreviouslyActiveApplication(),
    isPaused: () => session.isPaused(),
    getLoopState: () => session.getLoopState(),
  };
}

export type NativeAutocompleteApp = ReturnType<
  typeof createNativeAutocompleteApp
>;
