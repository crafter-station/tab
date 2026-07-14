import { describe, expect, it } from "bun:test";
import {
  createSuggestionAcceptance,
  type InsertionDependencies,
} from "../apps/desktop/src/main/acceptance.ts";

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
});
