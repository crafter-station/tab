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
  readonly supportsSemanticInsertion?: boolean;
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

export function isPrivateTextSessionSnapshot(snapshot: TextSessionSnapshot): boolean {
  return snapshot.secureLike || isPrivateActiveApplication(snapshot.activeApplication);
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
  const privateContext = isPrivateTextSessionSnapshot(snapshot);
  const state: TypingContextState = {
    context: snapshot.surroundingContext?.beforeCaret ?? "",
    activeApplication: snapshot.activeApplication,
    secureInput: snapshot.secureLike,
    paused: false,
    privateContext,
    contextSource: "typed_text",
    memoryEligible: !privateContext && decideMemoryEligibility("typed_text"),
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

const MACOS_ACCENT_PICKER_REPLACEMENTS: Record<string, string> = {
  a1: "\u00e0",
  a2: "\u00e1",
  a3: "\u00e2",
  a4: "\u00e4",
  a5: "\u00e6",
  a6: "\u00e3",
  a7: "\u00e5",
  a8: "\u0101",
  c1: "\u00e7",
  c2: "\u0107",
  c3: "\u010d",
  e1: "\u00e8",
  e2: "\u00e9",
  e3: "\u00ea",
  e4: "\u00eb",
  e5: "\u0113",
  e6: "\u0117",
  e7: "\u0119",
  i1: "\u00ec",
  i2: "\u00ed",
  i3: "\u00ee",
  i4: "\u00ef",
  i5: "\u012b",
  i6: "\u012f",
  l1: "\u0142",
  n1: "\u00f1",
  n2: "\u0144",
  o1: "\u00f2",
  o2: "\u00f3",
  o3: "\u00f4",
  o4: "\u00f6",
  o5: "\u0153",
  o6: "\u00f8",
  o7: "\u014d",
  o8: "\u00f5",
  s1: "\u00df",
  s2: "\u015b",
  s3: "\u0161",
  u1: "\u00f9",
  u2: "\u00fa",
  u3: "\u00fb",
  u4: "\u00fc",
  u5: "\u016b",
  y1: "\u00ff",
  z1: "\u017e",
  z2: "\u017a",
  z3: "\u017c",
};

function normalizeMacOSAccentPickerText(text: string): string {
  return text.replace(/([aceilnosuyz])\1{1,}([1-9])/gi, (match, letter: string, selection: string) => {
    const replacement = MACOS_ACCENT_PICKER_REPLACEMENTS[`${letter.toLowerCase()}${selection}`];
    if (!replacement) return match;
    return letter === letter.toUpperCase() ? replacement.toUpperCase() : replacement;
  });
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
    context = normalizeMacOSAccentPickerText(context + text).slice(-maxLength);
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
