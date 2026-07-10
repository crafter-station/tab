import type { AppContext, AppContextFragment } from "@tab/contracts";
import { redactSensitiveText } from "@tab/redaction";

const MAX_FRAGMENTS = 5;
const MAX_FRAGMENT_LENGTH = 2_000;
const CHROME_WEB_PROVIDER = "chrome-web-writing-context";
const CHROME_FOCUSED_EDITABLE_LENGTH = 1_000;
const CHROME_NEARBY_VISIBLE_TEXT_LENGTH = 1_500;
const SECRET_LIKE_CONTEXT_SUPPRESSION_REASON = "secret_like_context";

export type AppContextCandidateFragment = Omit<
  AppContextFragment,
  "redaction" | "requestable" | "memoryEligible"
>;

export type AppContextCandidate = Omit<AppContext, "fragments"> & {
  fragments: AppContextCandidateFragment[];
};

type NormalizableAppContextFragment = AppContextCandidateFragment & Partial<Pick<
  AppContextFragment,
  "redaction" | "requestable" | "memoryEligible"
>>;

type NormalizedFragmentResult = {
  readonly fragment: AppContextFragment | null;
  readonly sensitive: boolean;
};

function fragmentLengthLimit(fragment: AppContextCandidateFragment): number {
  if (fragment.provider !== CHROME_WEB_PROVIDER) return MAX_FRAGMENT_LENGTH;
  if (fragment.kind === "focused_editable") return CHROME_FOCUSED_EDITABLE_LENGTH;
  if (fragment.kind === "nearby_visible_text") return CHROME_NEARBY_VISIBLE_TEXT_LENGTH;
  return MAX_FRAGMENT_LENGTH;
}

function boundFragmentText(fragment: AppContextCandidateFragment, text: string): string {
  const limit = fragmentLengthLimit(fragment);
  if (text.length <= limit) return text;

  const bounded = text.slice(0, limit);
  if (fragment.provider !== CHROME_WEB_PROVIDER) return bounded;

  return bounded.replace(/\s+\S*$/, "").trim();
}

function normalizeFragment(fragment: NormalizableAppContextFragment): NormalizedFragmentResult {
  const {
    redaction: _redaction,
    requestable: _requestable,
    memoryEligible: _memoryEligible,
    ...candidateFragment
  } = fragment;
  const redacted = redactSensitiveText(candidateFragment.text);
  if (redacted.redactions.length > 0) return { fragment: null, sensitive: true };
  if (candidateFragment.confidence <= 0) return { fragment: null, sensitive: false };

  const text = boundFragmentText(candidateFragment, redacted.text);
  if (text.trim().length === 0) return { fragment: null, sensitive: false };

  return {
    sensitive: false,
    fragment: {
      ...candidateFragment,
      text,
      redaction: { applied: false, redactionCount: 0, kinds: [] },
      requestable: true,
      memoryEligible: false,
    },
  };
}

export function normalizeAppContext(candidate: AppContextCandidate | AppContext): AppContext {
  if (candidate.metadata.status !== "available") {
    return { fragments: [], metadata: { ...candidate.metadata } };
  }

  const fragments: AppContextFragment[] = [];
  let hasSensitiveFragment = false;
  for (const candidateFragment of candidate.fragments) {
    const normalized = normalizeFragment(candidateFragment);
    hasSensitiveFragment ||= normalized.sensitive;
    if (normalized.fragment && fragments.length < MAX_FRAGMENTS) {
      fragments.push(normalized.fragment);
    }
  }

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

  if (fragments.length === 0) {
    return {
      fragments: [],
      metadata: {
        provider: candidate.metadata.provider,
        status: "empty",
        confidence: candidate.metadata.confidence,
      },
    };
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
