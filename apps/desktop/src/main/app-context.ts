import type { ActiveApplication, AppContext, AppContextFragment } from "@tabb/contracts";
import { redactSensitiveText } from "@tabb/redaction";

const MAX_FRAGMENTS = 5;
const MAX_FRAGMENT_LENGTH = 2_000;
const SECRET_LIKE_CONTEXT_SUPPRESSION_REASON = "secret_like_context";
const MIN_PROVIDER_CONFIDENCE = 0.65;

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
  readonly app: string;
  readonly bundleIds: readonly string[];
  readonly adapter: AppContextAdapter;
};

const SUPPORTED_ACCESSIBILITY_ADAPTERS: readonly SupportedAccessibilityAdapter[] = [
  {
    app: "WhatsApp",
    bundleIds: ["net.whatsapp.WhatsApp", "com.whatsapp.WhatsApp"],
    adapter: { provider: "whatsapp-accessibility", kind: "conversation", confidence: 0.86 },
  },
  {
    app: "Ghostty",
    bundleIds: ["com.mitchellh.ghostty"],
    adapter: { provider: "ghostty-accessibility", kind: "terminal_session", confidence: 0.72 },
  },
  {
    app: "Obsidian",
    bundleIds: ["md.obsidian"],
    adapter: { provider: "obsidian-accessibility", kind: "document", confidence: 0.78 },
  },
  {
    app: "Zed",
    bundleIds: ["dev.zed.Zed"],
    adapter: { provider: "zed-accessibility", kind: "editor", confidence: 0.74 },
  },
  {
    app: "Chrome",
    bundleIds: ["com.google.Chrome"],
    adapter: { provider: "chrome-accessibility", kind: "browser_writing_surface", confidence: 0.7 },
  },
  {
    app: "Apple Notes",
    bundleIds: ["com.apple.Notes"],
    adapter: { provider: "notes-accessibility", kind: "document", confidence: 0.78 },
  },
  {
    app: "Apple Mail",
    bundleIds: ["com.apple.mail"],
    adapter: { provider: "mail-accessibility", kind: "conversation", confidence: 0.74 },
  },
  {
    app: "Messages",
    bundleIds: ["com.apple.MobileSMS"],
    adapter: { provider: "messages-accessibility", kind: "conversation", confidence: 0.76 },
  },
  {
    app: "Slack",
    bundleIds: ["com.tinyspeck.slackmacgap"],
    adapter: { provider: "slack-accessibility", kind: "conversation", confidence: 0.72 },
  },
  {
    app: "Discord",
    bundleIds: ["com.hnc.Discord"],
    adapter: { provider: "discord-accessibility", kind: "conversation", confidence: 0.7 },
  },
  {
    app: "VS Code",
    bundleIds: ["com.microsoft.VSCode"],
    adapter: { provider: "vscode-accessibility", kind: "editor", confidence: 0.72 },
  },
  {
    app: "TextEdit",
    bundleIds: ["com.apple.TextEdit"],
    adapter: { provider: "textedit-accessibility", kind: "document", confidence: 0.8 },
  },
];

export const APP_CONTEXT_TRUST_COPY = {
  title: "App Context",
  summary:
    "App Context is temporary, suggestion-only background from supported writing apps. It is separate from Typing Context and Personal Memory.",
  permissionScope:
    "Default App Context extraction uses Accessibility metadata and semantic text only. Tabb does not request Screen Recording, Full Disk Access, raw logs, browser history, hidden DOM, screenshots, or file reads for it.",
  memoryScope:
    "Passive app, conversation, document, web, and terminal context is not eligible for Personal Memory by default. Personal Memory remains based on eligible user-authored Typing Context and explicit user control.",
  clearingScope:
    "Pause Tabb or clear context to immediately clear both Typing Context and App Context. App Context is also cleared on app/window changes, secure input, secret-like detection, sleep, lock, and quit.",
  debugScope:
    "Debug and settings surfaces show App Context status, provider, confidence, suppression reason, and supported-app allowlist state as metadata-only diagnostics.",
} as const;

export const APP_CONTEXT_SUPPORTED_APP_MATRIX = [
  ...SUPPORTED_ACCESSIBILITY_ADAPTERS.map((entry) => ({
    app: entry.app,
    provider: entry.adapter.provider,
    allowlisted: true,
    expectedKind: entry.adapter.kind,
  })),
] as const;

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
