import { describe, expect, it } from "bun:test";
import {
  extractAppContextFromAccessibility,
  type AccessibilityTextNode,
} from "../apps/desktop/src/main/app-context.ts";

function tree(lines: string[]): AccessibilityTextNode {
  return {
    role: "AXWindow",
    children: lines.map((value) => ({ role: "AXStaticText", value })),
  };
}

describe("desktop App Context common writing app providers", () => {
  it("extracts reliable generic Accessibility text for common writing apps", () => {
    for (const bundleId of [
      "com.apple.mail",
      "com.apple.MobileSMS",
      "com.microsoft.VSCode",
      "com.apple.TextEdit",
    ]) {
      const snapshot = extractAppContextFromAccessibility(
        { bundleId },
        tree(["Project notes", "Please confirm the release checklist before Friday."]),
      );

      expect(snapshot.metadata).toMatchObject({
        provider: "generic-accessibility-text",
        status: "available",
      });
      expect(snapshot.fragments).toHaveLength(1);
      expect(snapshot.fragments[0]).toMatchObject({
        provider: "generic-accessibility-text",
        kind: "visible_text",
        memoryEligible: false,
        requestable: true,
      });
      expect(snapshot.fragments[0].text).toContain("release checklist");
      expect(snapshot.fragments[0].text.length).toBeLessThanOrEqual(1_500);
    }
  });

  it("uses app-specific providers for Notes, Slack, and Discord", () => {
    const cases = [
      {
        bundleId: "com.apple.Notes",
        provider: "apple-notes-accessibility",
        kind: "focused_note",
        text: "Remember to ask Mira about the venue contract.",
      },
      {
        bundleId: "com.tinyspeck.slackmacgap",
        provider: "slack-accessibility",
        kind: "conversation",
        text: "Dana: Can you post the incident summary in the channel?",
      },
      {
        bundleId: "com.hnc.Discord",
        provider: "discord-accessibility",
        kind: "conversation",
        text: "Kai: We are meeting in the launch voice channel after standup.",
      },
    ];

    for (const item of cases) {
      const snapshot = extractAppContextFromAccessibility({ bundleId: item.bundleId }, tree([item.text]));

      expect(snapshot.metadata).toMatchObject({ provider: item.provider, status: "available" });
      expect(snapshot.fragments[0]).toMatchObject({ provider: item.provider, kind: item.kind, memoryEligible: false });
      expect(snapshot.fragments[0].text).toBe(item.text);
    }
  });

  it("covers common writing app bundle variants without falling back to unsupported", () => {
    const cases = [
      {
        bundleId: "com.tinyspeck.slackmacgap.debug",
        provider: "slack-accessibility",
        kind: "conversation",
      },
      {
        bundleId: "com.hnc.DiscordCanary",
        provider: "discord-accessibility",
        kind: "conversation",
      },
      {
        bundleId: "com.microsoft.VSCodeInsiders",
        provider: "generic-accessibility-text",
        kind: "visible_text",
      },
      {
        bundleId: "com.visualstudio.code.oss",
        provider: "generic-accessibility-text",
        kind: "visible_text",
      },
    ];

    for (const item of cases) {
      const snapshot = extractAppContextFromAccessibility(
        { bundleId: item.bundleId },
        tree(["A reliable common writing surface exposes surrounding draft text."]),
      );

      expect(snapshot.metadata).toMatchObject({ provider: item.provider, status: "available" });
      expect(snapshot.fragments[0]).toMatchObject({ provider: item.provider, kind: item.kind });
    }
  });

  it("falls back safely for unsupported apps and low-confidence Accessibility text", () => {
    const unsupported = extractAppContextFromAccessibility(
      { bundleId: "com.example.UnsupportedWriter" },
      tree(["This app exposes text but is not allowlisted."]),
    );
    const lowConfidence = extractAppContextFromAccessibility({ bundleId: "com.apple.Notes" }, tree(["ok"]));

    expect(unsupported).toEqual({ fragments: [], metadata: { status: "unsupported" } });
    expect(lowConfidence.fragments).toHaveLength(0);
    expect(lowConfidence.metadata).toMatchObject({
      provider: "apple-notes-accessibility",
      status: "suppressed",
      suppressionReason: "low_confidence_accessibility_text",
    });
  });
});
