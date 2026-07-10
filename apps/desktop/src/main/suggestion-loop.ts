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
  | { status: "requesting"; contextHash: string }
  | { status: "showing"; suggestion: Suggestion; contextHash: string; expiryTimer: ReturnType<typeof setTimeout> };

export type SuggestionSource = (
  snapshot: RequestableTypingContextSnapshot,
  options?: { signal?: AbortSignal },
) => Promise<Suggestion | null> | Suggestion | null;

export type SuggestionLoopDependencies = {
  getContext(): SafeTypingContextSnapshot;
  getLocalSuggestion?: SuggestionSource;
  requestSuggestion: SuggestionSource;
  onShowSuggestion(suggestion: Suggestion): void;
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
  let activeCloudController: AbortController | null = null;

  function isCurrentContext(hash: string): boolean {
    return state.status !== "idle" && state.contextHash === hash;
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

    try {
      return await deps.getLocalSuggestion(snapshot);
    } catch {
      return null;
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
    activeCloudController?.abort();
    activeCloudController = null;
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
    state = { status: "requesting", contextHash: hash };
    deps.onRequestStarted?.(snapshot.sanitizedContext);
    const controller = new AbortController();
    activeCloudController = controller;
    const suggestion = await deps.requestSuggestion(snapshot, { signal: controller.signal });
    if (activeCloudController === controller) {
      activeCloudController = null;
    }

    if (requestVersion !== version || !isCurrentContext(hash)) {
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

    if (state.status !== "idle" && state.contextHash === hash) {
      return;
    }

    const triggerDecision = deps.triggerPolicy?.onContextChanged(snapshot);
    if (triggerDecision && !triggerDecision.allow) {
      invalidate();
      return;
    }

    if (state.status === "showing" && state.contextHash !== hash) {
      invalidate();
    }

    if (state.status === "debouncing") {
      clearTimeout(state.timer);
    }
    activeCloudController?.abort();
    activeCloudController = null;

    requestVersion += 1;

    state = {
      status: "debouncing",
      contextHash: hash,
      timer: setTimeout(async () => {
        const version = requestVersion;
        if (!isCurrentContext(hash)) {
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
        if (requestVersion !== version || !isCurrentContext(hash)) {
          return;
        }

        if (localSuggestion) {
          tryShowSuggestion(latest, localSuggestion, hash);
          return;
        }

        await requestCloudSuggestion(latest, version);
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
