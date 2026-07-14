import type { Suggestion } from "@tab/contracts";
import { createHash } from "node:crypto";
import {
  isRequestableTypingContextSnapshot,
  type RequestableTypingContextSnapshot,
  type SafeTypingContextSnapshot,
} from "./typing-context.ts";
import type { TriggerPolicy } from "./trigger-policy.ts";

export type SuggestionLoopState =
  | { status: "idle" }
  | { status: "debouncing"; timer: ReturnType<typeof setTimeout>; contextHash: string }
  | { status: "showing"; suggestion: Suggestion; contextHash: string; expiryTimer: ReturnType<typeof setTimeout> };

export type SuggestionSource = (
  snapshot: RequestableTypingContextSnapshot,
  options?: {
    signal?: AbortSignal;
    onPartialSuggestion?: (suggestion: Suggestion) => void;
  },
) => Promise<Suggestion | null> | Suggestion | null;

export type SuggestionLoopDependencies = {
  getContext(): SafeTypingContextSnapshot;
  getLocalSuggestion?: SuggestionSource;
  fallbackToCloudOnLocalMiss?: boolean;
  requestSuggestion: SuggestionSource;
  onShowSuggestion(suggestion: Suggestion): void;
  onShowPartialSuggestion?: (suggestion: Suggestion) => void;
  onHideSuggestion(): void;
  onRequestStarted?: (context: string) => void;
  onRequestFinished?: (suggestion: Suggestion | null) => void;
  onAutomaticRequestFinished?: (suggestion: Suggestion | null) => void;
  onSuggestionStale?: (suggestion: Suggestion) => void;
  onSuggestionGenerated?: (suggestion: Suggestion) => void;
  onLocalSuggestionFailed?: (
    snapshot: RequestableTypingContextSnapshot,
  ) => void;
  onSecretLikeContextDetected?: () => void;
  onDiagnostic?: (event: string, details: Record<string, unknown>) => void;
  triggerPolicy?: TriggerPolicy;
  debounceMs: number;
  maxVisibleMs?: number;
};

