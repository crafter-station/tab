import type { ActiveApplication } from "@tabb/contracts";
import type { SafeTypingContextSnapshot, TextSessionSnapshot } from "./typing-context.ts";

export type InsertionStrategy = "semantic" | "clipboard";
export type InsertionOutcome = "success" | "failure";

export type ApplicationCompatibilityProfile = {
  readonly staleCount: number;
  readonly dismissalCount: number;
  readonly acceptanceCount: number;
  readonly textSessionReliableCount: number;
  readonly textSessionUnreliableCount: number;
  readonly semanticInsertionSuccessCount: number;
  readonly semanticInsertionFailureCount: number;
  readonly clipboardInsertionSuccessCount: number;
  readonly clipboardInsertionFailureCount: number;
};

export type ApplicationCompatibilityStore = {
  readonly recordStale: (snapshot: SafeTypingContextSnapshot) => void;
  readonly recordDismissal: (snapshot: SafeTypingContextSnapshot) => void;
  readonly recordAcceptance: (snapshot: SafeTypingContextSnapshot) => void;
  readonly recordTextSessionSnapshot: (snapshot: TextSessionSnapshot) => void;
  readonly recordInsertionOutcome: (
    activeApplication: ActiveApplication | null,
    strategy: InsertionStrategy,
    outcome: InsertionOutcome,
  ) => void;
  readonly getProfile: (activeApplication: ActiveApplication | null) => ApplicationCompatibilityProfile;
  readonly hasStrictTriggerBehavior: (activeApplication: ActiveApplication | null) => boolean;
  readonly shouldPreferClipboardInsertion: (activeApplication: ActiveApplication | null) => boolean;
};

type MutableApplicationCompatibilityProfile = {
  staleCount: number;
  dismissalCount: number;
  acceptanceCount: number;
  textSessionReliableCount: number;
  textSessionUnreliableCount: number;
  semanticInsertionSuccessCount: number;
  semanticInsertionFailureCount: number;
  clipboardInsertionSuccessCount: number;
  clipboardInsertionFailureCount: number;
};

export type ApplicationCompatibilityOptions = {
  readonly strictDismissalThreshold?: number;
  readonly strictStaleThreshold?: number;
  readonly strictUnreliableTextSessionThreshold?: number;
  readonly preferClipboardSemanticFailureThreshold?: number;
};

const EMPTY_PROFILE: ApplicationCompatibilityProfile = {
  staleCount: 0,
  dismissalCount: 0,
  acceptanceCount: 0,
  textSessionReliableCount: 0,
  textSessionUnreliableCount: 0,
  semanticInsertionSuccessCount: 0,
  semanticInsertionFailureCount: 0,
  clipboardInsertionSuccessCount: 0,
  clipboardInsertionFailureCount: 0,
};

const DEFAULT_STRICT_DISMISSAL_THRESHOLD = 10;
const DEFAULT_STRICT_STALE_THRESHOLD = 6;
const DEFAULT_STRICT_UNRELIABLE_TEXT_SESSION_THRESHOLD = 6;
const DEFAULT_PREFER_CLIPBOARD_SEMANTIC_FAILURE_THRESHOLD = 2;

function applicationKey(activeApplication: ActiveApplication | null): string | null {
  return activeApplication?.bundleId ?? null;
}

function createMutableProfile(): MutableApplicationCompatibilityProfile {
  return { ...EMPTY_PROFILE };
}

function readonlyProfile(profile: MutableApplicationCompatibilityProfile | undefined): ApplicationCompatibilityProfile {
  return profile ? { ...profile } : EMPTY_PROFILE;
}

export function createApplicationCompatibilityStore(
  options: ApplicationCompatibilityOptions = {},
): ApplicationCompatibilityStore {
  const strictDismissalThreshold = options.strictDismissalThreshold ?? DEFAULT_STRICT_DISMISSAL_THRESHOLD;
  const strictStaleThreshold = options.strictStaleThreshold ?? DEFAULT_STRICT_STALE_THRESHOLD;
  const strictUnreliableTextSessionThreshold = options.strictUnreliableTextSessionThreshold
    ?? DEFAULT_STRICT_UNRELIABLE_TEXT_SESSION_THRESHOLD;
  const preferClipboardSemanticFailureThreshold = options.preferClipboardSemanticFailureThreshold
    ?? DEFAULT_PREFER_CLIPBOARD_SEMANTIC_FAILURE_THRESHOLD;
  const profiles = new Map<string, MutableApplicationCompatibilityProfile>();

  function profileFor(activeApplication: ActiveApplication | null): MutableApplicationCompatibilityProfile | null {
    const key = applicationKey(activeApplication);
    if (!key) return null;

    const existing = profiles.get(key);
    if (existing) return existing;

    const created = createMutableProfile();
    profiles.set(key, created);
    return created;
  }

  return {
    recordStale(snapshot) {
      const profile = profileFor(snapshot.activeApplication);
      if (profile) profile.staleCount += 1;
    },
    recordDismissal(snapshot) {
      const profile = profileFor(snapshot.activeApplication);
      if (profile) profile.dismissalCount += 1;
    },
    recordAcceptance(snapshot) {
      const profile = profileFor(snapshot.activeApplication);
      if (profile) profile.acceptanceCount += 1;
    },
    recordTextSessionSnapshot(snapshot) {
      const profile = profileFor(snapshot.activeApplication);
      if (!profile) return;

      if (snapshot.accessibilityReliability === "reliable") {
        profile.textSessionReliableCount += 1;
      } else {
        profile.textSessionUnreliableCount += 1;
      }
    },
    recordInsertionOutcome(activeApplication, strategy, outcome) {
      const profile = profileFor(activeApplication);
      if (!profile) return;

      if (strategy === "semantic" && outcome === "success") profile.semanticInsertionSuccessCount += 1;
      if (strategy === "semantic" && outcome === "failure") profile.semanticInsertionFailureCount += 1;
      if (strategy === "clipboard" && outcome === "success") profile.clipboardInsertionSuccessCount += 1;
      if (strategy === "clipboard" && outcome === "failure") profile.clipboardInsertionFailureCount += 1;
    },
    getProfile(activeApplication) {
      const key = applicationKey(activeApplication);
      return readonlyProfile(key ? profiles.get(key) : undefined);
    },
    hasStrictTriggerBehavior(activeApplication) {
      const profile = this.getProfile(activeApplication);
      return profile.dismissalCount >= strictDismissalThreshold
        || profile.staleCount >= strictStaleThreshold
        || profile.textSessionUnreliableCount >= strictUnreliableTextSessionThreshold;
    },
    shouldPreferClipboardInsertion(activeApplication) {
      const profile = this.getProfile(activeApplication);
      return profile.semanticInsertionFailureCount >= preferClipboardSemanticFailureThreshold
        && profile.semanticInsertionFailureCount >= profile.semanticInsertionSuccessCount;
    },
  };
}
