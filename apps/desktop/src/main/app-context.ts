import type { AppContext, AppContextFragment } from "@tabb/contracts";
import { redactSensitiveText } from "@tabb/redaction";

const MAX_FRAGMENTS = 5;
const MAX_FRAGMENT_LENGTH = 2_000;
const SECRET_LIKE_CONTEXT_SUPPRESSION_REASON = "secret_like_context";

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
