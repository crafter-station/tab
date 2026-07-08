import type { AppContext, AppContextFragment } from "@tabb/contracts";
import { redactSensitiveText } from "@tabb/redaction";
import type { TextSessionSnapshot } from "./typing-context.ts";

const MAX_FRAGMENTS = 5;
const MAX_FRAGMENT_LENGTH = 2_000;
const MAX_OBSIDIAN_DOCUMENT_CONTEXT_LENGTH = 1_600;
const MAX_OBSIDIAN_CONTEXT_BEFORE_CARET = 1_000;
const SECRET_LIKE_CONTEXT_SUPPRESSION_REASON = "secret_like_context";
const OBSIDIAN_PROVIDER = "obsidian-accessibility-editor";
const OBSIDIAN_BUNDLE_IDS = new Set(["md.obsidian"]);

export type AppContextSnapshot = AppContext;

export type AppContextProvider = () => AppContextSnapshot;

export type AppContextManager = {
  setSnapshot(snapshot: AppContextSnapshot): void;
  getSnapshot(): AppContextSnapshot;
  clear(): void;
};

function emptySnapshot(status: AppContextSnapshot["metadata"]["status"]): AppContextSnapshot {
  return { fragments: [], metadata: { status } };
}

function emptyProviderSnapshot(
  provider: string,
  status: AppContextSnapshot["metadata"]["status"],
  suppressionReason?: string,
): AppContextSnapshot {
  return {
    fragments: [],
    metadata: {
      provider,
      status,
      confidence: 0,
      ...(suppressionReason ? { suppressionReason } : {}),
    },
  };
}

function createSafeRedactionSummary(): AppContextFragment["redaction"] {
  return {
    applied: false,
    redactionCount: 0,
    kinds: [],
  };
}

function sanitizeFragment(fragment: AppContextFragment): AppContextFragment | null {
  if (!fragment.requestable || fragment.confidence <= 0) return null;

  const boundedText = fragment.text.slice(0, MAX_FRAGMENT_LENGTH);
  const redacted = redactSensitiveText(boundedText);
  if (redacted.redactions.length > 0 || redacted.text.trim().length === 0) {
    return null;
  }

  return {
    ...fragment,
    text: redacted.text,
    redaction: createSafeRedactionSummary(),
    memoryEligible: false,
  };
}

export function sanitizeAppContextSnapshot(snapshot: AppContextSnapshot): AppContextSnapshot {
  const fragments = snapshot.fragments
    .slice(0, MAX_FRAGMENTS)
    .map(sanitizeFragment)
    .filter((fragment): fragment is AppContextFragment => fragment !== null);

  if (snapshot.fragments.length > 0 && fragments.length === 0) {
    return {
      fragments: [],
      metadata: {
        provider: snapshot.metadata.provider,
        status: "suppressed",
        confidence: snapshot.metadata.confidence,
        suppressionReason: SECRET_LIKE_CONTEXT_SUPPRESSION_REASON,
      },
    };
  }

  if (fragments.length === 0) {
    return {
      fragments: [],
      metadata: {
        provider: snapshot.metadata.provider,
        status: snapshot.metadata.status === "cleared" ? "cleared" : "empty",
        confidence: snapshot.metadata.confidence,
      },
    };
  }

  return {
    fragments,
    metadata: {
      provider: snapshot.metadata.provider ?? fragments[0]?.provider,
      status: "available",
      confidence: snapshot.metadata.confidence ?? Math.max(...fragments.map((fragment) => fragment.confidence)),
    },
  };
}

function isObsidianApplication(snapshot: TextSessionSnapshot): boolean {
  return OBSIDIAN_BUNDLE_IDS.has(snapshot.activeApplication?.bundleId ?? "");
}

function cleanAccessibilityText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n");
}

function isNoisyAccessibilityText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 12) return true;

  const replacementCount = (trimmed.match(/\ufffd/g) ?? []).length;
  return replacementCount > 4 && replacementCount / trimmed.length > 0.2;
}

