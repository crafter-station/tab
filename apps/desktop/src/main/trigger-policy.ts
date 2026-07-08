import type { Suggestion } from "@tab/contracts";
import { isTerminalActiveApplication } from "@tab/memory-policy";
import type { ApplicationCompatibilityStore } from "./application-compatibility.ts";
import type { SafeTypingContextSnapshot } from "./typing-context.ts";

export type TriggerPolicySuppressionReason =
  | "rapid_typing"
  | "terminal_strictness"
  | "dismissal_cooldown"
  | "stale_cooldown"
  | "application_compatibility"
  | "unreliable_text_session"
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
  readonly now?: () => number;
  readonly rapidTypingMs?: number;
  readonly dismissalCooldownThreshold?: number;
  readonly dismissalCooldownMs?: number;
  readonly staleCooldownThreshold?: number;
  readonly staleCooldownMs?: number;
  readonly maxSuggestionCharacters?: number;
  readonly compatibilityStore?: ApplicationCompatibilityStore;
};

type InteractionStats = {
  dismissals: number;
  stale: number;
  cooldownUntil: number;
};

const DEFAULT_RAPID_TYPING_MS = 180;
const DEFAULT_DISMISSAL_COOLDOWN_THRESHOLD = 4;
const DEFAULT_DISMISSAL_COOLDOWN_MS = 2 * 60 * 1_000;
const DEFAULT_STALE_COOLDOWN_THRESHOLD = 3;
const DEFAULT_STALE_COOLDOWN_MS = 60 * 1_000;
const DEFAULT_MAX_SUGGESTION_CHARACTERS = 96;

const NATURAL_BOUNDARY = /[\s.,;:!?)]$/;

function allow(): TriggerPolicyDecision {
  return { allow: true };
}

function suppress(reason: TriggerPolicySuppressionReason): TriggerPolicyDecision {
  return { allow: false, reason };
}

function appPolicyKey(snapshot: SafeTypingContextSnapshot): string {
  return [
    "app",
    snapshot.activeApplication?.bundleId ?? "app-unknown",
    snapshot.activeApplication?.windowId ?? "window-unknown",
  ].join(":");
}

function policyKeys(snapshot: SafeTypingContextSnapshot): string[] {
  const textSession = snapshot.textSession;
  if (textSession?.textElementId) {
    return [
      appPolicyKey(snapshot),
      [
        "text-session",
        snapshot.activeApplication?.bundleId ?? "app-unknown",
        textSession.textElementId,
      ].join(":"),
    ];
  }

  return [appPolicyKey(snapshot)];
}

function uniquePolicyKeys(snapshot: SafeTypingContextSnapshot): string[] {
  return Array.from(new Set(policyKeys(snapshot)));
}

function statsWithLatestCooldown(stats: InteractionStats[]): InteractionStats | null {
  let latestStats: InteractionStats | null = null;

  for (const nextStats of stats) {
    if (!latestStats || nextStats.cooldownUntil > latestStats.cooldownUntil) {
      latestStats = nextStats;
    }
  }

  return latestStats;
}

function hasNaturalBoundary(context: string): boolean {
  return NATURAL_BOUNDARY.test(context);
}

