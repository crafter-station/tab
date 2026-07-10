import { describe, expect, it } from "bun:test";
import {
  createChromeWebWritingContextSnapshot,
  type ChromeWebAccessibilityNode,
} from "../apps/desktop/src/main/app-context.ts";
import { normalizeAppContext } from "../apps/desktop/src/main/app-context-policy.ts";

const chrome = { bundleId: "com.google.Chrome", windowId: "window:1" };

function createSnapshot(input: Parameters<typeof createChromeWebWritingContextSnapshot>[0]) {
  return normalizeAppContext(createChromeWebWritingContextSnapshot(input));
}

function textNode(text: string, y: number, role = "AXStaticText"): ChromeWebAccessibilityNode {
  return { role, text, bounds: { x: 120, y, width: 640, height: 24 } };
}

function editable(value: string, y = 520): ChromeWebAccessibilityNode {
  return {
    id: "compose-box",
    role: "AXTextArea",
    value,
    focused: true,
    editable: true,
    bounds: { x: 120, y, width: 640, height: 96 },
  };
}

describe("Chrome web writing context adapter", () => {
  it("extracts focused editable text and nearby visible page semantics for Chrome", () => {
    const snapshot = createSnapshot({
      activeApplication: chrome,
      accessibilityTree: {
        role: "AXWebArea",
        children: [
          textNode("Alex: Can you confirm whether Friday still works?", 420),
          editable("Yes, Friday works for me.", 520),
          { ...textNode("Hidden tracking text should not appear", 540), hidden: true },
        ],
      },
    });

    expect(snapshot.metadata).toMatchObject({
      provider: "chrome-web-writing-context",
      status: "available",
    });
    expect(snapshot.fragments.map((fragment) => fragment.kind)).toEqual([
      "focused_editable",
      "nearby_visible_text",
    ]);
    expect(snapshot.fragments[0]).toMatchObject({
      text: "Yes, Friday works for me.",
      memoryEligible: false,
      requestable: true,
    });
    expect(snapshot.fragments[1]?.text).toContain("Alex: Can you confirm");
    expect(snapshot.fragments[1]?.text).not.toContain("Hidden tracking text");
  });

  it("bounds long visible page context instead of sending a full page dump", () => {
    const longParagraphs = Array.from({ length: 80 }, (_, index) =>
      textNode(`Paragraph ${index} with useful visible document context for the draft.`, 120 + index * 20),
    );

    const snapshot = createSnapshot({
      activeApplication: chrome,
      accessibilityTree: {
        role: "AXWebArea",
        children: [...longParagraphs, editable("Continue this doc", 900)],
      },
    });

    const nearby = snapshot.fragments.find((fragment) => fragment.kind === "nearby_visible_text");
    expect(nearby?.text.length).toBeLessThanOrEqual(1_500);
    expect(nearby?.text).toContain("Paragraph 0");
    expect(nearby?.text).not.toContain("Paragraph 79");
  });

  it("does not include browser URLs, navigation, sidebars, controls, or hidden DOM text", () => {
    const snapshot = createSnapshot({
      activeApplication: chrome,
      accessibilityTree: {
        role: "AXWebArea",
        children: [
          { role: "AXAddressField", value: "https://mail.google.com/mail/u/0/#inbox" },
          { role: "navigation", text: "Inbox Sent Drafts Labels" },
          { role: "AXSidebar", text: "Private project navigation" },
          { role: "AXButton", title: "Send" },
          { role: "AXStaticText", text: "Hidden older email body", hidden: true },
          textNode("Morgan: Please send the launch note today.", 440),
          editable("Draft reply", 520),
        ],
      },
    });

    const serialized = JSON.stringify(snapshot);
    expect(serialized).toContain("Morgan: Please send");
    expect(serialized).not.toContain("mail.google.com");
    expect(serialized).not.toContain("Inbox Sent");
    expect(serialized).not.toContain("Private project navigation");
    expect(serialized).not.toContain("Hidden older email body");
    expect(serialized).not.toContain("Send");
  });

  it("ignores aggregate web area text instead of treating it as nearby semantics", () => {
    const snapshot = createSnapshot({
      activeApplication: chrome,
      accessibilityTree: {
        role: "AXWebArea",
        text: "Inbox Sent Drafts Hidden archived thread Cookie banner unrelated page dump",
        children: [
          textNode("Riley: Can you review the proposal summary?", 440),
          editable("I'll review it today.", 520),
        ],
      },
    });

    const serialized = JSON.stringify(snapshot);
    expect(serialized).toContain("Riley: Can you review");
    expect(serialized).not.toContain("Hidden archived thread");
    expect(serialized).not.toContain("unrelated page dump");
  });

  it("falls back safely when Accessibility data is missing or lacks a focused editable field", () => {
    expect(
      createSnapshot({ activeApplication: chrome, accessibilityTree: null }),
    ).toMatchObject({ fragments: [], metadata: { status: "empty" } });

    expect(
      createSnapshot({
        activeApplication: chrome,
        accessibilityTree: { role: "AXWebArea", children: [textNode("Only page text", 400)] },
      }),
    ).toMatchObject({ fragments: [], metadata: { status: "empty" } });
  });

  it("does not activate for non-Chrome applications", () => {
    const snapshot = createSnapshot({
      activeApplication: { bundleId: "com.apple.TextEdit", windowId: "window:1" },
      accessibilityTree: { role: "AXWebArea", children: [textNode("Visible", 300), editable("Draft", 500)] },
    });

    expect(snapshot).toMatchObject({ fragments: [], metadata: { status: "unsupported" } });
  });

  it("suppresses noisy web controls and secret-like passive context", () => {
    const snapshot = createSnapshot({
      activeApplication: chrome,
      accessibilityTree: {
        role: "AXWebArea",
        children: [
          { role: "AXButton", title: "Bold" },
          { role: "AXButton", title: "Italic" },
          {
            role: "AXStaticText",
            text: "api_key=sk-abc1234567890",
            bounds: { x: 120, y: 420, width: 640, height: 24 },
          },
          editable("Draft", 520),
        ],
      },
    });

    expect(snapshot.fragments).toHaveLength(0);
    expect(snapshot.metadata).toMatchObject({
      status: "suppressed",
      suppressionReason: "secret_like_context",
    });
  });
});
