import type { AppContext, AppContextFragment } from "@tabb/contracts";
import { redactSensitiveText } from "@tabb/redaction";
import type { SafeTypingContextSnapshot, TextSessionSnapshot } from "./typing-context.ts";

const MAX_FRAGMENTS = 5;
const MAX_FRAGMENT_LENGTH = 2_000;
const SECRET_LIKE_CONTEXT_SUPPRESSION_REASON = "secret_like_context";
const GHOSTTY_BUNDLE_ID = "com.mitchellh.ghostty";
const GHOSTTY_PROVIDER = "ghostty-terminal";
const MIN_GHOSTTY_CONTEXT_LENGTH = 20;
const MAX_GHOSTTY_CONTEXT_LINES = 16;
const MAX_CONTROL_CHARACTER_RATIO = 0.08;
const ANSI_OSC_SEQUENCE = /\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;
const ANSI_CSI_SEQUENCE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const NON_WHITESPACE_CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

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

function createSafeRedactionSummary(): AppContextFragment["redaction"] {
  return {
    applied: false,
    redactionCount: 0,
    kinds: [],
  };
}

function emptyGhosttySnapshot(status: AppContextSnapshot["metadata"]["status"], confidence?: number): AppContextSnapshot {
  return {
    fragments: [],
    metadata: { provider: GHOSTTY_PROVIDER, status, confidence },
  };
}

function stripAnsiControlSequences(text: string): string {
  return text
    .replace(ANSI_OSC_SEQUENCE, "")
    .replace(ANSI_CSI_SEQUENCE, "")
    .replace(NON_WHITESPACE_CONTROL_CHARACTERS, "");
}

function controlCharacterRatio(text: string): number {
  if (text.length === 0) return 0;
  const controls = text.match(CONTROL_CHARACTERS)?.length ?? 0;
  return controls / text.length;
}

function terminalSessionText(snapshot: TextSessionSnapshot): string {
  return [
    snapshot.surroundingContext?.beforeCaret ?? "",
    snapshot.selectedText ?? "",
    snapshot.surroundingContext?.afterCaret ?? "",
  ].filter(Boolean).join("\n");
}

function normalizeTerminalContext(text: string): string {
  return stripAnsiControlSequences(text)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(-MAX_GHOSTTY_CONTEXT_LINES)
    .join("\n")
    .trim()
    .slice(-MAX_FRAGMENT_LENGTH);
}

export function createGhosttyAppContextSnapshot(snapshot: SafeTypingContextSnapshot): AppContextSnapshot {
  if (snapshot.activeApplication?.bundleId !== GHOSTTY_BUNDLE_ID) {
    return emptyGhosttySnapshot("unsupported");
  }

  const textSession = snapshot.textSession;
  if (!textSession || textSession.accessibilityReliability !== "reliable" || textSession.secureLike) {
    return emptyGhosttySnapshot("empty", 0);
  }

  const rawContext = terminalSessionText(textSession);

  if (rawContext.trim().length === 0 || controlCharacterRatio(rawContext) > MAX_CONTROL_CHARACTER_RATIO) {
    return emptyGhosttySnapshot("empty", 0);
  }

  const text = normalizeTerminalContext(rawContext);
  if (text.length < MIN_GHOSTTY_CONTEXT_LENGTH) {
    return emptyGhosttySnapshot("empty", 0.4);
  }

  const confidence = 0.86;
  return {
    fragments: [
      {
        id: `ghostty:${snapshot.contextHash}`,
        provider: GHOSTTY_PROVIDER,
        kind: "terminal_visible_context",
        text,
        confidence,
        redaction: createSafeRedactionSummary(),
        requestable: true,
        memoryEligible: false,
      },
    ],
    metadata: { provider: GHOSTTY_PROVIDER, status: "available", confidence },
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
