import type { AppContext, AppContextFragment } from "@tab/contracts";
import { redactSensitiveText } from "@tab/redaction";

const MAX_FRAGMENTS = 5;
const MAX_FRAGMENT_LENGTH = 2_000;
const SECRET_LIKE_CONTEXT_SUPPRESSION_REASON = "secret_like_context";

export type AppContextCandidateRequestPayloadPolicy = {
  readonly maxLength: number;
  readonly preserveWholeWords?: boolean;
  readonly from?: "start" | "end";
};

export type AppContextCandidateFragment = Omit<
  AppContextFragment,
  "redaction" | "requestable" | "memoryEligible"
> & {
  readonly requestPayloadPolicy?: AppContextCandidateRequestPayloadPolicy;
};

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

function boundFragmentText(
  text: string,
  requestPayloadPolicy: AppContextCandidateRequestPayloadPolicy | undefined,
): string {
  const candidateLimit = requestPayloadPolicy?.maxLength ?? MAX_FRAGMENT_LENGTH;
  const limit = Number.isFinite(candidateLimit)
    ? Math.min(Math.max(Math.floor(candidateLimit), 0), MAX_FRAGMENT_LENGTH)
    : MAX_FRAGMENT_LENGTH;
  if (text.length <= limit) return text;

  const bounded = requestPayloadPolicy?.from === "end" ? text.slice(-limit) : text.slice(0, limit);
  if (!requestPayloadPolicy?.preserveWholeWords) return bounded;

  return requestPayloadPolicy.from === "end"
    ? bounded.replace(/^\S*\s+/, "").trim()
    : bounded.replace(/\s+\S*$/, "").trim();
}

function normalizeFragment(fragment: NormalizableAppContextFragment): NormalizedFragmentResult {
  const {
    redaction: _redaction,
    requestable: _requestable,
    memoryEligible: _memoryEligible,
    requestPayloadPolicy,
    ...candidateFragment
  } = fragment;
  const redacted = redactSensitiveText(candidateFragment.text);
  if (redacted.redactions.length > 0) return { fragment: null, sensitive: true };
  if (candidateFragment.confidence <= 0) return { fragment: null, sensitive: false };

  const text = boundFragmentText(redacted.text, requestPayloadPolicy);
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
