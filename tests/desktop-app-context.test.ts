import { describe, expect, it } from "bun:test";
import {
  createGhosttyAppContextCandidate,
  extractAppContextCandidateFromAccessibility,
  type AccessibilityTextNode,
} from "../apps/desktop/src/main/app-context.ts";
import { normalizeAppContext } from "../apps/desktop/src/main/app-context-policy.ts";
import { createAppContextExtractor } from "../apps/desktop/src/main/app-context-extractor.ts";
import type { SafeTypingContextSnapshot, TextSessionSnapshot } from "../apps/desktop/src/main/typing-context.ts";
import { createSuggestionMessages } from "../packages/suggestion-policy/src/index.ts";

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
    const candidate = createGhosttyAppContextCandidate(makeSnapshot());

    expect(candidate.fragments[0]).not.toHaveProperty("redaction");
    expect(candidate.fragments[0]).not.toHaveProperty("requestable");
    expect(candidate.fragments[0]).not.toHaveProperty("memoryEligible");

    const snapshot = normalizeAppContext(candidate);

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

    expect(normalizeAppContext(createGhosttyAppContextCandidate(snapshot))).toEqual({
      fragments: [],
      metadata: { provider: "ghostty-terminal", status: "unsupported" },
    });
  });

  it("falls back to Typing Context when Accessibility data is missing or unreliable", () => {
    const missing = normalizeAppContext(createGhosttyAppContextCandidate(makeSnapshot({ textSession: undefined })));
    const unreliable = normalizeAppContext(createGhosttyAppContextCandidate(
      makeSnapshot({ textSession: makeTextSession({ accessibilityReliability: "unavailable" }) }),
    ));

    expect(missing.fragments).toHaveLength(0);
    expect(missing.metadata.status).toBe("empty");
    expect(unreliable.fragments).toHaveLength(0);
    expect(unreliable.metadata.status).toBe("empty");
  });

  it("drops noisy ANSI/control terminal captures", () => {
    const snapshot = normalizeAppContext(createGhosttyAppContextCandidate(
      makeSnapshot({
        textSession: makeTextSession({
          surroundingContext: {
            beforeCaret: "\u001b[31m\u0000\u0007\u001b[0m\u001b[?2004h\u001b]0;noise\u0007",
            afterCaret: "",
          },
        }),
      }),
    ));

    expect(snapshot.fragments).toHaveLength(0);
    expect(snapshot.metadata.status).toBe("empty");
  });

  it("suppresses secret-like terminal output before requests", () => {
    const snapshot = normalizeAppContext(
      createGhosttyAppContextCandidate(
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
      const candidate = extractAppContextCandidateFromAccessibility(
        { bundleId },
        tree(["Project notes", "Please confirm the release checklist before Friday."]),
      );

      expect(candidate.fragments[0]).not.toHaveProperty("redaction");
      expect(candidate.fragments[0]).not.toHaveProperty("requestable");
      expect(candidate.fragments[0]).not.toHaveProperty("memoryEligible");

      const snapshot = normalizeAppContext(candidate);

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
      const snapshot = normalizeAppContext(
        extractAppContextCandidateFromAccessibility({ bundleId: item.bundleId }, tree([item.text])),
      );

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
      const snapshot = normalizeAppContext(extractAppContextCandidateFromAccessibility(
        { bundleId: item.bundleId },
        tree(["A reliable common writing surface exposes surrounding draft text."]),
      ));

      expect(snapshot.metadata).toMatchObject({ provider: item.provider, status: "available" });
      expect(snapshot.fragments[0]).toMatchObject({ provider: item.provider, kind: item.kind });
    }
  });

  it("falls back safely for unsupported apps and low-confidence Accessibility text", () => {
    const unsupported = normalizeAppContext(extractAppContextCandidateFromAccessibility(
      { bundleId: "com.example.UnsupportedWriter" },
      tree(["This app exposes text but is not allowlisted."]),
    ));
    const lowConfidence = normalizeAppContext(
      extractAppContextCandidateFromAccessibility({ bundleId: "com.apple.Notes" }, tree(["ok"])),
    );

    expect(unsupported).toEqual({ fragments: [], metadata: { status: "unsupported" } });
    expect(lowConfidence.fragments).toHaveLength(0);
    expect(lowConfidence.metadata).toMatchObject({
      provider: "apple-notes-accessibility",
      status: "suppressed",
      suppressionReason: "low_confidence_accessibility_text",
    });
  });
});

