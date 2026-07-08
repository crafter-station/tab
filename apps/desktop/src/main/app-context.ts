import type { ActiveApplication, AppContext, AppContextFragment } from "@tab/contracts";
import { redactSensitiveText } from "@tab/redaction";
import type { SafeTypingContextSnapshot, TextSessionSnapshot } from "./typing-context.ts";

const MAX_FRAGMENTS = 5;
const MAX_FRAGMENT_LENGTH = 2_000;
const MAX_OBSIDIAN_DOCUMENT_CONTEXT_LENGTH = 1_600;
const MAX_OBSIDIAN_CONTEXT_BEFORE_CARET = 1_000;
const SECRET_LIKE_CONTEXT_SUPPRESSION_REASON = "secret_like_context";
const MIN_PROVIDER_CONFIDENCE = 0.65;
const GHOSTTY_BUNDLE_ID = "com.mitchellh.ghostty";
const GHOSTTY_PROVIDER = "ghostty-terminal";
const MIN_GHOSTTY_CONTEXT_LENGTH = 20;
const MAX_GHOSTTY_CONTEXT_LINES = 16;
const MAX_CONTROL_CHARACTER_RATIO = 0.08;
const ANSI_OSC_SEQUENCE = /\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;
const ANSI_CSI_SEQUENCE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const NON_WHITESPACE_CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;
const OBSIDIAN_PROVIDER = "obsidian-accessibility-editor";
const OBSIDIAN_BUNDLE_IDS = new Set(["md.obsidian"]);
const OBSIDIAN_CONTEXT_CONFIDENCE = 0.88;
const MISSING_OBSIDIAN_EDITOR_SEMANTICS_REASON = "missing_focused_editor_semantics";
const NOISY_OBSIDIAN_EXTRACTION_REASON = "noisy_extraction";

export type AppContextSnapshot = AppContext;

export type AppContextProvider = () => AppContextSnapshot;

export type AccessibilityContextNode = {
  readonly role?: string;
  readonly title?: string;
  readonly value?: string;
  readonly description?: string;
  readonly children?: readonly AccessibilityContextNode[];
};

export type AccessibilityAppContextInput = {
  readonly activeApplication: ActiveApplication | null;
  readonly focusedElement?: AccessibilityContextNode | null;
  readonly visibleRoot?: AccessibilityContextNode | null;
};

type ExtractableObsidianTextSession = TextSessionSnapshot & {
  readonly focusedElementId: string;
  readonly textElementId: string;
  readonly selectedRange: NonNullable<TextSessionSnapshot["selectedRange"]>;
  readonly surroundingContext: NonNullable<TextSessionSnapshot["surroundingContext"]>;
};

export type AppContextManager = {
  setSnapshot(snapshot: AppContextSnapshot): void;
  getSnapshot(): AppContextSnapshot;
  clear(): void;
};

function emptySnapshot(status: AppContextSnapshot["metadata"]["status"]): AppContextSnapshot {
  return { fragments: [], metadata: { status } };
}

type AppContextAdapter = {
  readonly provider: string;
  readonly kind: string;
  readonly confidence: number;
};

type SupportedAccessibilityAdapter = {
  readonly bundleIds: readonly string[];
  readonly adapter: AppContextAdapter;
};

const SUPPORTED_ACCESSIBILITY_ADAPTERS: readonly SupportedAccessibilityAdapter[] = [
  {
    bundleIds: ["net.whatsapp.WhatsApp", "com.whatsapp.WhatsApp"],
    adapter: { provider: "whatsapp-accessibility", kind: "conversation", confidence: 0.86 },
  },
  {
    bundleIds: ["com.mitchellh.ghostty"],
    adapter: { provider: "ghostty-accessibility", kind: "terminal_session", confidence: 0.72 },
  },
  {
    bundleIds: ["md.obsidian"],
    adapter: { provider: "obsidian-accessibility", kind: "document", confidence: 0.78 },
  },
  {
    bundleIds: ["dev.zed.Zed"],
    adapter: { provider: "zed-accessibility", kind: "editor", confidence: 0.74 },
  },
  {
    bundleIds: ["com.google.Chrome"],
    adapter: { provider: "chrome-accessibility", kind: "browser_writing_surface", confidence: 0.7 },
  },
  {
    bundleIds: ["com.apple.Notes"],
    adapter: { provider: "notes-accessibility", kind: "document", confidence: 0.78 },
  },
  {
    bundleIds: ["com.apple.mail"],
    adapter: { provider: "mail-accessibility", kind: "conversation", confidence: 0.74 },
  },
  {
    bundleIds: ["com.apple.MobileSMS"],
    adapter: { provider: "messages-accessibility", kind: "conversation", confidence: 0.76 },
  },
  {
    bundleIds: ["com.tinyspeck.slackmacgap"],
    adapter: { provider: "slack-accessibility", kind: "conversation", confidence: 0.72 },
  },
  {
    bundleIds: ["com.hnc.Discord"],
    adapter: { provider: "discord-accessibility", kind: "conversation", confidence: 0.7 },
  },
  {
    bundleIds: ["com.microsoft.VSCode"],
    adapter: { provider: "vscode-accessibility", kind: "editor", confidence: 0.72 },
  },
  {
    bundleIds: ["com.apple.TextEdit"],
    adapter: { provider: "textedit-accessibility", kind: "document", confidence: 0.8 },
  },
];

const NORMALIZED_ACCESSIBILITY_ADAPTERS: readonly SupportedAccessibilityAdapter[] =
  SUPPORTED_ACCESSIBILITY_ADAPTERS.map((entry) => ({
    ...entry,
    bundleIds: entry.bundleIds.map((bundleId) => bundleId.toLowerCase()),
  }));

