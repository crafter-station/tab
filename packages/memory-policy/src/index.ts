import { detectSensitiveData, type RedactionKind } from "@tabb/redaction";

export type MemorySource =
  | "typed_text"
  | "pasted_text"
  | "terminal_input"
  | "terminal_output";

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
