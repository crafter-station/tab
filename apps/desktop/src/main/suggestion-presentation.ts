import type { Suggestion } from "@tab/contracts";
import {
  isRequestableTypingContextSnapshot,
  type RequestableTypingContextSnapshot,
  type SafeTypingContextSnapshot,
} from "./typing-context.ts";
import type { TriggerPolicy, TriggerPolicySuppressionReason } from "./trigger-policy.ts";

export type SuggestionPresentationDependencies = {
  getContext(): SafeTypingContextSnapshot;
  onShowSuggestion(suggestion: Suggestion, expiresAtMs: number): void;
  onHideSuggestion(): void;
  onSuggestionStale?: (suggestion: Suggestion) => void;
  triggerPolicy?: TriggerPolicy;
  maxVisibleMs?: number;
};

type PresentOptions = {
  readonly onExpired?: () => void;
  readonly onSuppressed?: (reason: TriggerPolicySuppressionReason) => void;
};

export function createSuggestionPresentation(deps: SuggestionPresentationDependencies) {
  let visible: {
    readonly suggestion: Suggestion;
    readonly contextHash: string;
    readonly expiryTimer: ReturnType<typeof setTimeout>;
  } | null = null;

  function clear(hideVisible: boolean): void {
    if (!visible) return;
    clearTimeout(visible.expiryTimer);
    visible = null;
    if (hideVisible) deps.onHideSuggestion();
  }

  function present(
    snapshot: RequestableTypingContextSnapshot,
    suggestion: Suggestion,
    expiresAtMs = Date.now() + (deps.maxVisibleMs ?? 4_000),
    options: PresentOptions = {},
  ): number | null {
    const decision = deps.triggerPolicy?.onSuggestionCandidate(snapshot, suggestion);
    if (decision && !decision.allow) {
      options.onSuppressed?.(decision.reason);
      return null;
    }

    const remainingVisibleMs = expiresAtMs - Date.now();
    if (remainingVisibleMs <= 0) return null;

    clear(false);
    const contextHash = snapshot.contextHash;
    const expiryTimer = setTimeout(() => {
      if (!visible || visible.contextHash !== contextHash || visible.suggestion !== suggestion) return;
      visible = null;
      const current = deps.getContext();
      if (current.contextHash === contextHash) {
        deps.triggerPolicy?.recordStale(current);
        deps.onSuggestionStale?.(suggestion);
        deps.onHideSuggestion();
      }
      options.onExpired?.();
    }, remainingVisibleMs);
    visible = { suggestion, contextHash, expiryTimer };
    deps.onShowSuggestion(suggestion, expiresAtMs);
    return expiresAtMs;
  }

  function restore(
    suggestion: Suggestion,
    contextHash: string,
    expiresAtMs: number,
    options: PresentOptions = {},
  ): number | null {
    const current = deps.getContext();
    if (current.contextHash !== contextHash || !isRequestableTypingContextSnapshot(current)) {
      return null;
    }

    clear(false);
    return present(current, suggestion, expiresAtMs, options);
  }

  return { present, restore, clear };
}
