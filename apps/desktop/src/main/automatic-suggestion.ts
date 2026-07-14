import type { Suggestion } from "@tab/contracts";
import { createHash } from "node:crypto";
import type { SuggestionSource } from "./suggestion-source.ts";
import {
  isRequestableTypingContextSnapshot,
  type RequestableTypingContextSnapshot,
  type SafeTypingContextSnapshot,
} from "./typing-context.ts";
import type { TriggerPolicy } from "./trigger-policy.ts";
import { createSuggestionPresentation } from "./suggestion-presentation.ts";

export type AutomaticSuggestionState =
  | { status: "idle" }
  | { status: "debouncing"; timer: ReturnType<typeof setTimeout>; contextHash: string }
  | { status: "requesting"; contextHash: string }
  | {
    status: "showing";
    suggestion: Suggestion;
    contextHash: string;
    expiresAtMs: number;
  };

export type AutomaticSuggestionDependencies = {
  getContext(): SafeTypingContextSnapshot;
  getLocalSuggestion: SuggestionSource;
  onShowSuggestion(suggestion: Suggestion, expiresAtMs: number): void;
  onHideSuggestion(): void;
  onRequestFinished?: (suggestion: Suggestion | null) => void;
  onSuggestionStale?: (suggestion: Suggestion) => void;
  onSuggestionGenerated?: (suggestion: Suggestion) => void;
  onSuggestionFailed?: (snapshot: RequestableTypingContextSnapshot) => void;
  onSecretLikeContextDetected?: () => void;
  onDiagnostic?: (event: string, details: Record<string, unknown>) => void;
  triggerPolicy?: TriggerPolicy;
  debounceMs: number;
  maxVisibleMs?: number;
};

export function createAutomaticSuggestion(deps: AutomaticSuggestionDependencies) {
  let state: AutomaticSuggestionState = { status: "idle" };
  let requestVersion = 0;
  let activeController: AbortController | null = null;
  let suspended = false;
  const presentation = createSuggestionPresentation(deps);

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

  function clearWork(hideVisible: boolean): void {
    requestVersion += 1;
    activeController?.abort();
    activeController = null;
    if (state.status === "debouncing") clearTimeout(state.timer);
    presentation.clear(hideVisible);
    state = { status: "idle" };
  }

  function show(
    snapshot: RequestableTypingContextSnapshot,
    suggestion: Suggestion,
    expiresAtMs = Date.now() + (deps.maxVisibleMs ?? 4_000),
  ): Suggestion | null {
    const contextHash = snapshot.contextHash;
    const result = presentation.present(snapshot, suggestion, expiresAtMs, {
      onExpired: () => {
        state = { status: "idle" };
      },
      onSuppressed: (reason) => {
        diagnose("candidate_skipped", { ...contextDetails(snapshot), reason });
      },
    });
    if (!result) {
      state = { status: "idle" };
      return null;
    }
    state = {
      status: "showing",
      suggestion,
      contextHash,
      expiresAtMs: result,
    };
    diagnose("suggestion_shown", { ...contextDetails(snapshot), source: "local", suggestionLength: suggestion.text.length });
    return suggestion;
  }

  function onContextChanged(): void {
    if (suspended) return;
    const snapshot = deps.getContext();
    const contextHash = snapshot.contextHash;
    diagnose("context_changed", { ...contextDetails(snapshot), loopState: state.status });

    if (!isRequestableTypingContextSnapshot(snapshot)) {
      if (snapshot.suppressionReason === "secret_like_context") deps.onSecretLikeContextDetected?.();
      clearWork(true);
      deps.onRequestFinished?.(null);
      return;
    }
    if (state.status !== "idle" && state.contextHash === contextHash) return;

    const triggerDecision = deps.triggerPolicy?.onContextChanged(snapshot);
    if (triggerDecision && !triggerDecision.allow) {
      clearWork(true);
      diagnose("automatic_skipped", { ...contextDetails(snapshot), reason: triggerDecision.reason });
      deps.onRequestFinished?.(null);
      return;
    }

    clearWork(true);
    diagnose("automatic_debouncing", { ...contextDetails(snapshot), debounceMs: deps.debounceMs });
    state = {
      status: "debouncing",
      contextHash,
      timer: setTimeout(async () => {
        const version = requestVersion;
        const latest = deps.getContext();
        if (
          suspended ||
          state.status !== "debouncing" ||
          state.contextHash !== contextHash ||
          latest.contextHash !== contextHash ||
          !isRequestableTypingContextSnapshot(latest)
        ) return;

        const controller = new AbortController();
        activeController = controller;
        state = { status: "requesting", contextHash };
        diagnose("local_started", contextDetails(latest));
        let suggestion: Suggestion | null = null;
        try {
          suggestion = await deps.getLocalSuggestion(latest, { signal: controller.signal });
          if (suggestion) deps.onSuggestionGenerated?.(suggestion);
        } catch (error) {
          diagnose("local_failed", {
            ...contextDetails(latest),
            aborted: controller.signal.aborted,
            error: error instanceof Error ? error.message : String(error),
          });
          if (!controller.signal.aborted) deps.onSuggestionFailed?.(latest);
        } finally {
          if (activeController === controller) activeController = null;
        }

        if (suspended || requestVersion !== version || state.status !== "requesting" || state.contextHash !== contextHash) return;
        const current = deps.getContext();
        if (current.contextHash !== contextHash || !isRequestableTypingContextSnapshot(current)) {
          state = { status: "idle" };
          return;
        }
        const shown = suggestion ? show(current, suggestion) : null;
        if (!shown) state = { status: "idle" };
        deps.onRequestFinished?.(shown);
      }, deps.debounceMs),
    };
  }

  function restore(suggestion: Suggestion, contextHash: string, expiresAtMs: number): boolean {
    const current = deps.getContext();
    if (
      current.contextHash !== contextHash ||
      !isRequestableTypingContextSnapshot(current)
    ) {
      return false;
    }

    clearWork(false);
    return show(current, suggestion, expiresAtMs) !== null;
  }

  return {
    onContextChanged,
    restore,
    invalidate: () => clearWork(true),
    suspend(): void {
      suspended = true;
      clearWork(false);
    },
    resume(): void {
      suspended = false;
    },
    getState: () => state,
  };
}