function findAdapter(activeApplication: ActiveApplication | null): AppContextAdapter | null {
  if (!activeApplication) return null;
  const bundleId = activeApplication.bundleId.toLowerCase();
  const matchingEntry = NORMALIZED_ACCESSIBILITY_ADAPTERS.find((entry) =>
    entry.bundleIds.includes(bundleId),
  );

  return matchingEntry?.adapter ?? null;
}

function collectAccessibilityText(node: AccessibilityContextNode | null | undefined): string[] {
  const textValues: string[] = [];

  function visit(currentNode: AccessibilityContextNode | null | undefined): void {
    if (!currentNode) return;

    for (const value of [currentNode.value, currentNode.description, currentNode.title]) {
      const text = value?.replace(/\s+/g, " ").trim();
      if (text) textValues.push(text);
    }

    for (const child of currentNode.children ?? []) {
      visit(child);
    }
  }

  visit(node);
  return textValues;
}

function uniqueBoundedLines(lines: readonly string[]): string {
  const seen = new Set<string>();
  const uniqueLines: string[] = [];

  for (const line of lines) {
    if (seen.has(line)) continue;
    seen.add(line);
    uniqueLines.push(line);
  }

  return uniqueLines.join("\n").slice(0, MAX_FRAGMENT_LENGTH).trim();
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

function emptyObsidianSnapshot(
  status: AppContextSnapshot["metadata"]["status"],
  suppressionReason?: string,
): AppContextSnapshot {
  return emptyProviderSnapshot(OBSIDIAN_PROVIDER, status, suppressionReason);
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

function canExtractObsidianEditorContext(
  snapshot: TextSessionSnapshot,
): snapshot is ExtractableObsidianTextSession {
  return (
    !snapshot.secureLike &&
    snapshot.accessibilityReliability === "reliable" &&
    Boolean(snapshot.focusedElementId) &&
    Boolean(snapshot.textElementId) &&
    Boolean(snapshot.selectedRange) &&
    Boolean(snapshot.surroundingContext)
  );
}

function sliceObsidianContextBeforeCaret(text: string): string {
  if (text.length <= MAX_OBSIDIAN_CONTEXT_BEFORE_CARET) return text;
  const sliced = text.slice(-MAX_OBSIDIAN_CONTEXT_BEFORE_CARET);
  const headingMatches = Array.from(sliced.matchAll(/^#{1,6}\s.+$/gm));
  const nearestHeading = headingMatches.at(-1);
  if (nearestHeading?.index !== undefined) return sliced.slice(nearestHeading.index);

  const nextLine = sliced.indexOf("\n");
  return nextLine >= 0 ? sliced.slice(nextLine + 1) : sliced;
}

function sliceObsidianContextAfterCaret(text: string, remainingLength: number): string {
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
  const before = sliceObsidianContextBeforeCaret(beforeCaret);
  const remaining = Math.max(0, MAX_OBSIDIAN_DOCUMENT_CONTEXT_LENGTH - before.length);
  const after = sliceObsidianContextAfterCaret(afterCaret, remaining);
  return cleanAccessibilityText(`${before}${after}`).trim();
}

function createObsidianFragment(snapshot: ExtractableObsidianTextSession, text: string): AppContextFragment {
  return {
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
    confidence: OBSIDIAN_CONTEXT_CONFIDENCE,
    redaction: createSafeRedactionSummary(),
    requestable: true,
    memoryEligible: false,
  };
}

export function createObsidianDocumentAppContext(snapshot: TextSessionSnapshot): AppContextSnapshot {
  if (!isObsidianApplication(snapshot)) {
    return emptyObsidianSnapshot("unsupported");
  }

  if (!canExtractObsidianEditorContext(snapshot)) {
    return emptyObsidianSnapshot("empty", MISSING_OBSIDIAN_EDITOR_SEMANTICS_REASON);
  }

  const text = boundedObsidianContext(
    snapshot.surroundingContext.beforeCaret ?? "",
    snapshot.surroundingContext.afterCaret ?? "",
  );

  if (isNoisyAccessibilityText(text)) {
    return emptyObsidianSnapshot("empty", NOISY_OBSIDIAN_EXTRACTION_REASON);
  }

  const fragment = createObsidianFragment(snapshot, text);

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

export function createAccessibilityAppContextProvider(
  readInput: () => AccessibilityAppContextInput,
): AppContextProvider {
  return () => {
    const input = readInput();
    const adapter = findAdapter(input.activeApplication);
    if (!adapter) return emptySnapshot("unsupported");

    if (adapter.confidence < MIN_PROVIDER_CONFIDENCE) {
      return {
        fragments: [],
        metadata: {
          provider: adapter.provider,
          status: "suppressed",
          confidence: adapter.confidence,
          suppressionReason: "low_confidence_provider",
        },
      };
    }

    const text = uniqueBoundedLines([
      ...collectAccessibilityText(input.focusedElement),
      ...collectAccessibilityText(input.visibleRoot),
    ]);

    if (text.length === 0) {
      return {
        fragments: [],
        metadata: {
          provider: adapter.provider,
          status: "empty",
          confidence: adapter.confidence,
        },
      };
    }

    return sanitizeAppContextSnapshot({
      fragments: [
        {
          id: `${adapter.provider}:visible-context`,
          provider: adapter.provider,
          kind: adapter.kind,
          text,
          confidence: adapter.confidence,
          redaction: createSafeRedactionSummary(),
          requestable: true,
          memoryEligible: false,
        },
      ],
      metadata: {
        provider: adapter.provider,
        status: "available",
        confidence: adapter.confidence,
      },
    });
  };
}
