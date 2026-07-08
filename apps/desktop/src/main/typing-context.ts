import type { ActiveApplication, RedactionSummary, SuggestionContextSource } from "@tabb/contracts";
import {
  activeApplicationKey,
  buildSuggestionContextHash,
  createSafeSuggestionContext,
  decideMemoryEligibility,
  isPrivateActiveApplication,
  redactPastedSuggestionContext,
  type ContextSuppressionReason,
} from "@tabb/context-policy";

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
  deleteBackward(unit?: TypingDeletionUnit): void;
  setActiveApplication(app: ActiveApplication | null): void;
  setSecureInput(active: boolean): void;
  setPaused(active: boolean): void;
  clear(): void;
  getState(): TypingContextState;
  getSnapshot(): SafeTypingContextSnapshot;
};

export type TypingDeletionUnit = "character" | "token";

export type TypingContextSuppressionReason =
  ContextSuppressionReason;

export type TextSessionReliability = "reliable" | "unreliable" | "unavailable";

export type TextSessionRange = {
  readonly location: number;
  readonly length: number;
};

export type TextSessionCaretBounds = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type TextSessionSnapshot = {
  readonly activeApplication: ActiveApplication | null;
  readonly focusedElementId: string | null;
  readonly textElementId: string | null;
  readonly selectedRange: TextSessionRange | null;
  readonly selectedText?: string;
  readonly caretIdentity: string | null;
  readonly secureLike: boolean;
  readonly accessibilityReliability: TextSessionReliability;
  readonly surroundingContext?: {
    readonly beforeCaret?: string;
    readonly afterCaret?: string;
  };
  readonly caretBounds?: TextSessionCaretBounds;
};

export type SafeTypingContextSnapshot = TypingContextState & {
  sanitizedContext: string;
  redaction: RedactionSummary;
  contextHash: string;
  requestable: boolean;
  suppressionReason: TypingContextSuppressionReason | null;
  textSession?: TextSessionSnapshot;
};

export type RequestableTypingContextSnapshot = SafeTypingContextSnapshot & {
  readonly activeApplication: NonNullable<TypingContextState["activeApplication"]>;
  readonly requestable: true;
  readonly suppressionReason: null;
};

export function isRequestableTypingContextSnapshot(
  snapshot: SafeTypingContextSnapshot,
): snapshot is RequestableTypingContextSnapshot {
  return snapshot.requestable && snapshot.activeApplication !== null;
}

export function buildTypingContextHash(state: Pick<TypingContextState, "activeApplication" | "secureInput">, context: string): string {
  return buildSuggestionContextHash(state, context);
}

export function createSafeTypingContextSnapshot(state: TypingContextState): SafeTypingContextSnapshot {
  return createSafeSuggestionContext(state);
}

export function isReliableTextSessionSnapshot(snapshot: TextSessionSnapshot): boolean {
  return snapshot.accessibilityReliability === "reliable";
}

function rangeKey(range: TextSessionRange | null): string {
  if (!range) return "range-unknown";
  return `${range.location}:${range.length}`;
}

function textSessionIdentityKey(snapshot: TextSessionSnapshot): string {
  return [
    snapshot.activeApplication?.bundleId ?? "app-unknown",
    snapshot.activeApplication?.windowId ?? "window-unknown",
    snapshot.focusedElementId ?? "focus-unknown",
    snapshot.textElementId ?? "text-unknown",
    rangeKey(snapshot.selectedRange),
    snapshot.caretIdentity ?? "caret-unknown",
    snapshot.secureLike ? "secure" : "not-secure",
  ].join(":");
}

export function createSafeTextSessionSnapshot(snapshot: TextSessionSnapshot): SafeTypingContextSnapshot {
  const state: TypingContextState = {
    context: snapshot.surroundingContext?.beforeCaret ?? "",
    activeApplication: snapshot.activeApplication,
    secureInput: snapshot.secureLike,
    paused: false,
    privateContext: snapshot.secureLike || isPrivateActiveApplication(snapshot.activeApplication),
    contextSource: "typed_text",
    memoryEligible: decideMemoryEligibility("typed_text"),
  };
  const safeSnapshot = createSafeTypingContextSnapshot(state);
  return {
    ...safeSnapshot,
    contextHash: `${safeSnapshot.contextHash}:text-session:${textSessionIdentityKey(snapshot)}`,
    textSession: snapshot,
  };
}

export function getLastWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return words.slice(-maxWords).join(" ");
}

function removeLastCharacter(text: string): string {
  return Array.from(text).slice(0, -1).join("");
}

function removeLastToken(text: string): string {
  return text.replace(/\s*\S+\s*$/, "");
}

export function createTypingContextBuffer(maxLength = 5_000): TypingContextBuffer {
  let context = "";
  let activeApplication: ActiveApplication | null = null;
  let secureInput = false;
  let paused = false;
  let lastSource: SuggestionContextSource = "typed_text";

  function isPrivateContext(): boolean {
    return secureInput || isPrivateActiveApplication(activeApplication);
  }

  function isPasswordManagerContext(): boolean {
    return isPrivateActiveApplication(activeApplication);
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
      memoryEligible: decideMemoryEligibility(lastSource),
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
      const redactedText = redactPastedSuggestionContext(text);
      if (redactedText.length === 0) return;
      append(redactedText, "pasted_text");
    },
    deleteBackward(unit = "character") {
      if (paused) return;
      if (secureInput || isPasswordManagerContext()) {
        context = "";
        return;
      }
      context = unit === "token" ? removeLastToken(context) : removeLastCharacter(context);
      lastSource = "typed_text";
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
