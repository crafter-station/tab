import type { ActiveApplication, AppContext, AppContextFragment } from "@tabb/contracts";
import { redactSensitiveText } from "@tabb/redaction";

const MAX_FRAGMENTS = 5;
const MAX_FRAGMENT_LENGTH = 2_000;
const MAX_EXTRACTED_TEXT_LENGTH = 1_500;
const MIN_ACCESSIBILITY_CONFIDENCE = 0.7;
const SECRET_LIKE_CONTEXT_SUPPRESSION_REASON = "secret_like_context";
const ACCESSIBILITY_TEXT_FIELDS = ["value", "title", "description"] as const;

export type AppContextSnapshot = AppContext;

export type AppContextProvider = () => AppContextSnapshot;

export type AccessibilityTextNode = {
  readonly role?: string;
  readonly value?: string;
  readonly title?: string;
  readonly description?: string;
  readonly children?: readonly AccessibilityTextNode[];
};

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

type ProviderDefinition = {
  readonly provider: string;
  readonly kind: AppContextFragment["kind"];
  readonly confidence: number;
};

const APP_SPECIFIC_PROVIDERS: Record<string, ProviderDefinition> = {
  "com.apple.Notes": {
    provider: "apple-notes-accessibility",
    kind: "focused_note",
    confidence: 0.88,
  },
  "com.tinyspeck.slackmacgap": {
    provider: "slack-accessibility",
    kind: "conversation",
    confidence: 0.82,
  },
  "com.hnc.Discord": {
    provider: "discord-accessibility",
    kind: "conversation",
    confidence: 0.8,
  },
};

const GENERIC_ACCESSIBILITY_APPS = new Set([
  "com.apple.mail",
  "com.apple.MobileSMS",
  "com.microsoft.VSCode",
  "com.apple.TextEdit",
]);

function collectAccessibilityText(node: AccessibilityTextNode, values: string[]): void {
  for (const field of ACCESSIBILITY_TEXT_FIELDS) {
    const candidate = node[field];
    const normalized = candidate?.replace(/\s+/g, " ").trim();
    if (normalized) values.push(normalized);
  }

  for (const child of node.children ?? []) {
    collectAccessibilityText(child, values);
  }
}

function extractBoundedAccessibilityText(root: AccessibilityTextNode): string {
  const values: string[] = [];
  collectAccessibilityText(root, values);
  const deduplicatedValues = [...new Set(values)];
  return deduplicatedValues.join("\n").slice(0, MAX_EXTRACTED_TEXT_LENGTH).trim();
}

function genericProviderFor(activeApplication: ActiveApplication): ProviderDefinition | null {
  if (!GENERIC_ACCESSIBILITY_APPS.has(activeApplication.bundleId)) return null;
  return { provider: "generic-accessibility-text", kind: "visible_text", confidence: 0.76 };
}

function providerDefinitionFor(activeApplication: ActiveApplication): ProviderDefinition | null {
  return APP_SPECIFIC_PROVIDERS[activeApplication.bundleId] ?? genericProviderFor(activeApplication);
}

export function extractAppContextFromAccessibility(
  activeApplication: ActiveApplication | null,
  root: AccessibilityTextNode | null,
): AppContextSnapshot {
  if (!activeApplication || !root) {
    return emptySnapshot("unsupported");
  }

  const definition = providerDefinitionFor(activeApplication);
  if (!definition) {
    return emptySnapshot("unsupported");
  }

  const text = extractBoundedAccessibilityText(root);
  const confidence = text.length >= 12 ? definition.confidence : 0.2;
  if (confidence < MIN_ACCESSIBILITY_CONFIDENCE) {
    return {
      fragments: [],
      metadata: {
        provider: definition.provider,
        status: "suppressed",
        confidence,
        suppressionReason: "low_confidence_accessibility_text",
      },
    };
  }

  return sanitizeAppContextSnapshot({
    fragments: [
      {
        id: `${definition.provider}:${activeApplication.bundleId}`,
        provider: definition.provider,
        kind: definition.kind,
        text,
        confidence,
        redaction: createSafeRedactionSummary(),
        requestable: true,
        memoryEligible: false,
      },
    ],
    metadata: { provider: definition.provider, status: "available", confidence },
  });
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
