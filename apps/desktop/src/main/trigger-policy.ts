import type { Suggestion } from "@tab/contracts";
import type { SafeTypingContextSnapshot } from "./typing-context.ts";

export type TriggerPolicySuppressionReason =
  | "candidate_too_long";

export type TriggerPolicyDecision =
  | { readonly allow: true }
  | { readonly allow: false; readonly reason: TriggerPolicySuppressionReason };

export type TriggerPolicy = {
  readonly onContextChanged: (snapshot: SafeTypingContextSnapshot) => TriggerPolicyDecision;
  readonly onSuggestionCandidate: (
    snapshot: SafeTypingContextSnapshot,
    suggestion: Suggestion,
  ) => TriggerPolicyDecision;
  readonly recordDismissal: (snapshot: SafeTypingContextSnapshot) => void;
  readonly recordStale: (snapshot: SafeTypingContextSnapshot) => void;
};

export type PoliteTriggerPolicyOptions = {
  readonly maxSuggestionCharacters?: number;
};
const DEFAULT_MAX_SUGGESTION_CHARACTERS = 96;

function allow(): TriggerPolicyDecision {
  return { allow: true };
}

function suppress(reason: TriggerPolicySuppressionReason): TriggerPolicyDecision {
  return { allow: false, reason };
}

export function createPoliteTriggerPolicy(options: PoliteTriggerPolicyOptions = {}): TriggerPolicy {
  const maxSuggestionCharacters = options.maxSuggestionCharacters ?? DEFAULT_MAX_SUGGESTION_CHARACTERS;

  return {
    onContextChanged(_snapshot) {
      return allow();
    },
    onSuggestionCandidate(_snapshot, suggestion) {
      if (suggestion.text.length > maxSuggestionCharacters) {
        return suppress("candidate_too_long");
      }

      return allow();
    },
    recordDismissal() {},
    recordStale() {},
  };
}
