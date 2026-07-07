import { detectSensitiveData, type RedactionKind } from "@tabb/redaction";

export const SUGGESTION_CONTEXT_SOURCES = [
  "typed_text",
  "pasted_text",
  "terminal_input",
] as const;

export const MEMORY_CONTEXT_SOURCES = [
  ...SUGGESTION_CONTEXT_SOURCES,
  "terminal_output",
] as const;

export const PERSONAL_MEMORY_SOURCES = [
  ...SUGGESTION_CONTEXT_SOURCES,
  "manual",
] as const;

export const MODEL_PROPOSED_MEMORY_SOURCES = [
  "typed_text",
  "terminal_input",
] as const;

export const TERMINAL_BUNDLE_IDS = [
  "com.apple.Terminal",
  "com.googlecode.iterm2",
  "com.mitchellh.ghostty",
  "net.kovidgoyal.kitty",
  "com.microsoft.WindowsTerminal",
  "dev.tabby",
] as const;

export type SuggestionContextSource = (typeof SUGGESTION_CONTEXT_SOURCES)[number];
export type MemorySource = (typeof MEMORY_CONTEXT_SOURCES)[number];
export type PersonalMemorySource = (typeof PERSONAL_MEMORY_SOURCES)[number];
export type ModelProposedMemorySource =
  (typeof MODEL_PROPOSED_MEMORY_SOURCES)[number];

export type MemoryEligibility = {
  eligible: boolean;
  reason: string;
};

export function getMemoryEligibility(source: MemorySource): MemoryEligibility {
  switch (source) {
    case "typed_text":
    case "terminal_input":
      return {
        eligible: true,
        reason: "user-authored text can create Personal Memory after guardrails",
      };
    case "pasted_text":
      return {
        eligible: false,
        reason: "pasted text can inform immediate suggestions but not memory by default",
      };
    case "terminal_output":
      return {
        eligible: false,
        reason: "terminal output is not user-authored typing context",
      };
  }
}

export function isEligiblePersonalMemorySource(
  source: PersonalMemorySource,
): source is ModelProposedMemorySource {
  return (MODEL_PROPOSED_MEMORY_SOURCES as readonly string[]).includes(source);
}

export type ActiveApplicationLike = {
  readonly bundleId: string;
} | null;

export function isTerminalActiveApplication(app: ActiveApplicationLike): boolean {
  if (!app) return false;
  return (TERMINAL_BUNDLE_IDS as readonly string[]).includes(app.bundleId);
}

export function classifyTypingContextSource(
  app: ActiveApplicationLike,
): SuggestionContextSource {
  return isTerminalActiveApplication(app) ? "terminal_input" : "typed_text";
}

export type MemorySafetyResult = {
  readonly safe: boolean;
  readonly reason?: string;
  readonly violations: readonly RedactionKind[];
};

/**
 * Deterministic validator that rejects content containing secrets, tokens,
 * private keys, auth headers, cookies, payment data, government identifiers,
 * and other high-entropy or high-risk patterns before it can be persisted as
 * Personal Memory.
 */
export function validateMemoryContent(content: string): MemorySafetyResult {
  const detection = detectSensitiveData(content);

  if (detection.hasSensitiveData) {
    return {
      safe: false,
      reason: `Content contains sensitive data patterns: ${detection.kinds.join(", ")}`,
      violations: detection.kinds,
    };
  }

  return {
    safe: true,
    violations: [],
  };
}
