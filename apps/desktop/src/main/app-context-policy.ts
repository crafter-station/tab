import type { AppContext, AppContextFragment } from "@tab/contracts";
import { redactSensitiveText } from "@tab/redaction";

const MAX_FRAGMENTS = 5;
const MAX_FRAGMENT_LENGTH = 2_000;
const SECRET_LIKE_CONTEXT_SUPPRESSION_REASON = "secret_like_context";

export type AppContextCandidateFragment = Omit<
  AppContextFragment,
  "redaction" | "requestable" | "memoryEligible"
>;

export type AppContextCandidate = Omit<AppContext, "fragments"> & {
  fragments: AppContextCandidateFragment[];
};

function normalizeFragment(fragment: AppContextCandidateFragment): AppContextFragment | null {
  if (fragment.confidence <= 0) return null;

  const redacted = redactSensitiveText(fragment.text.slice(0, MAX_FRAGMENT_LENGTH));
  if (redacted.redactions.length > 0 || redacted.text.trim().length === 0) return null;

  return {
    ...fragment,
    text: redacted.text,
    redaction: { applied: false, redactionCount: 0, kinds: [] },
    requestable: true,
    memoryEligible: false,
  };
}

export function normalizeAppContext(candidate: AppContextCandidate): AppContext {
  const hasSensitiveFragment = candidate.fragments
    .slice(0, MAX_FRAGMENTS)
    .some((fragment) => redactSensitiveText(fragment.text.slice(0, MAX_FRAGMENT_LENGTH)).redactions.length > 0);
  if (hasSensitiveFragment) {
    return {
      fragments: [],
      metadata: {
        provider: candidate.metadata.provider,
        status: "suppressed",
        confidence: candidate.metadata.confidence,
        suppressionReason: SECRET_LIKE_CONTEXT_SUPPRESSION_REASON,
      },
    };
  }

  const fragments = candidate.fragments
    .slice(0, MAX_FRAGMENTS)
    .map(normalizeFragment)
    .filter((fragment): fragment is AppContextFragment => fragment !== null);

  if (candidate.fragments.length > 0 && fragments.length === 0) {
    return {
      fragments: [],
      metadata: {
        provider: candidate.metadata.provider,
        status: "suppressed",
        confidence: candidate.metadata.confidence,
        suppressionReason: SECRET_LIKE_CONTEXT_SUPPRESSION_REASON,
      },
    };
  }

  if (fragments.length === 0) {
    return { fragments: [], metadata: { ...candidate.metadata } };
  }

  return {
    fragments,
    metadata: {
      provider: candidate.metadata.provider ?? fragments[0]?.provider,
      status: "available",
      confidence: candidate.metadata.confidence ?? Math.max(...fragments.map((fragment) => fragment.confidence)),
    },
  };
}
