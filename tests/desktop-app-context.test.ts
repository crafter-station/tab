import { describe, expect, it } from "bun:test";
import {
  createGhosttyAppContextSnapshot,
  sanitizeAppContextSnapshot,
} from "../apps/desktop/src/main/app-context.ts";
import type { SafeTypingContextSnapshot, TextSessionSnapshot } from "../apps/desktop/src/main/typing-context.ts";

function makeTextSession(overrides: Partial<TextSessionSnapshot> = {}): TextSessionSnapshot {
  return {
    activeApplication: { bundleId: "com.mitchellh.ghostty", name: "Ghostty", windowId: "window:1" },
    focusedElementId: "terminal:focus",
    textElementId: "terminal:text",
    selectedRange: { location: 120, length: 0 },
    caretIdentity: "range:120:0",
    secureLike: false,
    accessibilityReliability: "reliable",
    surroundingContext: {
      beforeCaret: "Last login: Wed Jul 8\n$ git commit\n# Please enter the commit message for your changes.\nAdd Ghostty context adapter tests",
      afterCaret: "",
    },
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<SafeTypingContextSnapshot> = {}): SafeTypingContextSnapshot {
  const textSession = overrides.textSession ?? makeTextSession();
  return {
    context: "Add Ghostty context adapter tests",
    sanitizedContext: "Add Ghostty context adapter tests",
    activeApplication: textSession.activeApplication,
    secureInput: false,
    paused: false,
    privateContext: false,
    contextSource: "terminal_input",
    memoryEligible: true,
    redaction: { applied: false, redactionCount: 0, kinds: [] },
    contextHash: "hash",
    requestable: true,
    suppressionReason: null,
    textSession,
    ...overrides,
  };
}

describe("Ghostty App Context provider", () => {
  it("extracts bounded suggestion-only terminal context from reliable Ghostty Accessibility text", () => {
    const snapshot = createGhosttyAppContextSnapshot(makeSnapshot());

    expect(snapshot.metadata).toMatchObject({
      provider: "ghostty-terminal",
      status: "available",
    });
    expect(snapshot.fragments).toHaveLength(1);
    expect(snapshot.fragments[0]).toMatchObject({
      provider: "ghostty-terminal",
      kind: "terminal_visible_context",
      requestable: true,
      memoryEligible: false,
    });
    expect(snapshot.fragments[0].text).toContain("Please enter the commit message");
    expect(snapshot.fragments[0].text.length).toBeLessThanOrEqual(2_000);
  });

  it("falls back to Typing Context when the focused app is not Ghostty", () => {
    const textSession = makeTextSession({ activeApplication: { bundleId: "com.apple.Terminal" } });
    const snapshot = makeSnapshot({ activeApplication: textSession.activeApplication, textSession });

    expect(createGhosttyAppContextSnapshot(snapshot)).toEqual({
      fragments: [],
      metadata: { provider: "ghostty-terminal", status: "unsupported" },
    });
  });

  it("falls back to Typing Context when Accessibility data is missing or unreliable", () => {
    const missing = createGhosttyAppContextSnapshot(makeSnapshot({ textSession: undefined }));
    const unreliable = createGhosttyAppContextSnapshot(
      makeSnapshot({ textSession: makeTextSession({ accessibilityReliability: "unavailable" }) }),
    );

    expect(missing.fragments).toHaveLength(0);
    expect(missing.metadata.status).toBe("empty");
    expect(unreliable.fragments).toHaveLength(0);
    expect(unreliable.metadata.status).toBe("empty");
  });

  it("drops noisy ANSI/control terminal captures", () => {
    const snapshot = createGhosttyAppContextSnapshot(
      makeSnapshot({
        textSession: makeTextSession({
          surroundingContext: {
            beforeCaret: "\u001b[31m\u0000\u0007\u001b[0m\u001b[?2004h\u001b]0;noise\u0007",
            afterCaret: "",
          },
        }),
      }),
    );

    expect(snapshot.fragments).toHaveLength(0);
    expect(snapshot.metadata.status).toBe("empty");
  });

  it("suppresses secret-like terminal output before requests", () => {
    const snapshot = sanitizeAppContextSnapshot(
      createGhosttyAppContextSnapshot(
        makeSnapshot({
          textSession: makeTextSession({
            surroundingContext: {
              beforeCaret: "$ deploy\nAuthorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
              afterCaret: "",
            },
          }),
        }),
      ),
    );

    expect(snapshot.fragments).toHaveLength(0);
    expect(snapshot.metadata.status).toBe("suppressed");
    expect(snapshot.metadata.suppressionReason).toBe("secret_like_context");
  });
});
