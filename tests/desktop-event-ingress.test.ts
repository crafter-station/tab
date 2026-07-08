import { describe, expect, it } from "bun:test";
import { createDesktopEventIngress } from "../apps/desktop/src/main/desktop-event-ingress.ts";
import type { TextSessionSnapshot, TypingDeletionUnit } from "../apps/desktop/src/main/typing-context.ts";

function makeHandlers() {
  const events: unknown[] = [];
  return {
    events,
    handlers: {
      onReady: () => events.push(["ready"]),
      onError: (message: unknown) => events.push(["error", message]),
      onActiveApplicationChanged: (bundleId: string, windowId: string | null) =>
        events.push(["active-app", bundleId, windowId]),
      onTextInput: (text: string) => events.push(["text", text]),
      onDeleteBackward: (unit: TypingDeletionUnit) => events.push(["delete", unit]),
      onOptionKeyUp: () => events.push(["option-up"]),
      onTextSessionSnapshot: (snapshot: TextSessionSnapshot) => events.push(["text-session", snapshot]),
      onAppContextTree: (accessibilityTree: unknown) => events.push(["app-context-tree", accessibilityTree]),
    },
  };
}

function textSessionSnapshot(): TextSessionSnapshot {
  return {
    activeApplication: { bundleId: "com.apple.TextEdit", windowId: "window:1" },
    focusedElementId: "focus",
    textElementId: "text",
    selectedRange: { location: 4, length: 0 },
    selectedText: "",
    caretIdentity: "range:4:0",
    secureLike: false,
    accessibilityReliability: "reliable",
    supportsSemanticInsertion: true,
    surroundingContext: { beforeCaret: "Draft", afterCaret: "" },
    caretBounds: { x: 1, y: 2, width: 3, height: 4 },
  };
}

describe("desktop event ingress", () => {
  it("translates native helper payloads into domain handlers", () => {
    const { events, handlers } = makeHandlers();
    const ingress = createDesktopEventIngress(handlers);
    const snapshot = textSessionSnapshot();
    const tree = {
      role: "AXWebArea",
      children: [{ id: "compose", role: "AXTextArea", value: "Draft", focused: true }],
    };

    ingress.handleMessage({ type: "ready" });
    ingress.handleMessage({ type: "error", message: "missing permission" });
    ingress.handleMessage({ type: "active-app", bundleId: "com.apple.TextEdit", windowId: "window:1" });
    ingress.handleMessage({ type: "text", text: "A" });
    ingress.handleMessage({ type: "delete", unit: "token" });
    ingress.handleMessage({ type: "modifier-key", key: "option", phase: "up" });
    ingress.handleMessage({ type: "text-session", snapshot });
    ingress.handleMessage({ type: "app-context-tree", tree });

    expect(events).toEqual([
      ["ready"],
      ["error", "missing permission"],
      ["active-app", "com.apple.TextEdit", "window:1"],
      ["text", "A"],
      ["delete", "token"],
      ["option-up"],
      ["text-session", snapshot],
      ["app-context-tree", tree],
    ]);
  });

  it("drops malformed native payloads instead of dispatching partial events", () => {
    const { events, handlers } = makeHandlers();
    const ingress = createDesktopEventIngress(handlers);

    ingress.handleMessage(null);
    ingress.handleMessage({ type: "active-app", bundleId: 123 });
    ingress.handleMessage({ type: "text", text: 123 });
    ingress.handleMessage({ type: "text-session", snapshot: { selectedText: 123 } });
    ingress.handleMessage({ type: "app-context-tree", tree: { bounds: { x: 1, y: 2, width: "wide", height: 4 } } });

    expect(events).toEqual([]);
  });
});