describe("App Context privacy normalization", () => {
  it("is idempotent and empties contradictory fragments for every non-available status", () => {
    for (const status of ["empty", "suppressed", "cleared", "unsupported"] as const) {
      const candidate = {
        fragments: [{
          id: `contradictory-${status}`,
          provider: "test-provider",
          kind: "visible_text",
          text: "api_key=sk-abc1234567890",
          confidence: 0.9,
        }],
        metadata: {
          provider: "test-provider",
          status,
          confidence: 0.4,
          ...(status === "suppressed" ? { suppressionReason: "low_confidence_extraction" } : {}),
        },
      };
      const normalized = normalizeAppContext(candidate);

      expect(normalizeAppContext(normalized)).toEqual(normalized);
      expect(normalized.fragments).toEqual([]);
      expect(normalized.metadata).toEqual(candidate.metadata);
    }
  });

  it("returns empty without secret suppression when fragments are blank or zero-confidence", () => {
    for (const fragment of [
      {
        id: "blank-fragment",
        provider: "test-provider",
        kind: "visible_text",
        text: "   ",
        confidence: 0.9,
      },
      {
        id: "zero-confidence-fragment",
        provider: "test-provider",
        kind: "visible_text",
        text: "Useful nearby context",
        confidence: 0,
      },
    ]) {
      expect(normalizeAppContext({
        fragments: [fragment],
        metadata: { provider: "test-provider", status: "available", confidence: 0.4 },
      })).toEqual({
        fragments: [],
        metadata: { provider: "test-provider", status: "empty", confidence: 0.4 },
      });
    }
  });

  it("bounds oversized candidates to five globally bounded fragments", () => {
    const snapshot = normalizeAppContext({
      fragments: Array.from({ length: 6 }, (_, index) => ({
        id: `fragment-${index}`,
        provider: "test-provider",
        kind: "visible_text",
        text: `Fragment ${index} ${"ordinary context ".repeat(180)}`,
        confidence: 0.9,
      })),
      metadata: { provider: "test-provider", status: "available", confidence: 0.9 },
    });

    expect(snapshot.fragments).toHaveLength(5);
    expect(snapshot.fragments.map((fragment) => fragment.id)).toEqual([
      "fragment-0",
      "fragment-1",
      "fragment-2",
      "fragment-3",
      "fragment-4",
    ]);
    expect(snapshot.fragments.every((fragment) => fragment.text.length === 2_000)).toBe(true);
  });

  it("uses and strips candidate-only request payload policies", () => {
    const sourceText = "Useful nearby conversation context ".repeat(10);
    const snapshot = normalizeAppContext({
      fragments: [{
        id: "provider-bounded-fragment",
        provider: "test-provider",
        kind: "visible_text",
        text: sourceText,
        confidence: 0.9,
        requestPayloadPolicy: { maxLength: 80, preserveWholeWords: true },
      }],
      metadata: { provider: "test-provider", status: "available", confidence: 0.9 },
    });

    expect(snapshot.fragments[0]?.text.length).toBeLessThanOrEqual(80);
    expect(snapshot.fragments[0]?.text).not.toBe(sourceText);
    expect(snapshot.fragments[0]).not.toHaveProperty("requestPayloadPolicy");
  });

  it("can preserve the newest end of a bounded candidate", () => {
    const snapshot = normalizeAppContext({
      fragments: [{
        id: "end-bounded-fragment",
        provider: "test-provider",
        kind: "visible_text",
        text: "old context that should be removed newest context to preserve",
        confidence: 0.9,
        requestPayloadPolicy: { maxLength: 30, preserveWholeWords: true, from: "end" },
      }],
      metadata: { provider: "test-provider", status: "available", confidence: 0.9 },
    });

    expect(snapshot.fragments[0]?.text).toBe("newest context to preserve");
  });

  it("normalizes malformed candidate request payload limits before slicing", () => {
    const sourceText = "ordinary context ".repeat(180);
    const normalizeWithMaxLength = (maxLength: number) => normalizeAppContext({
      fragments: [{
        id: `fragment-${maxLength}`,
        provider: "test-provider",
        kind: "visible_text",
        text: sourceText,
        confidence: 0.9,
        requestPayloadPolicy: { maxLength },
      }],
      metadata: { provider: "test-provider", status: "available", confidence: 0.9 },
    });
    const snapshots = [-1, Number.NaN, Number.POSITIVE_INFINITY, 12.9, 20_000]
      .map(normalizeWithMaxLength);

    expect(snapshots.map((snapshot) => snapshot.fragments[0]?.text.length ?? 0)).toEqual([
      0,
      2_000,
      2_000,
      12,
      2_000,
    ]);
    expect(snapshots.every((snapshot) =>
      snapshot.fragments.every((fragment) => fragment.text.length <= 2_000)
    )).toBe(true);
  });

  it("owns requestability, memory eligibility, bounds, and secret suppression", () => {
    const clean = normalizeAppContext({
      fragments: [{
        id: "fragment-1",
        provider: "test-provider",
        kind: "visible_text",
        text: "Useful nearby context",
        confidence: 0.9,
      }],
      metadata: { provider: "test-provider", status: "available", confidence: 0.9 },
    });
    const secret = normalizeAppContext({
      fragments: [{
        id: "fragment-2",
        provider: "test-provider",
        kind: "visible_text",
        text: "api_key=sk-abc1234567890",
        confidence: 0.9,
      }],
      metadata: { provider: "test-provider", status: "available", confidence: 0.9 },
    });

    expect(clean.fragments[0]).toMatchObject({ requestable: true, memoryEligible: false });
    expect(normalizeAppContext(clean)).toEqual(clean);
    expect(secret).toMatchObject({
      fragments: [],
      metadata: { status: "suppressed", suppressionReason: "secret_like_context" },
    });
  });
});