export function createSuggestionLoop(deps: SuggestionLoopDependencies) {
  let state: SuggestionLoopState = { status: "idle" };
  let requestVersion = 0;
  let activeLocalController: AbortController | null = null;
  let activeCloudRequest: {
    contextHash: string;
    controller: AbortController;
    request: Promise<Suggestion | null>;
  } | null = null;

  function diagnose(event: string, details: Record<string, unknown> = {}): void {
    deps.onDiagnostic?.(event, details);
  }

  function contextDetails(snapshot: SafeTypingContextSnapshot): Record<string, unknown> {
    if (!deps.onDiagnostic) return {};
    return {
      contextId: createHash("sha256").update(snapshot.contextHash).digest("hex").slice(0, 12),
      contextLength: snapshot.sanitizedContext.length,
      contextSource: snapshot.contextSource,
      activeApplication: snapshot.activeApplication?.bundleId ?? null,
      requestable: snapshot.requestable,
      suppressionReason: snapshot.suppressionReason,
    };
  }

  function isCurrentDebouncedContext(hash: string): boolean {
    return state.status === "debouncing" && state.contextHash === hash;
  }

  function tryShowSuggestion(
    snapshot: RequestableTypingContextSnapshot,
    suggestion: Suggestion,
    hash: string,
  ): void {
    const showDecision = deps.triggerPolicy?.onSuggestionCandidate(snapshot, suggestion);
    if (showDecision && !showDecision.allow) {
      diagnose("candidate_skipped", {
        ...contextDetails(snapshot),
        reason: showDecision.reason,
        suggestionLength: suggestion.text.length,
      });
      state = { status: "idle" };
      return;
    }

    if (state.status === "showing") {
      clearTimeout(state.expiryTimer);
    }

    const expiryTimer = setTimeout(() => {
      if (state.status !== "showing" || state.contextHash !== hash) {
        return;
      }
      deps.triggerPolicy?.recordStale(deps.getContext());
      deps.onSuggestionStale?.(state.suggestion);
      deps.onHideSuggestion();
      state = { status: "idle" };
    }, deps.maxVisibleMs ?? 4_000);

    state = { status: "showing", suggestion, contextHash: hash, expiryTimer };
    diagnose("suggestion_shown", {
      ...contextDetails(snapshot),
      source: suggestion.id.startsWith("sg-local-") ? "local" : "cloud",
      suggestionLength: suggestion.text.length,
    });
    deps.onShowSuggestion(suggestion);
  }

  async function requestLocalSuggestion(snapshot: RequestableTypingContextSnapshot): Promise<Suggestion | null> {
    if (!deps.getLocalSuggestion) {
      diagnose("local_skipped", { ...contextDetails(snapshot), reason: "source_not_configured" });
      return null;
    }

    const controller = new AbortController();
    activeLocalController = controller;
    diagnose("local_started", contextDetails(snapshot));
    try {
      const suggestion = await deps.getLocalSuggestion(snapshot, {
        signal: controller.signal,
        onPartialSuggestion: (suggestion) => {
          deps.onSuggestionGenerated?.(suggestion);
          if (!isCurrentDebouncedContext(snapshot.contextHash)) {
            diagnose("local_partial_skipped", { ...contextDetails(snapshot), reason: "context_changed" });
            return;
          }
          const showDecision = deps.triggerPolicy?.onSuggestionCandidate(snapshot, suggestion);
          if (showDecision && !showDecision.allow) {
            diagnose("local_partial_skipped", {
              ...contextDetails(snapshot),
              reason: showDecision.reason,
              suggestionLength: suggestion.text.length,
            });
            return;
          }
          diagnose("local_partial_shown", {
            ...contextDetails(snapshot),
            suggestionLength: suggestion.text.length,
          });
          deps.onShowPartialSuggestion?.(suggestion);
        },
      });
      diagnose(suggestion ? "local_completed" : "local_empty", {
        ...contextDetails(snapshot),
        aborted: controller.signal.aborted,
        ...(suggestion ? { suggestionLength: suggestion.text.length } : {}),
      });
      if (suggestion) deps.onSuggestionGenerated?.(suggestion);
      return suggestion;
    } catch (error) {
      diagnose("local_failed", {
        ...contextDetails(snapshot),
        aborted: controller.signal.aborted,
        error: error instanceof Error ? error.message : String(error),
      });
      if (!controller.signal.aborted) {
        deps.onLocalSuggestionFailed?.(snapshot);
      }
      return null;
    } finally {
      if (activeLocalController === controller) {
        activeLocalController = null;
      }
    }
  }

  function hideIfShowing(): void {
    if (state.status === "showing") {
      clearTimeout(state.expiryTimer);
      deps.onHideSuggestion();
    }
  }

  function invalidate(): void {
    requestVersion += 1;
    activeLocalController?.abort();
    activeLocalController = null;
    activeCloudRequest?.controller.abort();
    activeCloudRequest = null;
    if (state.status === "debouncing") {
      clearTimeout(state.timer);
    }
    hideIfShowing();
    state = { status: "idle" };
  }

  async function requestCloudSuggestion(
    snapshot: RequestableTypingContextSnapshot,
    version: number,
  ): Promise<Suggestion | null> {
    const hash = snapshot.contextHash;
    deps.onRequestStarted?.(snapshot.sanitizedContext);
    const controller = new AbortController();
    const request = (async () => deps.requestSuggestion(snapshot, { signal: controller.signal }))();
    activeCloudRequest = { contextHash: hash, controller, request };
    let suggestion: Suggestion | null;
    try {
      suggestion = await request;
    } finally {
      if (activeCloudRequest?.controller === controller) {
        activeCloudRequest = null;
      }
    }

    if (requestVersion !== version) {
      return null;
    }

    const latest = deps.getContext();
    if (latest.contextHash !== hash || !isRequestableTypingContextSnapshot(latest)) {
      state = { status: "idle" };
      return null;
    }

    deps.onRequestFinished?.(suggestion);

    if (!suggestion) {
      state = { status: "idle" };
      return null;
    }

    tryShowSuggestion(latest, suggestion, hash);
    return state.status === "showing" ? suggestion : null;
  }

  async function requestCloudSuggestionNow(): Promise<void> {
    const snapshot = deps.getContext();
    if (!isRequestableTypingContextSnapshot(snapshot)) {
      if (snapshot.suppressionReason === "secret_like_context") {
        deps.onSecretLikeContextDetected?.();
      }
      invalidate();
      return;
    }

    if (activeCloudRequest?.contextHash === snapshot.contextHash) {
      await activeCloudRequest.request;
      return;
    }

    invalidate();
    await requestCloudSuggestion(snapshot, requestVersion);
  }

  function onContextChanged(): void {
    const snapshot = deps.getContext();
    const hash = snapshot.contextHash;

    diagnose("context_changed", { ...contextDetails(snapshot), loopState: state.status });

    if (!snapshot.requestable) {
      if (snapshot.suppressionReason === "secret_like_context") {
        deps.onSecretLikeContextDetected?.();
      }
      invalidate();
      diagnose("automatic_skipped", {
        ...contextDetails(snapshot),
        reason: snapshot.suppressionReason ?? "not_requestable",
      });
      deps.onAutomaticRequestFinished?.(null);
      return;
    }

    if (
      (state.status !== "idle" && state.contextHash === hash) ||
      activeCloudRequest?.contextHash === hash
    ) {
      diagnose("automatic_skipped", { ...contextDetails(snapshot), reason: "context_already_active" });
      return;
    }

    const triggerDecision = deps.triggerPolicy?.onContextChanged(snapshot);
    if (triggerDecision && !triggerDecision.allow) {
      invalidate();
      diagnose("automatic_skipped", { ...contextDetails(snapshot), reason: triggerDecision.reason });
      deps.onAutomaticRequestFinished?.(null);
      return;
    }

    invalidate();

    diagnose("automatic_debouncing", { ...contextDetails(snapshot), debounceMs: deps.debounceMs });

    state = {
      status: "debouncing",
      contextHash: hash,
      timer: setTimeout(async () => {
        const version = requestVersion;
        if (!isCurrentDebouncedContext(hash)) {
          diagnose("automatic_skipped", { ...contextDetails(snapshot), reason: "debounce_invalidated" });
          return;
        }

        const latest = deps.getContext();
        if (latest.contextHash !== hash) {
          diagnose("automatic_skipped", { ...contextDetails(latest), reason: "context_changed_during_debounce" });
          state = { status: "idle" };
          return;
        }

        if (!isRequestableTypingContextSnapshot(latest)) {
          diagnose("automatic_skipped", {
            ...contextDetails(latest),
            reason: latest.suppressionReason ?? "not_requestable_after_debounce",
          });
          state = { status: "idle" };
          return;
        }

        const localSuggestion = await requestLocalSuggestion(latest);
        if (requestVersion !== version || !isCurrentDebouncedContext(hash)) {
          diagnose("local_result_skipped", { ...contextDetails(latest), reason: "context_invalidated" });
          return;
        }

        if (localSuggestion) {
          tryShowSuggestion(latest, localSuggestion, hash);
          deps.onAutomaticRequestFinished?.(state.status === "showing" ? localSuggestion : null);
          return;
        }

        if (deps.getLocalSuggestion && deps.fallbackToCloudOnLocalMiss === false) {
          diagnose("cloud_skipped", { ...contextDetails(latest), reason: "local_only_mode" });
          state = { status: "idle" };
          deps.onAutomaticRequestFinished?.(null);
          return;
        }

        try {
          const cloudSuggestion = await requestCloudSuggestion(latest, version);
          deps.onAutomaticRequestFinished?.(cloudSuggestion);
        } catch {
          if (requestVersion === version && isCurrentDebouncedContext(hash)) {
            state = { status: "idle" };
            deps.onAutomaticRequestFinished?.(null);
          }
        }
      }, deps.debounceMs),
    };
  }

  return {
    onContextChanged,
    requestCloudSuggestionNow,
    invalidate,
    getState: () => state,
  };
}
