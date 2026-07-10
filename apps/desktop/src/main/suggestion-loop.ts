import type { Suggestion } from "@tab/contracts";
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
  onSuggestionStale?: (suggestion: Suggestion) => void;
  onSecretLikeContextDetected?: () => void;
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
    deps.onShowSuggestion(suggestion);
  }

  async function requestLocalSuggestion(snapshot: RequestableTypingContextSnapshot): Promise<Suggestion | null> {
    if (!deps.getLocalSuggestion) return null;

    const controller = new AbortController();
    activeLocalController = controller;
    try {
      return await deps.getLocalSuggestion(snapshot, {
        signal: controller.signal,
        onPartialSuggestion: (suggestion) => {
          if (!isCurrentDebouncedContext(snapshot.contextHash)) return;
          const showDecision = deps.triggerPolicy?.onSuggestionCandidate(snapshot, suggestion);
          if (showDecision && !showDecision.allow) return;
          deps.onShowPartialSuggestion?.(suggestion);
        },
      });
    } catch {
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
  ): Promise<void> {
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
      return;
    }

    const latest = deps.getContext();
    if (latest.contextHash !== hash || !isRequestableTypingContextSnapshot(latest)) {
      state = { status: "idle" };
      return;
    }

    deps.onRequestFinished?.(suggestion);

    if (!suggestion) {
      state = { status: "idle" };
      return;
    }

    tryShowSuggestion(latest, suggestion, hash);
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

    if (!snapshot.requestable) {
      if (snapshot.suppressionReason === "secret_like_context") {
        deps.onSecretLikeContextDetected?.();
      }
      invalidate();
      return;
    }

    if (
      (state.status !== "idle" && state.contextHash === hash) ||
      activeCloudRequest?.contextHash === hash
    ) {
      return;
    }

    const triggerDecision = deps.triggerPolicy?.onContextChanged(snapshot);
    if (triggerDecision && !triggerDecision.allow) {
      invalidate();
      return;
    }

    invalidate();

    state = {
      status: "debouncing",
      contextHash: hash,
      timer: setTimeout(async () => {
        const version = requestVersion;
        if (!isCurrentDebouncedContext(hash)) {
          return;
        }

        const latest = deps.getContext();
        if (latest.contextHash !== hash) {
          state = { status: "idle" };
          return;
        }

        if (!isRequestableTypingContextSnapshot(latest)) {
          state = { status: "idle" };
          return;
        }

        const localSuggestion = await requestLocalSuggestion(latest);
        if (requestVersion !== version || !isCurrentDebouncedContext(hash)) {
          return;
        }

        if (localSuggestion) {
          tryShowSuggestion(latest, localSuggestion, hash);
          return;
        }

        if (deps.getLocalSuggestion && deps.fallbackToCloudOnLocalMiss === false) {
          state = { status: "idle" };
          return;
        }

        try {
          await requestCloudSuggestion(latest, version);
        } catch {
          if (requestVersion === version && isCurrentDebouncedContext(hash)) {
            state = { status: "idle" };
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