export function createPoliteTriggerPolicy(options: PoliteTriggerPolicyOptions = {}): TriggerPolicy {
  const now = options.now ?? Date.now;
  const rapidTypingMs = options.rapidTypingMs ?? DEFAULT_RAPID_TYPING_MS;
  const dismissalCooldownThreshold = options.dismissalCooldownThreshold
    ?? DEFAULT_DISMISSAL_COOLDOWN_THRESHOLD;
  const dismissalCooldownMs = options.dismissalCooldownMs ?? DEFAULT_DISMISSAL_COOLDOWN_MS;
  const staleCooldownThreshold = options.staleCooldownThreshold ?? DEFAULT_STALE_COOLDOWN_THRESHOLD;
  const staleCooldownMs = options.staleCooldownMs ?? DEFAULT_STALE_COOLDOWN_MS;
  const maxSuggestionCharacters = options.maxSuggestionCharacters ?? DEFAULT_MAX_SUGGESTION_CHARACTERS;
  const compatibilityStore = options.compatibilityStore;
  const statsByKey = new Map<string, InteractionStats>();
  let lastFallbackContextChangedAt: number | null = null;

  function statsForKey(key: string): InteractionStats {
    const existing = statsByKey.get(key);
    if (existing) return existing;

    const stats: InteractionStats = { dismissals: 0, stale: 0, cooldownUntil: 0 };
    statsByKey.set(key, stats);
    return stats;
  }

  function statsForSnapshot(snapshot: SafeTypingContextSnapshot): InteractionStats[] {
    return uniquePolicyKeys(snapshot).map(statsForKey);
  }

  function activeCooldown(snapshot: SafeTypingContextSnapshot): TriggerPolicyDecision | null {
    const currentStats = statsWithLatestCooldown(
      statsForSnapshot(snapshot).filter((stats) => stats.cooldownUntil > now()),
    );

    if (!currentStats) return null;

    if (currentStats.dismissals >= dismissalCooldownThreshold) {
      return suppress("dismissal_cooldown");
    }

    return suppress("stale_cooldown");
  }

  function recordForKeys(
    snapshot: SafeTypingContextSnapshot,
    update: (stats: InteractionStats) => void,
  ): void {
    for (const stats of statsForSnapshot(snapshot)) {
      update(stats);
    }
  }

  return {
    onContextChanged(snapshot) {
      const currentTime = now();
      const elapsedSinceLastFallbackChange = lastFallbackContextChangedAt === null
        ? Number.POSITIVE_INFINITY
        : currentTime - lastFallbackContextChangedAt;

      if (snapshot.textSession && snapshot.textSession.accessibilityReliability !== "reliable") {
        return suppress("unreliable_text_session");
      }

      const cooldown = activeCooldown(snapshot);
      if (cooldown) return cooldown;

      const isTerminalContext = isTerminalActiveApplication(snapshot.activeApplication)
        || snapshot.contextSource === "terminal_input";

      if (
        compatibilityStore?.hasStrictTriggerBehavior(snapshot.activeApplication) &&
        !hasNaturalBoundary(snapshot.sanitizedContext)
      ) {
        return suppress("application_compatibility");
      }

      if (isTerminalContext) {
        if (hasNaturalBoundary(snapshot.sanitizedContext)) {
          return allow();
        }

        return suppress("terminal_strictness");
      }

      if (
        !snapshot.textSession &&
        !hasNaturalBoundary(snapshot.sanitizedContext) &&
        elapsedSinceLastFallbackChange < rapidTypingMs
      ) {
        lastFallbackContextChangedAt = currentTime;
        return suppress("rapid_typing");
      }

      if (!snapshot.textSession) {
        lastFallbackContextChangedAt = currentTime;
      }

      return allow();
    },
    onSuggestionCandidate(_snapshot, suggestion) {
      if (suggestion.text.length > maxSuggestionCharacters) {
        return suppress("candidate_too_long");
      }

      return allow();
    },
    recordDismissal(snapshot) {
      recordForKeys(snapshot, (currentStats) => {
        currentStats.dismissals += 1;
        if (currentStats.dismissals >= dismissalCooldownThreshold) {
          currentStats.cooldownUntil = Math.max(currentStats.cooldownUntil, now() + dismissalCooldownMs);
        }
      });
    },
    recordStale(snapshot) {
      recordForKeys(snapshot, (currentStats) => {
        currentStats.stale += 1;
        if (currentStats.stale >= staleCooldownThreshold) {
          currentStats.cooldownUntil = Math.max(currentStats.cooldownUntil, now() + staleCooldownMs);
        }
      });
    },
  };
}
