import { describe, expect, it } from "bun:test";
import {
  createSuggestionAcceptance,
  type InsertionDependencies,
} from "../apps/desktop/src/main/acceptance.ts";
import type { TextSessionSnapshot } from "../apps/desktop/src/main/typing-context.ts";

function insertion(overrides: Partial<InsertionDependencies> = {}): InsertionDependencies {
  return {
    getCurrentSuggestion: () => ({ id: "sg-local-1", text: " hello, world!" }),
    getPreviouslyActiveApplication: () => ({ bundleId: "com.apple.TextEdit" }),
    setClipboard: async () => "previous",
    sendPaste: async () => {},
    restoreClipboard: async () => {},
    ...overrides,
  };
}

describe("Suggestion Acceptance", () => {
  const rewriteTarget: TextSessionSnapshot = {
    activeApplication: { bundleId: "com.apple.TextEdit", windowId: "window:1" },
    focusedElementId: "focus:1",
    textElementId: "text:1",
    selectedRange: { location: 7, length: 5 },
    selectedText: "Draft",
    caretIdentity: "range:7:5",
    secureLike: false,
    accessibilityReliability: "reliable",
    surroundingContext: { beforeCaret: "Before ", afterCaret: " after" },
  };

  it("blocks only local Acceptance when its allowance is exhausted", async () => {
    const events: string[] = [];
    const acceptance = createSuggestionAcceptance({
      canAcceptLocalSuggestion: () => false,
      onLocalAllowanceExhausted: () => events.push("allowance_exhausted"),
      recordAcceptance: () => events.push("accepted"),
    });
    const blockedInsertion = insertion({
      setClipboard: async () => {
        events.push("inserted");
        return "previous";
      },
    });

    expect(await acceptance.accept({
      candidate: {
        suggestion: { id: "sg-local-1", text: " blocked words" },
        provenance: "automatic",
      },
      insertion: blockedInsertion,
    })).toBe("allowance_exhausted");
    expect(events).toEqual(["allowance_exhausted"]);

    expect(await acceptance.accept({
      candidate: {
        suggestion: { id: "sg-deep-1", text: " allowed words" },
        provenance: "deep_complete",
      },
      insertion: blockedInsertion,
    })).toBe("inserted");
    expect(events).toEqual(["allowance_exhausted", "inserted", "accepted"]);
  });

  it("records successful local Acceptance once with accepted value", async () => {
    const events: string[] = [];
    const usage: unknown[] = [];
    const telemetry: unknown[] = [];
    const acceptance = createSuggestionAcceptance({
      createAcceptanceId: () => "acceptance-1",
      now: () => new Date("2026-07-14T12:00:00.000Z"),
      recordAcceptance: () => events.push("accepted"),
      recordInteractionTelemetry: (event) => telemetry.push(event),
      onLocalSuggestionAccepted: (suggestionId) => events.push(`history:${suggestionId}`),
      recordAcceptedUsage: (event) => usage.push(event),
    });

    expect(await acceptance.accept({
      candidate: {
        suggestion: { id: "sg-local-1", text: " hello, world!" },
        provenance: "automatic",
      },
      insertion: insertion(),
    })).toBe("inserted");

    expect(events).toEqual(["accepted", "history:sg-local-1"]);
    expect(telemetry).toEqual([{
      acceptanceId: "acceptance-1",
      acceptedWordCount: 2,
      acceptedCharacterCount: 14,
    }]);
    expect(usage).toEqual([{
      acceptanceId: "acceptance-1",
      acceptedAt: "2026-07-14T12:00:00.000Z",
      wordCount: 2,
      characterCount: 14,
    }]);
  });

  it("does not account for failed insertion", async () => {
    const events: string[] = [];
    const acceptance = createSuggestionAcceptance({
      recordAcceptance: () => events.push("accepted"),
      recordInteractionTelemetry: () => events.push("telemetry"),
      recordAcceptedUsage: () => events.push("usage"),
      onLocalSuggestionAccepted: () => events.push("history"),
    });

    await expect(acceptance.accept({
      candidate: {
        suggestion: { id: "sg-local-1", text: " failed words" },
        provenance: "automatic",
      },
      insertion: insertion({
        sendPaste: async () => {
          throw new Error("paste failed");
        },
      }),
    })).rejects.toThrow("paste failed");
    expect(events).toEqual([]);
  });

  it("contains durable usage failures after insertion succeeds", async () => {
    const acceptance = createSuggestionAcceptance({
      recordAcceptedUsage: async () => {
        throw new Error("ledger unavailable");
      },
    });

    await expect(acceptance.accept({
      candidate: {
        suggestion: { id: "sg-local-1", text: " accepted words" },
        provenance: "automatic",
      },
      insertion: insertion(),
    })).resolves.toBe("inserted");
  });

  it("refreshes and exactly validates a Rewrite target before clipboard mutation", async () => {
    const calls: string[] = [];
    const acceptance = createSuggestionAcceptance({
      canAcceptLocalSuggestion: () => false,
      recordAcceptedUsage: () => calls.push("usage"),
      onLocalSuggestionAccepted: () => calls.push("history"),
    });

    await expect(acceptance.accept({
      candidate: { suggestion: { id: "sg-rewrite-1", text: "Clear copy" }, provenance: "rewrite" },
      insertion: insertion({
        getCurrentSuggestion: () => ({ id: "sg-rewrite-1", text: "Clear copy" }),
        getPreviouslyActiveApplication: () => rewriteTarget.activeApplication,
        getVisibleTextSessionTarget: () => rewriteTarget,
        getCurrentTextSessionTarget: () => {
          calls.push("refresh");
          return rewriteTarget;
        },
        insertSemantically: async () => {
          calls.push("semantic");
          return true;
        },
        setClipboard: async (text) => {
          calls.push(`clipboard:${text}`);
          return "previous";
        },
        sendPaste: async () => calls.push("paste"),
        waitForPaste: async () => calls.push("wait"),
        restoreClipboard: async () => calls.push("restore"),
      }),
    })).resolves.toBe("inserted");

    expect(calls).toEqual(["refresh", "clipboard:Clear copy", "paste", "wait", "restore"]);
  });

  const staleRewriteTargets: Array<[string, TextSessionSnapshot | null]> = [
    ["missing", null],
    ["unreliable", { ...rewriteTarget, accessibilityReliability: "unreliable" }],
    ["secure", { ...rewriteTarget, secureLike: true }],
    ["secret-like", { ...rewriteTarget, selectedText: "api_key=abcdefghijklmnop", selectedRange: { location: 7, length: 24 } }],
    ["application", { ...rewriteTarget, activeApplication: { bundleId: "com.apple.Notes", windowId: "window:1" } }],
    ["window", { ...rewriteTarget, activeApplication: { bundleId: "com.apple.TextEdit", windowId: "window:2" } }],
    ["focus", { ...rewriteTarget, focusedElementId: "focus:2" }],
    ["text element", { ...rewriteTarget, textElementId: "text:2" }],
    ["range", { ...rewriteTarget, selectedRange: { location: 8, length: 5 } }],
    ["selected text", { ...rewriteTarget, selectedText: "Other" }],
    ["before context", { ...rewriteTarget, surroundingContext: { beforeCaret: "Changed ", afterCaret: " after" } }],
    ["after context", { ...rewriteTarget, surroundingContext: { beforeCaret: "Before ", afterCaret: " changed" } }],
    ["missing context", { ...rewriteTarget, surroundingContext: undefined }],
  ];

  for (const [dimension, currentTarget] of staleRewriteTargets) {
    it(`makes stale or uncertain Rewrite ${dimension} a pre-clipboard no-op`, async () => {
      const calls: string[] = [];
      const acceptance = createSuggestionAcceptance({ recordAcceptance: () => calls.push("accepted") });
      const result = await acceptance.accept({
        candidate: { suggestion: { id: "sg-rewrite-1", text: "Clear copy" }, provenance: "rewrite" },
        insertion: insertion({
          getCurrentSuggestion: () => ({ id: "sg-rewrite-1", text: "Clear copy" }),
          getPreviouslyActiveApplication: () => rewriteTarget.activeApplication,
          getVisibleTextSessionTarget: () => rewriteTarget,
          getCurrentTextSessionTarget: () => currentTarget,
          setClipboard: async () => {
            calls.push("clipboard");
            return "previous";
          },
          sendPaste: async () => calls.push("paste"),
        }),
      });

      expect(result).toBe("stale_target");
      expect(calls).toEqual([]);
    });
  }
});
