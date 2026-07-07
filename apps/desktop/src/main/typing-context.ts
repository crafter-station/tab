import type { ActiveApplication, RedactionSummary, SuggestionContextSource } from "@tabb/contracts";
import { redactSensitiveText } from "@tabb/redaction";
import { getMemoryEligibility } from "@tabb/memory-policy";

export type TypingContextState = {
  context: string;
  activeApplication: ActiveApplication | null;
  secureInput: boolean;
  paused: boolean;
  privateContext: boolean;
  contextSource: SuggestionContextSource;
  memoryEligible: boolean;
};

export type TypingContextBuffer = {
  appendText(text: string, source?: SuggestionContextSource): void;
  appendPastedText(text: string): void;
  setActiveApplication(app: ActiveApplication | null): void;
  setSecureInput(active: boolean): void;
  setPaused(active: boolean): void;
  clear(): void;
  getState(): TypingContextState;
  getSnapshot(): SafeTypingContextSnapshot;
};

export type TypingContextSuppressionReason = "empty" | "paused" | "secure_input" | "private_context" | "secret_like_context";

export type SafeTypingContextSnapshot = TypingContextState & {
  sanitizedContext: string;
  redaction: RedactionSummary;
  contextHash: string;
  requestable: boolean;
  suppressionReason: TypingContextSuppressionReason | null;
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

function isPasswordManager(bundleId: string | null | undefined): boolean {
  if (!bundleId) return false;
  const normalizedBundleId = bundleId.toLowerCase();
  return PASSWORD_MANAGER_BUNDLE_ID_PATTERNS.some((id) => normalizedBundleId.includes(id));
}

export function activeApplicationKey(app: ActiveApplication | null): string | null {
  if (!app) return null;
  return `${app.bundleId}:${app.windowId ?? "window-unknown"}`;
}

export function buildTypingContextHash(state: Pick<TypingContextState, "activeApplication" | "secureInput">, context: string): string {
  return `${state.activeApplication?.bundleId ?? "none"}:${state.activeApplication?.windowId ?? "window-unknown"}:${context}:${state.secureInput}`;
}

function toRedactionSummary(redaction: ReturnType<typeof redactSensitiveText>): RedactionSummary {
  return {
    applied: redaction.redactions.length > 0,
    redactionCount: redaction.redactions.length,
    kinds: [...new Set(redaction.redactions.map((item) => item.kind))],
  };
}

export function createSafeTypingContextSnapshot(state: TypingContextState): SafeTypingContextSnapshot {
  const redaction = redactSensitiveText(state.context);
  const redactionSummary = toRedactionSummary(redaction);
  const suppressionReason: TypingContextSuppressionReason | null = state.paused
    ? "paused"
    : state.secureInput
      ? "secure_input"
      : state.privateContext
        ? "private_context"
        : state.context.trim().length === 0
          ? "empty"
          : redactionSummary.applied
            ? "secret_like_context"
            : null;

  return {
    ...state,
    sanitizedContext: redaction.text,
    redaction: redactionSummary,
    contextHash: buildTypingContextHash(state, redaction.text),
    requestable: suppressionReason === null,
    suppressionReason,
  };
}

export function getLastWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return words.slice(-maxWords).join(" ");
}

export function createTypingContextBuffer(maxLength = 5_000): TypingContextBuffer {
  let context = "";
  let activeApplication: ActiveApplication | null = null;
  let secureInput = false;
  let paused = false;
  let lastSource: SuggestionContextSource = "typed_text";

  function isPrivateContext(): boolean {
    return secureInput || isPasswordManager(activeApplication?.bundleId);
  }

  function isPasswordManagerContext(): boolean {
    return isPasswordManager(activeApplication?.bundleId);
  }

  function append(text: string, source: SuggestionContextSource): void {
    if (paused) return;
    if (secureInput) {
      context = "";
      return;
    }
    if (isPasswordManagerContext()) {
      // Do not accumulate typing context inside known password managers.
      context = "";
      return;
    }
    if (text.length === 0) return;
    lastSource = source;
    context = (context + text).slice(-maxLength);
  }

  function getState(): TypingContextState {
    return {
      context,
      activeApplication,
      secureInput,
      paused,
      privateContext: isPrivateContext(),
      contextSource: lastSource,
      memoryEligible: getMemoryEligibility(lastSource).eligible,
    };
  }

  return {
    appendText(text, source = "typed_text") {
      append(text, source);
    },
    appendPastedText(text) {
      if (paused || secureInput) return;
      if (isPasswordManagerContext()) return;
      // Pasted text may inform immediate suggestions after local redaction, but
      // it is not eligible for Personal Memory by default (ADR-0017).
      const redacted = redactSensitiveText(text);
      if (redacted.text.length === 0) return;
      append(redacted.text, "pasted_text");
    },
    setActiveApplication(app) {
      if (paused) return;
      if (activeApplicationKey(app) !== activeApplicationKey(activeApplication)) {
        context = "";
      }
      activeApplication = app;
      if (isPasswordManagerContext()) {
        context = "";
      }
    },
    setSecureInput(active) {
      secureInput = active;
      if (active) {
        context = "";
      }
    },
    setPaused(active) {
      paused = active;
      if (active) {
        context = "";
      }
    },
    clear() {
      context = "";
    },
    getState,
    getSnapshot() {
      return createSafeTypingContextSnapshot(getState());
    },
  };
}
