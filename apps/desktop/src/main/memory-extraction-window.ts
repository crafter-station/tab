import type { ActiveApplication, RedactionSummary } from "@tabb/contracts";
import { getMemoryEligibility, type MemorySource } from "@tabb/memory-policy";
import { redactSensitiveText } from "@tabb/redaction";

export type MemoryExtractionEntry = {
  readonly timestamp: string;
  readonly activeApplicationBundleId: string;
  readonly contextSource: Extract<MemorySource, "typed_text" | "terminal_input">;
  readonly text: string;
  readonly redaction: RedactionSummary;
};

export type MemoryExtractionAppendSource =
  | MemorySource
  | "suggestion_text"
  | "accepted_suggestion_text";

export type MemoryExtractionAppendInput = {
  readonly text: string;
  readonly source: MemoryExtractionAppendSource;
  readonly activeApplication: ActiveApplication;
};

export type MemoryExtractionWindowDependencies = {
  readonly memoryEnabled: boolean | (() => boolean);
  readonly now?: () => Date;
  readonly maxAgeMs?: number;
  readonly maxTotalTextBytes?: number;
  readonly maxEntryTextBytes?: number;
};

const DEFAULT_MAX_AGE_MS = 30 * 60 * 1_000;
const DEFAULT_MAX_TOTAL_TEXT_BYTES = 8 * 1_024;
const DEFAULT_MAX_ENTRY_TEXT_BYTES = 1 * 1_024;

function getMemoryEnabled(value: MemoryExtractionWindowDependencies["memoryEnabled"]): boolean {
  return typeof value === "function" ? value() : value;
}

function toRedactionSummary(result: ReturnType<typeof redactSensitiveText>): RedactionSummary {
  return {
    applied: result.redactions.length > 0,
    redactionCount: result.redactions.length,
    kinds: [...new Set(result.redactions.map((redaction) => redaction.kind))],
  };
}

function truncateUtf8Text(text: string, maxBytes: number): string {
  if (new TextEncoder().encode(text).length <= maxBytes) return text;

  let byteLength = 0;
  let truncated = "";
  const encoder = new TextEncoder();

  for (const char of text) {
    const charBytes = encoder.encode(char).length;
    if (byteLength + charBytes > maxBytes) break;
    byteLength += charBytes;
    truncated += char;
  }

  return truncated;
}

function textByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function isEligibleExtractionSource(
  source: MemoryExtractionAppendSource,
): source is MemoryExtractionEntry["contextSource"] {
  return source === "typed_text" || source === "terminal_input";
}

export function createMemoryExtractionWindow(deps: MemoryExtractionWindowDependencies) {
  const now = deps.now ?? (() => new Date());
  const maxAgeMs = deps.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const maxTotalTextBytes = deps.maxTotalTextBytes ?? DEFAULT_MAX_TOTAL_TEXT_BYTES;
  const maxEntryTextBytes = deps.maxEntryTextBytes ?? DEFAULT_MAX_ENTRY_TEXT_BYTES;
  let entries: MemoryExtractionEntry[] = [];

  function pruneExpired(currentTime: Date): void {
    const oldestAllowed = currentTime.getTime() - maxAgeMs;
    entries = entries.filter((entry) => Date.parse(entry.timestamp) >= oldestAllowed);
  }

  function pruneToTotalLimit(): void {
    let totalBytes = entries.reduce((total, entry) => total + textByteLength(entry.text), 0);

    while (entries.length > 0 && totalBytes > maxTotalTextBytes) {
      const removed = entries.shift();
      if (!removed) break;
      totalBytes -= textByteLength(removed.text);
    }
  }

  function append(input: MemoryExtractionAppendInput): boolean {
    if (!getMemoryEnabled(deps.memoryEnabled)) {
      entries = [];
      return false;
    }

    if (input.source === "suggestion_text" || input.source === "accepted_suggestion_text") {
      return false;
    }

    if (!isEligibleExtractionSource(input.source)) {
      return false;
    }

    const eligibility = getMemoryEligibility(input.source);
    if (!eligibility.eligible) {
      return false;
    }

    const redacted = redactSensitiveText(input.text);
    const text = truncateUtf8Text(redacted.text, maxEntryTextBytes);
    if (text.trim().length === 0) return false;

    const currentTime = now();
    pruneExpired(currentTime);

    entries.push({
      timestamp: currentTime.toISOString(),
      activeApplicationBundleId: input.activeApplication.bundleId,
      contextSource: input.source,
      text,
      redaction: toRedactionSummary(redacted),
    });
    pruneToTotalLimit();

    return true;
  }

  function getEntries(): readonly MemoryExtractionEntry[] {
    if (!getMemoryEnabled(deps.memoryEnabled)) {
      entries = [];
      return [];
    }

    pruneExpired(now());
    return structuredClone(entries);
  }

  function clear(): void {
    entries = [];
  }

  return {
    append,
    getEntries,
    clear,
  };
}

export type MemoryExtractionWindow = ReturnType<typeof createMemoryExtractionWindow>;
