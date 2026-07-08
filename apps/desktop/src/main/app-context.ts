import type { AppContext, AppContextFragment } from "@tabb/contracts";
import { redactSensitiveText } from "@tabb/redaction";
import type { SafeTypingContextSnapshot } from "./typing-context.ts";

const MAX_FRAGMENTS = 5;
const MAX_FRAGMENT_LENGTH = 2_000;
const ZED_PROVIDER = "zed-focused-editor";
const ZED_BUNDLE_IDS = new Set(["dev.zed.Zed", "dev.zed.Zed-Preview"]);
const ZED_CONTEXT_CONFIDENCE = 0.82;
const FOCUSED_EDITOR_BEFORE_CARET_RATIO = 0.7;
const MIN_EDITOR_CONTEXT_LENGTH = 8;
const SECRET_LIKE_CONTEXT_SUPPRESSION_REASON = "secret_like_context";
const CODE_LIKE_CONTEXT_SUPPRESSION_REASON = "code_like_context";
const COMMENT_LINE_MARKER_PATTERN = /^(\/\/|\/\*|\*|#|<!--)/;
const COMMENT_MARKER_PATTERN = /^(\/\/|\/\*+|\*|#+|<!--)\s*/;
const COMMENT_END_MARKER_PATTERN = /\s*(\*\/|-->)$/;
const PROSE_COMMENT_PATTERN = /[A-Za-z][A-Za-z\s,'-]{12,}/;
const CODE_LIKE_LINE_PATTERN = /[{};]|=>|^(function|const|let|var|return|import|export|class|if|for|while|switch|try|catch)\b/;

export type AppContextSnapshot = AppContext;

export type AppContextProvider = () => AppContextSnapshot;

export type SnapshotAppContextProvider = (snapshot: SafeTypingContextSnapshot) => AppContextSnapshot;

export type AppContextManager = {
  setSnapshot(snapshot: AppContextSnapshot): void;
  getSnapshot(): AppContextSnapshot;
  clear(): void;
};

function emptySnapshot(status: AppContextSnapshot["metadata"]["status"]): AppContextSnapshot {
  return { fragments: [], metadata: { status } };
}

function createSafeRedactionSummary(): AppContextFragment["redaction"] {
  return {
    applied: false,
    redactionCount: 0,
    kinds: [],
  };
}

function createEmptyZedSnapshot(status: AppContextSnapshot["metadata"]["status"]): AppContextSnapshot {
  return { fragments: [], metadata: { provider: ZED_PROVIDER, status } };
}

function createSuppressedZedSnapshot(suppressionReason: string): AppContextSnapshot {
  return { fragments: [], metadata: { provider: ZED_PROVIDER, status: "suppressed", suppressionReason } };
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

function takeTrailingText(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : text.slice(text.length - maxLength);
}

function takeLeadingText(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

function buildBoundedFocusedEditorText(beforeCaret: string, afterCaret: string): string {
  const beforeCaretBudget = Math.ceil(MAX_FRAGMENT_LENGTH * FOCUSED_EDITOR_BEFORE_CARET_RATIO);
  const afterCaretBudget = MAX_FRAGMENT_LENGTH - beforeCaretBudget;
  const before = takeTrailingText(beforeCaret, beforeCaretBudget).trimStart();
  const after = takeLeadingText(afterCaret, afterCaretBudget).trimEnd();

  return [before, after].filter((part) => part.trim().length > 0).join("");
}

function isProseCommentLine(line: string): boolean {
  const trimmed = line.trim();
  if (!COMMENT_LINE_MARKER_PATTERN.test(trimmed)) return false;

  const withoutMarker = trimmed.replace(COMMENT_MARKER_PATTERN, "").replace(COMMENT_END_MARKER_PATTERN, "");
  return PROSE_COMMENT_PATTERN.test(withoutMarker);
}

function isCodeLikeFocusedEditorText(text: string): boolean {
  const meaningfulLines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (meaningfulLines.length < 3 || meaningfulLines.some(isProseCommentLine)) return false;

  const codeLikeLines = meaningfulLines.filter((line) => CODE_LIKE_LINE_PATTERN.test(line));

  return codeLikeLines.length >= 3 && codeLikeLines.length / meaningfulLines.length >= 0.6;
}

function isZedBundleId(bundleId: string | undefined): boolean {
  return bundleId ? ZED_BUNDLE_IDS.has(bundleId) : false;
}

export function createZedFocusedEditorAppContextProvider(): SnapshotAppContextProvider {
  return (snapshot) => {
    const textSession = snapshot.textSession;
    if (!isZedBundleId(snapshot.activeApplication?.bundleId)) {
      return createEmptyZedSnapshot("unsupported");
    }
    if (!textSession || textSession.accessibilityReliability !== "reliable" || textSession.secureLike) {
      return createEmptyZedSnapshot("empty");
    }

    const beforeCaret = textSession.surroundingContext?.beforeCaret ?? "";
    const afterCaret = textSession.surroundingContext?.afterCaret ?? "";
    const text = buildBoundedFocusedEditorText(beforeCaret, afterCaret);
    if (text.trim().length < MIN_EDITOR_CONTEXT_LENGTH) {
      return createEmptyZedSnapshot("empty");
    }
    if (isCodeLikeFocusedEditorText(text)) {
      return createSuppressedZedSnapshot(CODE_LIKE_CONTEXT_SUPPRESSION_REASON);
    }

    return sanitizeAppContextSnapshot({
      fragments: [
        {
          id: `${ZED_PROVIDER}:${snapshot.contextHash}`,
          provider: ZED_PROVIDER,
          kind: "focused_editor",
          text,
          confidence: ZED_CONTEXT_CONFIDENCE,
          redaction: createSafeRedactionSummary(),
          requestable: true,
          memoryEligible: false,
        },
      ],
      metadata: {
        provider: ZED_PROVIDER,
        status: "available",
        confidence: ZED_CONTEXT_CONFIDENCE,
      },
    });
  };
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
