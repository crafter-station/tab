import type { ActiveApplication, RedactionSummary } from "@tab/contracts";
import {
  MEMORY_EXTRACTION_WINDOW_POLICY,
  isMemoryExtractionWindowSource,
  type MemoryExtractionWindowSource,
  type MemorySource,
} from "@tab/memory-policy";
import { redactSensitiveText } from "@tab/redaction";

export type MemoryExtractionEntry = {
  readonly id: string;
  readonly timestamp: string;
  readonly activeApplication: ActiveApplication;
  readonly contextSource: MemoryExtractionWindowSource;
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
  readonly createId?: () => string;
};

const textEncoder = new TextEncoder();

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
  if (textByteLength(text) <= maxBytes) return text;

  let byteLength = 0;
  let truncated = "";

  for (const char of text) {
    const charBytes = textByteLength(char);
    if (byteLength + charBytes > maxBytes) break;
    byteLength += charBytes;
    truncated += char;
  }

  return truncated;
}

function textByteLength(text: string): number {
  return textEncoder.encode(text).length;
}

function isBufferableExtractionSource(
  source: MemoryExtractionAppendSource,
): source is MemoryExtractionEntry["contextSource"] {
  if (source !== "typed_text" && source !== "terminal_input" && source !== "pasted_text" && source !== "terminal_output") {
    return false;
  }

  return isMemoryExtractionWindowSource(source);
}

export function createMemoryExtractionWindow(deps: MemoryExtractionWindowDependencies) {
  const now = deps.now ?? (() => new Date());
  const maxAgeMs = deps.maxAgeMs ?? MEMORY_EXTRACTION_WINDOW_POLICY.maxAgeMs;
  const maxTotalTextBytes = deps.maxTotalTextBytes ?? MEMORY_EXTRACTION_WINDOW_POLICY.maxTotalTextBytes;
  const maxEntryTextBytes = deps.maxEntryTextBytes ?? MEMORY_EXTRACTION_WINDOW_POLICY.maxEntryTextBytes;
  const createId = deps.createId ?? (() => crypto.randomUUID());
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

    if (!isBufferableExtractionSource(input.source)) return false;

    const redacted = redactSensitiveText(input.text);
    const text = truncateUtf8Text(redacted.text, maxEntryTextBytes);
    if (text.trim().length === 0) return false;

    const currentTime = now();
    pruneExpired(currentTime);

    entries.push({
      id: createId(),
      timestamp: currentTime.toISOString(),
      activeApplication: { bundleId: input.activeApplication.bundleId },
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

  function clearEntries(entryIds: readonly string[]): void {
    const ids = new Set(entryIds);
    entries = entries.filter((entry) => !ids.has(entry.id));
  }

  return {
    append,
    getEntries,
    clear,
    clearEntries,
  };
}

export type MemoryExtractionWindow = ReturnType<typeof createMemoryExtractionWindow>;
