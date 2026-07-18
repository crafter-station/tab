import type { ActiveApplication } from "@tab/contracts";
import type { AppContextAccessibilityTree } from "./app-context-extractor.ts";
import type {
  TextSessionCaretBounds,
  TextSessionRange,
  TextSessionReliability,
  TextSessionSnapshot,
  TypingDeletionUnit,
} from "./typing-context.ts";

export type DesktopEventIngressHandlers = {
  readonly onReady: () => void;
  readonly onError: (message: unknown) => void;
  readonly onActiveApplicationChanged: (bundleId: string, windowId: string | null) => void;
  readonly onTextInput: (text: string) => void;
  readonly onPastedText: (text: string) => void;
  readonly onContextInvalidated: (reason: string) => void;
  readonly onDeleteBackward: (unit: TypingDeletionUnit) => void;
  readonly onSuggestNow: () => void;
  readonly onTextSessionSnapshot: (snapshot: TextSessionSnapshot) => void;
  readonly onAppContextTree: (accessibilityTree: AppContextAccessibilityTree) => void;
};

export type DesktopEventIngress = {
  handleMessage(message: unknown): void;
};

export function createDesktopEventIngress(handlers: DesktopEventIngressHandlers): DesktopEventIngress {
  return {
    handleMessage(message) {
      if (!message || typeof message !== "object") return;
      const payload = message as {
        type?: unknown;
        text?: unknown;
        unit?: unknown;
        bundleId?: unknown;
        windowId?: unknown;
        key?: unknown;
        phase?: unknown;
        message?: unknown;
        snapshot?: unknown;
        tree?: unknown;
      };

      if (payload.type === "ready") {
        handlers.onReady();
        return;
      }
      if (payload.type === "error") {
        handlers.onError(payload.message);
        return;
      }
      if (payload.type === "active-app" && typeof payload.bundleId === "string") {
        handlers.onActiveApplicationChanged(
          payload.bundleId,
          typeof payload.windowId === "string" ? payload.windowId : null,
        );
        return;
      }
      if (payload.type === "text" && typeof payload.text === "string") {
        handlers.onTextInput(payload.text);
        return;
      }
      if (payload.type === "paste" && typeof payload.text === "string") {
        handlers.onPastedText(payload.text);
        return;
      }
      if (payload.type === "context-invalidated" && typeof payload.message === "string") {
        handlers.onContextInvalidated(payload.message);
        return;
      }
      if (payload.type === "delete") {
        handlers.onDeleteBackward(payload.unit === "token" ? "token" : "character");
        return;
      }
      if (payload.type === "suggest-now") {
        handlers.onSuggestNow();
        return;
      }
      if (payload.type === "text-session" && isTextSessionSnapshot(payload.snapshot)) {
        handlers.onTextSessionSnapshot(payload.snapshot);
        return;
      }
      if (payload.type === "app-context-tree" && isAccessibilityNode(payload.tree)) {
        handlers.onAppContextTree(payload.tree);
      }
    },
  };
}

function isAccessibilityNode(value: unknown): value is AppContextAccessibilityTree {
  if (!value || typeof value !== "object") return false;
  const node = value as Partial<AppContextAccessibilityTree>;
  return (
    (node.id === undefined || typeof node.id === "string") &&
    (node.role === undefined || typeof node.role === "string") &&
    (node.subrole === undefined || typeof node.subrole === "string") &&
    (node.title === undefined || typeof node.title === "string") &&
    (node.value === undefined || typeof node.value === "string") &&
    (node.description === undefined || typeof node.description === "string") &&
    (node.label === undefined || typeof node.label === "string") &&
    (node.text === undefined || typeof node.text === "string") &&
    (node.placeholder === undefined || typeof node.placeholder === "string") &&
    (node.identifier === undefined || typeof node.identifier === "string") &&
    (node.focused === undefined || typeof node.focused === "boolean") &&
    (node.editable === undefined || typeof node.editable === "boolean") &&
    (node.hidden === undefined || typeof node.hidden === "boolean") &&
    (node.enabled === undefined || typeof node.enabled === "boolean") &&
    (node.bounds === undefined || isAccessibilityBounds(node.bounds)) &&
    (node.children === undefined || (Array.isArray(node.children) && node.children.every(isAccessibilityNode)))
  );
}

function isAccessibilityBounds(value: unknown): value is NonNullable<AppContextAccessibilityTree["bounds"]> {
  if (!value || typeof value !== "object") return false;

  const bounds = value as Partial<NonNullable<AppContextAccessibilityTree["bounds"]>>;
  return (
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height)
  );
}

export function isTextSessionSnapshot(value: unknown): value is TextSessionSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<TextSessionSnapshot>;

  return (
    isActiveApplicationOrNull(snapshot.activeApplication) &&
    isStringOrNull(snapshot.focusedElementId) &&
    isStringOrNull(snapshot.textElementId) &&
    isTextSessionRangeOrNull(snapshot.selectedRange) &&
    (snapshot.selectedText === undefined || typeof snapshot.selectedText === "string") &&
    isStringOrNull(snapshot.caretIdentity) &&
    typeof snapshot.secureLike === "boolean" &&
    isTextSessionReliability(snapshot.accessibilityReliability) &&
    (snapshot.supportsSemanticInsertion === undefined || typeof snapshot.supportsSemanticInsertion === "boolean") &&
    (snapshot.terminalTitle === undefined || typeof snapshot.terminalTitle === "string") &&
    (snapshot.terminalContents === undefined || typeof snapshot.terminalContents === "string") &&
    (snapshot.surroundingContext === undefined || isTextSessionSurroundingContext(snapshot.surroundingContext)) &&
    (snapshot.caretBounds === undefined || isTextSessionCaretBounds(snapshot.caretBounds))
  );
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isActiveApplicationOrNull(value: unknown): value is ActiveApplication | null {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;

  const app = value as Partial<ActiveApplication>;
  return typeof app.bundleId === "string" && (app.windowId === undefined || typeof app.windowId === "string");
}

function isTextSessionReliability(value: unknown): value is TextSessionReliability {
  return value === "reliable" || value === "unreliable" || value === "unavailable";
}

function isTextSessionRangeOrNull(value: unknown): value is TextSessionRange | null {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;

  const range = value as Partial<TextSessionRange>;
  return Number.isFinite(range.location) && Number.isFinite(range.length);
}

function isTextSessionSurroundingContext(value: unknown): value is NonNullable<TextSessionSnapshot["surroundingContext"]> {
  if (!value || typeof value !== "object") return false;

  const context = value as NonNullable<TextSessionSnapshot["surroundingContext"]>;
  return (
    (context.beforeCaret === undefined || typeof context.beforeCaret === "string") &&
    (context.afterCaret === undefined || typeof context.afterCaret === "string")
  );
}

function isTextSessionCaretBounds(value: unknown): value is TextSessionCaretBounds {
  if (!value || typeof value !== "object") return false;

  const bounds = value as Partial<TextSessionCaretBounds>;
  return (
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height)
  );
}
