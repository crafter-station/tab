import { getMemoryEligibility, type SuggestionContextSource } from "@tabb/memory-policy";
import { redactSensitiveText } from "@tabb/redaction";

export type ActiveApplicationLike = {
  readonly bundleId: string;
  readonly name?: string;
  readonly windowId?: string;
};

export type RedactionSummary = {
  readonly applied: boolean;
  readonly redactionCount: number;
  readonly kinds: string[];
};

export type ContextPolicyState = {
  context: string;
  activeApplication: ActiveApplicationLike | null;
  secureInput: boolean;
  paused: boolean;
  privateContext: boolean;
  contextSource: SuggestionContextSource;
  memoryEligible: boolean;
};

export type ContextSuppressionReason =
  | "empty"
  | "paused"
  | "secure_input"
  | "private_context"
  | "secret_like_context"
  | "no_active_application";

export type SafeSuggestionContext = ContextPolicyState & {
  sanitizedContext: string;
  redaction: RedactionSummary;
  contextHash: string;
  requestable: boolean;
  suppressionReason: ContextSuppressionReason | null;
};

const PASSWORD_MANAGER_BUNDLE_IDS = new Set([
  "com.apple.passwords",
  "com.1password.1password",
  "com.1password.1password7",
  "com.1password.1password8",
  "com.agilebits.onepassword",
  "com.agilebits.onepassword7",
  "com.lastpass.lastpass",
  "com.lastpass.lastpassmacdesktop",
  "com.dashlane.dashlane",
  "com.dashlane.Dashlane",
  "com.bitwarden.desktop",
]);

const PASSWORD_MANAGER_BUNDLE_ID_PATTERNS = [...PASSWORD_MANAGER_BUNDLE_IDS].map((id) =>
  id.toLowerCase(),
);

export function isPasswordManagerApplication(bundleId: string | null | undefined): boolean {
  if (!bundleId) return false;
  const normalizedBundleId = bundleId.toLowerCase();
  return PASSWORD_MANAGER_BUNDLE_ID_PATTERNS.some((id) => normalizedBundleId.includes(id));
}

export function isPrivateActiveApplication(app: ActiveApplicationLike | null): boolean {
  return isPasswordManagerApplication(app?.bundleId);
}

export function activeApplicationKey(app: ActiveApplicationLike | null): string | null {
  if (!app) return null;
  return `${app.bundleId}:${app.windowId ?? "window-unknown"}`;
}

export function buildSuggestionContextHash(
  state: Pick<ContextPolicyState, "activeApplication" | "secureInput">,
  context: string,
): string {
  return `${state.activeApplication?.bundleId ?? "none"}:${state.activeApplication?.windowId ?? "window-unknown"}:${context}:${state.secureInput}`;
}

export function decideMemoryEligibility(source: SuggestionContextSource): boolean {
  return getMemoryEligibility(source).eligible;
}

export function redactPastedSuggestionContext(text: string): string {
  return redactSensitiveText(text).text;
}

function toRedactionSummary(redaction: ReturnType<typeof redactSensitiveText>): RedactionSummary {
  return {
    applied: redaction.redactions.length > 0,
    redactionCount: redaction.redactions.length,
    kinds: [...new Set(redaction.redactions.map((item) => item.kind))],
  };
}

export function createSafeSuggestionContext(state: ContextPolicyState): SafeSuggestionContext {
  const redaction = redactSensitiveText(state.context);
  const redactionSummary = toRedactionSummary(redaction);
  const suppressionReason: ContextSuppressionReason | null = state.paused
    ? "paused"
    : state.secureInput
      ? "secure_input"
      : state.privateContext
        ? "private_context"
        : state.activeApplication === null
          ? "no_active_application"
          : state.context.trim().length === 0
            ? "empty"
            : redactionSummary.applied
              ? "secret_like_context"
              : null;

  return {
    ...state,
    sanitizedContext: redaction.text,
    redaction: redactionSummary,
    contextHash: buildSuggestionContextHash(state, redaction.text),
    requestable: suppressionReason === null,
    suppressionReason,
  };
}
