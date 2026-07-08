import { describe, expect, it } from "bun:test";
import {
  extractWhatsAppConversationContext,
  type AccessibilityNode,
} from "../apps/desktop/src/main/whatsapp-app-context.ts";

const whatsappApp = { bundleId: "net.whatsapp.WhatsApp", name: "WhatsApp" };

function message(description: string, overrides: Partial<AccessibilityNode> = {}): AccessibilityNode {
  return {
    role: "AXGroup",
    identifier: "message-bubble",
    description,
    ...overrides,
  };
}

describe("WhatsApp conversation App Context adapter", () => {
  it("extracts incoming and outgoing direct-message context from visible Accessibility nodes", () => {
    const snapshot = extractWhatsAppConversationContext({
      activeApplication: whatsappApp,
      accessibilityTree: {
        role: "AXWindow",
        children: [
          { role: "AXHeading", title: "Alex" },
          message("Alex\n10:41 AM\nCan you confirm the launch date?"),
          message("You\n10:42 AM\nYes, I'll confirm it today."),
        ],
      },
    });

    expect(snapshot.metadata).toMatchObject({
      provider: "whatsapp-conversation",
      status: "available",
      confidence: 0.9,
    });
    expect(snapshot.fragments).toHaveLength(1);
    expect(snapshot.fragments[0]).toMatchObject({
      provider: "whatsapp-conversation",
      kind: "conversation",
      requestable: true,
      memoryEligible: false,
    });
    expect(snapshot.fragments[0]?.text).toBe(
      "Chat: Alex\n[incoming] Alex: Can you confirm the launch date?\n[outgoing] You: Yes, I'll confirm it today.",
    );
    expect(snapshot.fragments[0]?.metadata).toMatchObject({
      chatTitle: "Alex",
      messageCount: 2,
      messages: [
        { sender: "Alex", direction: "incoming", timestamp: "10:41 AM" },
        { sender: "You", direction: "outgoing", timestamp: "10:42 AM" },
      ],
    });
  });

  it("preserves group speaker and timestamp metadata when descriptions expose it", () => {
    const snapshot = extractWhatsAppConversationContext({
      activeApplication: whatsappApp,
      accessibilityTree: {
        children: [
          { role: "AXHeading", value: "Launch team" },
          message("Maya: Can someone send the QA notes? 9:15 AM"),
          message("Ravi: I uploaded them to the folder. 9:16 AM"),
        ],
      },
    });

    expect(snapshot.metadata.status).toBe("available");
    expect(snapshot.fragments[0]?.text).toContain("[incoming] Maya: Can someone send the QA notes?");
    expect(snapshot.fragments[0]?.metadata).toMatchObject({
      chatTitle: "Launch team",
      messages: [
        { sender: "Maya", direction: "incoming", timestamp: "9:15 AM" },
        { sender: "Ravi", direction: "incoming", timestamp: "9:16 AM" },
      ],
    });
  });

  it("preserves explicit Accessibility direction metadata when sender text is absent", () => {
    const snapshot = extractWhatsAppConversationContext({
      activeApplication: whatsappApp,
      accessibilityTree: {
        children: [
          { role: "AXHeading", title: "Alex" },
          message("10:41 AM\nCan you confirm the launch date?", {
            attributes: { direction: "incoming" },
          }),
          message("10:42 AM\nYes, I'll confirm it today.", {
            attributes: { AXDirection: "outgoing" },
          }),
        ],
      },
    });

    expect(snapshot.metadata.status).toBe("available");
    expect(snapshot.fragments[0]?.text).toBe(
      "Chat: Alex\n[incoming] Can you confirm the launch date?\n[outgoing] Yes, I'll confirm it today.",
    );
    expect(snapshot.fragments[0]?.metadata).toMatchObject({
      messages: [
        { direction: "incoming", timestamp: "10:41 AM" },
        { direction: "outgoing", timestamp: "10:42 AM" },
      ],
    });
  });

  it("tolerates missing speaker and direction while keeping bounded recent visible messages", () => {
    const snapshot = extractWhatsAppConversationContext({
      activeApplication: whatsappApp,
      maxMessages: 2,
      accessibilityTree: {
        children: [
          { role: "AXHeading", title: "Family" },
          message("8:00 AM\nFirst older visible message"),
          message("8:01 AM\nSecond visible message"),
          message("8:02 AM\nLatest visible message"),
        ],
      },
    });

    expect(snapshot.fragments[0]?.text).toBe(
      "Chat: Family\n[unknown] Second visible message\n[unknown] Latest visible message",
    );
    expect(snapshot.fragments[0]?.metadata).toMatchObject({
      messageCount: 2,
      messages: [
        { direction: "unknown", timestamp: "8:01 AM" },
        { direction: "unknown", timestamp: "8:02 AM" },
      ],
    });
  });

  it("drops malformed or noisy extraction results instead of sending misleading context", () => {
    const snapshot = extractWhatsAppConversationContext({
      activeApplication: whatsappApp,
      accessibilityTree: {
        children: [
          { role: "AXHeading", title: "WhatsApp" },
          { role: "AXButton", title: "Search" },
          message("Search"),
          message("Archived chats"),
        ],
      },
    });

    expect(snapshot.fragments).toHaveLength(0);
    expect(snapshot.metadata).toMatchObject({
      provider: "whatsapp-conversation",
      status: "suppressed",
      suppressionReason: "low_confidence_extraction",
    });
  });

  it("falls back safely when WhatsApp is not active or Accessibility is unavailable", () => {
    expect(
      extractWhatsAppConversationContext({
        activeApplication: { bundleId: "com.apple.TextEdit" },
        accessibilityTree: { children: [message("Alex\n10:41 AM\nHi")] },
      }).metadata.status,
    ).toBe("unsupported");

    expect(
      extractWhatsAppConversationContext({
        activeApplication: whatsappApp,
        accessibilityTree: null,
      }).metadata.status,
    ).toBe("empty");
  });
});
