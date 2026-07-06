import type { ActiveApplication } from "@tabb/contracts";

export type TypingContextState = {
  context: string;
  activeApplication: ActiveApplication | null;
  secureInput: boolean;
};

export type TypingContextBuffer = {
  appendText(text: string): void;
  setActiveApplication(app: ActiveApplication | null): void;
  setSecureInput(active: boolean): void;
  clear(): void;
  getState(): TypingContextState;
};

export function createTypingContextBuffer(maxLength = 500): TypingContextBuffer {
  let context = "";
  let activeApplication: ActiveApplication | null = null;
  let secureInput = false;

  function append(text: string): void {
    if (secureInput) {
      context = "";
      return;
    }
    if (text.length === 0) return;
    context = (context + text).slice(-maxLength);
  }

  return {
    appendText(text) {
      append(text);
    },
    setActiveApplication(app) {
      if (app?.bundleId !== activeApplication?.bundleId) {
        context = "";
      }
      activeApplication = app;
    },
    setSecureInput(active) {
      secureInput = active;
      if (active) {
        context = "";
      }
    },
    clear() {
      context = "";
    },
    getState() {
      return { context, activeApplication, secureInput };
    },
  };
}
