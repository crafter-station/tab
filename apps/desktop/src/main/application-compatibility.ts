import type { ActiveApplication } from "@tab/contracts";
import type { AppContextSnapshot } from "./app-context.ts";
import type { SafeTypingContextSnapshot, TextSessionSnapshot } from "./typing-context.ts";

export type InsertionStrategy = "semantic" | "clipboard";
export type InsertionOutcome = "success" | "failure";
type AppContextStatus = AppContextSnapshot["metadata"]["status"];

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
  readonly appContextAvailableCount: number;
  readonly appContextSuppressedCount: number;
  readonly appContextUnsupportedCount: number;
};

export type ApplicationCompatibilityStore = {
  readonly recordStale: (snapshot: SafeTypingContextSnapshot) => void;
  readonly recordDismissal: (snapshot: SafeTypingContextSnapshot) => void;
  readonly recordAcceptance: (snapshot: SafeTypingContextSnapshot) => void;
  readonly recordTextSessionSnapshot: (snapshot: TextSessionSnapshot) => void;
  readonly recordAppContextSnapshot: (
    activeApplication: ActiveApplication | null,
    snapshot: AppContextSnapshot,
  ) => void;
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
  appContextAvailableCount: number;
  appContextSuppressedCount: number;
  appContextUnsupportedCount: number;
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
  appContextAvailableCount: 0,
  appContextSuppressedCount: 0,
  appContextUnsupportedCount: 0,
};

const DEFAULT_STRICT_DISMISSAL_THRESHOLD = 10;
const DEFAULT_STRICT_STALE_THRESHOLD = 6;
const DEFAULT_STRICT_UNRELIABLE_TEXT_SESSION_THRESHOLD = 6;
const DEFAULT_PREFER_CLIPBOARD_SEMANTIC_FAILURE_THRESHOLD = 2;

const INSERTION_OUTCOME_COUNTS: Record<
  InsertionStrategy,
  Record<InsertionOutcome, keyof MutableApplicationCompatibilityProfile>
> = {
  semantic: {
    success: "semanticInsertionSuccessCount",
    failure: "semanticInsertionFailureCount",
  },
  clipboard: {
    success: "clipboardInsertionSuccessCount",
    failure: "clipboardInsertionFailureCount",
  },
};

const APP_CONTEXT_STATUS_COUNTS: Partial<Record<AppContextStatus, keyof MutableApplicationCompatibilityProfile>> = {
  available: "appContextAvailableCount",
  suppressed: "appContextSuppressedCount",
  unsupported: "appContextUnsupportedCount",
};

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

  function incrementProfileCount(
    activeApplication: ActiveApplication | null,
    count: keyof MutableApplicationCompatibilityProfile,
  ): void {
    const profile = profileFor(activeApplication);
    if (!profile) return;

    profile[count] += 1;
  }

  function getProfile(activeApplication: ActiveApplication | null): ApplicationCompatibilityProfile {
    const key = applicationKey(activeApplication);
    return readonlyProfile(key ? profiles.get(key) : undefined);
  }

  return {
    recordStale(snapshot) {
      incrementProfileCount(snapshot.activeApplication, "staleCount");
    },
    recordDismissal(snapshot) {
      incrementProfileCount(snapshot.activeApplication, "dismissalCount");
    },
    recordAcceptance(snapshot) {
      incrementProfileCount(snapshot.activeApplication, "acceptanceCount");
    },
    recordTextSessionSnapshot(snapshot) {
      const count = snapshot.accessibilityReliability === "reliable"
        ? "textSessionReliableCount"
        : "textSessionUnreliableCount";
      incrementProfileCount(snapshot.activeApplication, count);
    },
    recordAppContextSnapshot(activeApplication, snapshot) {
      const count = APP_CONTEXT_STATUS_COUNTS[snapshot.metadata.status];
      if (count) incrementProfileCount(activeApplication, count);
    },
    recordInsertionOutcome(activeApplication, strategy, outcome) {
      incrementProfileCount(activeApplication, INSERTION_OUTCOME_COUNTS[strategy][outcome]);
    },
    getProfile,
    hasStrictTriggerBehavior(activeApplication) {
      const profile = getProfile(activeApplication);
      return profile.dismissalCount >= strictDismissalThreshold
        || profile.staleCount >= strictStaleThreshold
        || profile.textSessionUnreliableCount >= strictUnreliableTextSessionThreshold;
    },
    shouldPreferClipboardInsertion(activeApplication) {
      const profile = getProfile(activeApplication);
      return profile.semanticInsertionFailureCount >= preferClipboardSemanticFailureThreshold
        && profile.semanticInsertionFailureCount >= profile.semanticInsertionSuccessCount;
    },
  };
}