function sliceBeforeCaret(text: string): string {
  if (text.length <= MAX_OBSIDIAN_CONTEXT_BEFORE_CARET) return text;
  const sliced = text.slice(-MAX_OBSIDIAN_CONTEXT_BEFORE_CARET);
  const headingMatches = Array.from(sliced.matchAll(/^#{1,6}\s.+$/gm));
  const nearestHeading = headingMatches.at(-1);
  if (nearestHeading?.index !== undefined) return sliced.slice(nearestHeading.index);

  const nextLine = sliced.indexOf("\n");
  return nextLine >= 0 ? sliced.slice(nextLine + 1) : sliced;
}

function sliceAfterCaret(text: string, remainingLength: number): string {
  const paragraphBreak = text.indexOf("\n\n");
  const lineBreak = text.indexOf("\n");
  const semanticBreak = paragraphBreak >= 0 ? paragraphBreak : lineBreak;
  const semanticSlice = semanticBreak >= 0 ? text.slice(0, semanticBreak) : text;
  if (semanticSlice.length <= remainingLength) return semanticSlice;

  const sliced = semanticSlice.slice(0, remainingLength);
  const previousLine = sliced.lastIndexOf("\n");
  return previousLine > 0 ? sliced.slice(0, previousLine) : sliced;
}

function boundedObsidianContext(beforeCaret: string, afterCaret: string): string {
  const before = sliceBeforeCaret(beforeCaret);
  const remaining = Math.max(0, MAX_OBSIDIAN_DOCUMENT_CONTEXT_LENGTH - before.length);
  const after = sliceAfterCaret(afterCaret, remaining);
  return cleanAccessibilityText(`${before}${after}`).trim();
}

export function createObsidianDocumentAppContext(snapshot: TextSessionSnapshot): AppContextSnapshot {
  if (!isObsidianApplication(snapshot)) {
    return emptyProviderSnapshot(OBSIDIAN_PROVIDER, "unsupported");
  }

  if (
    snapshot.secureLike ||
    snapshot.accessibilityReliability !== "reliable" ||
    !snapshot.focusedElementId ||
    !snapshot.textElementId ||
    !snapshot.selectedRange ||
    !snapshot.surroundingContext
  ) {
    return emptyProviderSnapshot(
      OBSIDIAN_PROVIDER,
      "empty",
      "missing_focused_editor_semantics",
    );
  }

  const text = boundedObsidianContext(
    snapshot.surroundingContext.beforeCaret ?? "",
    snapshot.surroundingContext.afterCaret ?? "",
  );

  if (isNoisyAccessibilityText(text)) {
    return emptyProviderSnapshot(OBSIDIAN_PROVIDER, "empty", "noisy_extraction");
  }

  const fragment: AppContextFragment = {
    id: [
      OBSIDIAN_PROVIDER,
      snapshot.activeApplication?.windowId ?? "window-unknown",
      snapshot.focusedElementId,
      snapshot.textElementId,
      `${snapshot.selectedRange.location}:${snapshot.selectedRange.length}`,
    ].join(":"),
    provider: OBSIDIAN_PROVIDER,
    kind: "markdown_document",
    text,
    confidence: 0.88,
    redaction: createSafeRedactionSummary(),
    requestable: true,
    memoryEligible: false,
  };

  return sanitizeAppContextSnapshot({
    fragments: [fragment],
    metadata: {
      provider: OBSIDIAN_PROVIDER,
      status: "available",
      confidence: fragment.confidence,
    },
  });
}

export function createAppContextManager(): AppContextManager {
  let snapshot = emptySnapshot("empty");

  return {
    setSnapshot(nextSnapshot) {
      snapshot = sanitizeAppContextSnapshot(nextSnapshot);
    },
    getSnapshot() {
      return snapshot;
    },
    clear() {
      snapshot = emptySnapshot("cleared");
    },
  };
}
