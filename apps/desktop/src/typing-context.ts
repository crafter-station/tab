import type { ActiveApplication, SuggestionContextSource } from "@tabb/contracts";
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

export function createTypingContextBuffer(maxLength = 500): TypingContextBuffer {
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
      if (app?.bundleId !== activeApplication?.bundleId) {
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
    getState() {
      return {
        context,
        activeApplication,
        secureInput,
        paused,
        privateContext: isPrivateContext(),
        contextSource: lastSource,
        memoryEligible: getMemoryEligibility(lastSource).eligible,
      };
    },
  };
}
