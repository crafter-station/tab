import { detectSensitiveData, type RedactionKind } from "@tab/redaction";

export const SUGGESTION_CONTEXT_SOURCES = [
  "typed_text",
  "pasted_text",
  "terminal_input",
] as const;

export const MEMORY_CONTEXT_SOURCES = [
  ...SUGGESTION_CONTEXT_SOURCES,
  "terminal_output",
] as const;

export const PERSONAL_MEMORY_SOURCES = [
  ...SUGGESTION_CONTEXT_SOURCES,
  "manual",
] as const;

export const MODEL_PROPOSED_MEMORY_SOURCES = [
  "typed_text",
  "terminal_input",
] as const;

export const MEMORY_EXTRACTION_WINDOW_POLICY = {
  maxAgeMs: 30 * 60 * 1_000,
  maxTotalTextBytes: 8 * 1_024,
  maxEntryTextBytes: 1 * 1_024,
  idleMs: 60_000,
  minIdleCharacters: 500,
  minIdleEntries: 5,
  maxRetries: 3,
  initialRetryDelayMs: 1_000,
  failedBatchTtlMs: 24 * 60 * 60 * 1_000,
  maxRequestEntries: 64,
} as const;

export const TERMINAL_BUNDLE_IDS = [
  "com.apple.Terminal",
  "com.googlecode.iterm2",
  "com.mitchellh.ghostty",
  "net.kovidgoyal.kitty",
  "com.microsoft.WindowsTerminal",
  "dev.tabby",
] as const;

export type SuggestionContextSource = (typeof SUGGESTION_CONTEXT_SOURCES)[number];
export type MemorySource = (typeof MEMORY_CONTEXT_SOURCES)[number];
export type PersonalMemorySource = (typeof PERSONAL_MEMORY_SOURCES)[number];
export type ModelProposedMemorySource =
  (typeof MODEL_PROPOSED_MEMORY_SOURCES)[number];

export type MemoryEligibility = {
  eligible: boolean;
  reason: string;
};

export type MemoryExtractionWindowSource = Extract<MemorySource, "typed_text" | "terminal_input">;

export type MemoryExtractionWindowEntryLike = {
  readonly text: string;
  readonly timestamp: string;
  readonly activeApplication: ActiveApplicationLike & { readonly bundleId: string };
  readonly contextSource: SuggestionContextSource;
  readonly redaction: {
    readonly applied: boolean;
    readonly redactionCount: number;
    readonly kinds: readonly string[];
  };
};

export type MemoryExtractionWindowSummary<TEntry extends MemoryExtractionWindowEntryLike> = {
  readonly typingContext: string;
  readonly contextSource: TEntry["contextSource"];
  readonly activeApplication: TEntry["activeApplication"];
  readonly redaction: {
    readonly applied: boolean;
    readonly redactionCount: number;
    readonly kinds: string[];
  };
};

export function getMemoryEligibility(source: MemorySource): MemoryEligibility {
  switch (source) {
    case "typed_text":
    case "terminal_input":
      return {
        eligible: true,
        reason: "user-authored text can create Personal Memory after guardrails",
      };
    case "pasted_text":
      return {
        eligible: false,
        reason: "pasted text can inform immediate suggestions but not memory by default",
      };
    case "terminal_output":
      return {
        eligible: false,
        reason: "terminal output is not user-authored typing context",
      };
  }
}

export function isMemoryExtractionWindowSource(
  source: MemorySource,
): source is MemoryExtractionWindowSource {
  return source === "typed_text" || source === "terminal_input";
}

export function totalMemoryExtractionCharacters(
  entries: readonly Pick<MemoryExtractionWindowEntryLike, "text">[],
): number {
  return entries.reduce((total, entry) => total + entry.text.length, 0);
}

export function getOldestMemoryExtractionTimestampMs(
  entries: readonly Pick<MemoryExtractionWindowEntryLike, "timestamp">[],
): number {
  return Math.min(...entries.map((entry) => Date.parse(entry.timestamp)));
}

export function summarizeMemoryExtractionWindow<TEntry extends MemoryExtractionWindowEntryLike>(
  entries: readonly TEntry[],
): MemoryExtractionWindowSummary<TEntry> | null {
  const firstEntry = entries[0];
  if (!firstEntry) return null;

  const redactionKinds = new Set<string>();
  let redactionCount = 0;
  let redactionApplied = false;
  for (const entry of entries) {
    redactionApplied = redactionApplied || entry.redaction.applied;
    redactionCount += entry.redaction.redactionCount;
    for (const kind of entry.redaction.kinds) {
      redactionKinds.add(kind);
    }
  }

  return {
    typingContext: entries.map((entry) => entry.text).join("\n"),
    contextSource: firstEntry.contextSource,
    activeApplication: firstEntry.activeApplication,
    redaction: {
      applied: redactionApplied,
      redactionCount,
      kinds: [...redactionKinds],
    },
  };
}

export function isEligiblePersonalMemorySource(
  source: PersonalMemorySource,
): source is ModelProposedMemorySource {
  return (MODEL_PROPOSED_MEMORY_SOURCES as readonly string[]).includes(source);
}

export type ActiveApplicationLike = {
  readonly bundleId: string;
} | null;

export function isTerminalActiveApplication(app: ActiveApplicationLike): boolean {
  if (!app) return false;
  return (TERMINAL_BUNDLE_IDS as readonly string[]).includes(app.bundleId);
}

export function classifyTypingContextSource(
  app: ActiveApplicationLike,
): SuggestionContextSource {
  return isTerminalActiveApplication(app) ? "terminal_input" : "typed_text";
}

export type MemorySafetyResult = {
  readonly safe: boolean;
  readonly reason?: string;
  readonly violations: readonly RedactionKind[];
};

/**
 * Deterministic validator that rejects content containing secrets, tokens,
 * private keys, auth headers, cookies, payment data, government identifiers,
 * and other high-entropy or high-risk patterns before it can be persisted as
 * Personal Memory.
 */
export function validateMemoryContent(content: string): MemorySafetyResult {
  const detection = detectSensitiveData(content);

  if (detection.hasSensitiveData) {
    return {
      safe: false,
      reason: `Content contains sensitive data patterns: ${detection.kinds.join(", ")}`,
      violations: detection.kinds,
    };
  }

  return {
    safe: true,
    violations: [],
  };
}