describe("OpenCode suggestion prompt context", () => {
  it("reserves prompt space for current terminal context after conversation background", () => {
    const messages = createSuggestionMessages({
      typingContext: "Continue this",
      contextSource: "terminal_input",
      activeApplication: { bundleId: "com.mitchellh.ghostty" },
      memories: [],
      appContext: {
        fragments: [
          {
            id: "opencode-conversation",
            provider: "opencode-local-session",
            kind: "conversation",
            text: "C".repeat(600),
            confidence: 0.95,
            redaction: { applied: false, redactionCount: 0, kinds: [] },
            requestable: true,
            memoryEligible: false,
          },
          {
            id: "ghostty-terminal",
            provider: "ghostty-terminal",
            kind: "terminal_visible_context",
            text: "T".repeat(600),
            confidence: 0.86,
            redaction: { applied: false, redactionCount: 0, kinds: [] },
            requestable: true,
            memoryEligible: false,
          },
        ],
        metadata: { provider: "opencode-local-session", status: "available", confidence: 0.95 },
      },
    });
    const prompt = messages.at(-1)?.content ?? "";

    expect(prompt.match(/\] (C+)/)?.[1]).toHaveLength(400);
    expect(prompt.match(/\] (T+)/)?.[1]).toHaveLength(200);
    expect(prompt).toContain("Unfinished text:\nContinue this");
  });
});

describe("App Context extraction module", () => {
  it("routes managed Accessibility trees through the active app adapter registry", () => {
    const extractor = createAppContextExtractor();
    extractor.ingestAccessibilityTree({
      activeApplication: { bundleId: "com.google.Chrome", windowId: "window:1" },
      accessibilityTree: {
        role: "AXWebArea",
        children: [
          {
            role: "AXStaticText",
            text: "Taylor: Please confirm the customer quote before sending.",
            bounds: { x: 120, y: 420, width: 640, height: 24 },
          },
          {
            id: "compose-box",
            role: "AXTextArea",
            value: "I can confirm this today.",
            focused: true,
            editable: true,
            bounds: { x: 120, y: 520, width: 640, height: 96 },
          },
        ],
      },
    });

    const snapshot = extractor.getSnapshot(makeSnapshot({ activeApplication: { bundleId: "com.google.Chrome" } }));

    expect(snapshot.metadata).toMatchObject({
      provider: "chrome-web-writing-context",
      status: "available",
    });
    expect(snapshot.fragments.map((fragment) => fragment.kind)).toEqual([
      "focused_editable",
      "nearby_visible_text",
    ]);
  });

  it("keeps managed secret suppression terminal across source tiers", () => {
    const extractor = createAppContextExtractor();
    const activeApplication = {
      bundleId: "com.tinyspeck.slackmacgap",
      name: "Slack",
      windowId: "window:incident-response",
    };
    extractor.ingestAccessibilityTree({
      activeApplication,
      accessibilityTree: tree([
        "Morgan: The deployment is ready for the incident channel.",
        "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
      ]),
    });
    const textSession = makeTextSession({
      activeApplication,
      surroundingContext: {
        beforeCaret: "I will post the clean deployment summary in the channel now.",
        afterCaret: " Let me know if any details should change.",
      },
    });

    const snapshot = extractor.getSnapshot(makeSnapshot({ activeApplication, textSession }));

    expect(snapshot).toEqual({
      fragments: [],
      metadata: {
        provider: "slack-accessibility",
        status: "suppressed",
        confidence: 0.82,
        suppressionReason: "secret_like_context",
      },
    });
  });

  it("keeps fallback order behind the extraction interface", () => {
    let openCodeCandidateCalls = 0;
    const extractor = createAppContextExtractor({
      zedCandidateProvider: () => ({
        fragments: [
          {
            id: "zed:test",
            provider: "zed-focused-editor",
            kind: "focused_editor",
            text: "A prose comment visible in the focused editor.",
            confidence: 0.82,
          },
        ],
        metadata: { provider: "zed-focused-editor", status: "available", confidence: 0.82 },
      }),
      openCodeConversation: {
        observe: async () => {},
        getCandidate: () => {
          openCodeCandidateCalls += 1;
          return { fragments: [], metadata: { status: "empty" } };
        },
        getState: () => ({
          candidate: { fragments: [], metadata: { status: "empty" } },
          pending: false,
          revision: 0,
        }),
        subscribe: () => () => {},
        clear: () => {},
      },
    });

    const snapshot = extractor.getSnapshot(makeSnapshot({
      activeApplication: { bundleId: "dev.zed.Zed" },
      textSession: undefined,
    }));

    expect(snapshot.metadata).toMatchObject({
      provider: "zed-focused-editor",
      status: "available",
    });
    expect(snapshot.fragments[0]?.memoryEligible).toBe(false);
    expect(openCodeCandidateCalls).toBe(0);
  });
});
