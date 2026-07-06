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
