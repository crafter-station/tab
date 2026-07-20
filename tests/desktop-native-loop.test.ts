import { describe, it, expect } from "bun:test";
import {
  createSafeTextSessionSnapshot,
  createSafeTypingContextSnapshot,
  createTypingContextBuffer,
  getLastWords,
  type RequestableTypingContextSnapshot,
  type SafeTypingContextSnapshot,
  type TextSessionSnapshot,
} from "../apps/desktop/src/main/typing-context.ts";
import { generateFakeSuggestion } from "../apps/desktop/src/main/suggestion-engine.ts";
import { createAutomaticSuggestion } from "../apps/desktop/src/main/automatic-suggestion.ts";
import type { SuggestionSource } from "../apps/desktop/src/main/suggestion-source.ts";
import { createPoliteTriggerPolicy } from "../apps/desktop/src/main/trigger-policy.ts";
import { acceptAndInsertSuggestion } from "../apps/desktop/src/main/acceptance.ts";
import {
  APP_CONTEXT_SUPPORTED_APP_MATRIX,
  APP_CONTEXT_TRUST_COPY,
  createAccessibilityAppContextProvider,
  createAppContextManager,
  createObsidianDocumentAppContextCandidate,
  createZedFocusedEditorAppContextCandidateProvider,
  type AppContextSnapshot,
} from "../apps/desktop/src/main/app-context.ts";
import { normalizeAppContext } from "../apps/desktop/src/main/app-context-policy.ts";
import { createApplicationCompatibilityStore } from "../apps/desktop/src/main/application-compatibility.ts";
import {
  createNativeAutocompleteApp,
} from "../apps/desktop/src/main/native-autocomplete-app.ts";
import { createSuggestionAcceptanceTriggers } from "../apps/desktop/src/main/suggestion-acceptance-triggers.ts";
import { createAppContextExtractor, type AppContextSnapshotState } from "../apps/desktop/src/main/app-context-extractor.ts";
import { createOpenCodeConversationContext, type OpenCodeContextRow } from "../apps/desktop/src/main/opencode-session-context.ts";
import { redactSensitiveText } from "../packages/redaction/src/index.ts";
import { getMemoryEligibility } from "../packages/memory-policy/src/index.ts";
import type { Suggestion, ActiveApplication, RecordTelemetryEventRequest } from "@tab/contracts";

describe("desktop native suggestion loop", () => {
  function makeSnapshot(overrides: {
    context?: string;
    activeApplication?: ActiveApplication | null;
    secureInput?: boolean;
    paused?: boolean;
    privateContext?: boolean;
    contextSource?: SafeTypingContextSnapshot["contextSource"];
    textSession?: TextSessionSnapshot;
  } = {}): SafeTypingContextSnapshot {
    const snapshot = createSafeTypingContextSnapshot({
      context: overrides.context ?? "hello",
      activeApplication: overrides.activeApplication ?? { bundleId: "com.apple.TextEdit" },
      secureInput: overrides.secureInput ?? false,
      paused: overrides.paused ?? false,
      privateContext: overrides.privateContext ?? false,
      contextSource: overrides.contextSource ?? "typed_text",
      memoryEligible: true,
    });

    return overrides.textSession ? { ...snapshot, textSession: overrides.textSession } : snapshot;
  }

  describe("typing context buffer", () => {
    it("accumulates user-authored text input", () => {
      const buffer = createTypingContextBuffer();
      buffer.appendText("Hello");
      buffer.appendText(" ");
      buffer.appendText("world");
      expect(buffer.getState().context).toBe("Hello world");
    });

    it("repairs macOS press-and-hold accent picker artifacts in fallback input", () => {
      const buffer = createTypingContextBuffer();
      buffer.appendText("my name ");
      buffer.appendText("iii2");
      buffer.appendText("s anthon");
      buffer.appendText("iii2 cueb");
      buffer.appendText("aaa2 ajej ");
      buffer.appendText("uuu4");

      expect(buffer.getState().context).toBe(
        "my name \u00eds anthon\u00ed cueb\u00e1 ajej \u00fc",
      );
    });

    it("repairs the standard macOS Latin accent picker set in fallback input", () => {
      const buffer = createTypingContextBuffer();
      buffer.appendText("aa1 aa2 aa3 aa4 aa5 aa6 aa7 aa8 ");
      buffer.appendText("cc1 cc2 cc3 ");
      buffer.appendText("ee1 ee2 ee3 ee4 ee5 ee6 ee7 ");
      buffer.appendText("ii1 ii2 ii3 ii4 ii5 ii6 ");
      buffer.appendText("ll1 nn1 nn2 ");
      buffer.appendText("oo1 oo2 oo3 oo4 oo5 oo6 oo7 oo8 ");
      buffer.appendText("ss1 ss2 ss3 ");
      buffer.appendText("uu1 uu2 uu3 uu4 uu5 ");
      buffer.appendText("yy1 zz1 zz2 zz3");

      expect(buffer.getState().context).toBe(
        "\u00e0 \u00e1 \u00e2 \u00e4 \u00e6 \u00e3 \u00e5 \u0101 " +
          "\u00e7 \u0107 \u010d " +
          "\u00e8 \u00e9 \u00ea \u00eb \u0113 \u0117 \u0119 " +
          "\u00ec \u00ed \u00ee \u00ef \u012b \u012f " +
          "\u0142 \u00f1 \u0144 " +
          "\u00f2 \u00f3 \u00f4 \u00f6 \u0153 \u00f8 \u014d \u00f5 " +
          "\u00df \u015b \u0161 " +
          "\u00f9 \u00fa \u00fb \u00fc \u016b " +
          "\u00ff \u017e \u017a \u017c",
      );
    });

    it("uses collision-resistant Text Session text identities", () => {
      const target = rewriteTargetForFingerprint("😀");
      expect(createSafeTextSessionSnapshot(target).contextHash).not.toBe(
        createSafeTextSessionSnapshot(rewriteTargetForFingerprint("😃")).contextHash,
      );
      expect(createSafeTextSessionSnapshot(rewriteTargetForFingerprint("00009pf8")).contextHash).not.toBe(
        createSafeTextSessionSnapshot(rewriteTargetForFingerprint("0000arj6")).contextHash,
      );
    });

    function rewriteTargetForFingerprint(selectedText: string): TextSessionSnapshot {
      return {
        activeApplication: { bundleId: "com.apple.TextEdit", windowId: "window:1" },
        focusedElementId: "focus:1",
        textElementId: "text:1",
        selectedRange: { location: 0, length: selectedText.length },
        selectedText,
        secureLike: false,
        accessibilityReliability: "reliable",
        surroundingContext: { beforeCaret: "", afterCaret: "" },
      };
    }

    it("ignores empty text input", () => {
      const buffer = createTypingContextBuffer();
      buffer.appendText("Hello");
      buffer.appendText("");
      expect(buffer.getState().context).toBe("Hello");
    });

    it("clears context when active application changes", () => {
      const buffer = createTypingContextBuffer();
      buffer.setActiveApplication({ bundleId: "com.apple.TextEdit" });
      buffer.appendText("Hello");
      buffer.setActiveApplication({ bundleId: "com.apple.Notes" });
      expect(buffer.getState().context).toBe("");
    });

    it("keeps context when active application stays the same", () => {
      const buffer = createTypingContextBuffer();
      buffer.setActiveApplication({ bundleId: "com.apple.TextEdit" });
      buffer.appendText("Hello");
      buffer.setActiveApplication({ bundleId: "com.apple.TextEdit" });
      expect(buffer.getState().context).toBe("Hello");
    });

    it("clears context when active window changes within the same application", () => {
      const buffer = createTypingContextBuffer();
      buffer.setActiveApplication({ bundleId: "com.apple.TextEdit", windowId: "window:1" });
      buffer.appendText("Hello");
      buffer.setActiveApplication({ bundleId: "com.apple.TextEdit", windowId: "window:2" });
      expect(buffer.getState().context).toBe("");
    });

    it("resumes recent context when returning to a previous app window", () => {
      let now = 1_000;
      const buffer = createTypingContextBuffer(5_000, { now: () => now });
      buffer.setActiveApplication({ bundleId: "com.mitchellh.ghostty", windowId: "window:1" });
      buffer.appendText("Explain this function", "terminal_input");

      now += 30_000;
      buffer.setActiveApplication({ bundleId: "com.google.Chrome", windowId: "window:2" });
      buffer.appendText("Search query");

      now += 30_000;
      buffer.setActiveApplication({ bundleId: "com.mitchellh.ghostty", windowId: "window:1" });

      expect(buffer.getState().context).toBe("Explain this function");
      expect(buffer.getState().contextSource).toBe("terminal_input");
    });

    it("expires context retained for an inactive app window", () => {
      let now = 1_000;
      const buffer = createTypingContextBuffer(5_000, { retentionMs: 60_000, now: () => now });
      buffer.setActiveApplication({ bundleId: "com.mitchellh.ghostty", windowId: "window:1" });
      buffer.appendText("Old terminal context", "terminal_input");
      buffer.setActiveApplication({ bundleId: "com.google.Chrome", windowId: "window:2" });

      now += 60_001;
      buffer.setActiveApplication({ bundleId: "com.mitchellh.ghostty", windowId: "window:1" });

      expect(buffer.getState().context).toBe("");
    });

    it("clears only the active session on ordinary context invalidation", () => {
      const buffer = createTypingContextBuffer();
      buffer.setActiveApplication({ bundleId: "com.mitchellh.ghostty", windowId: "window:1" });
      buffer.appendText("Keep this", "terminal_input");
      buffer.setActiveApplication({ bundleId: "com.google.Chrome", windowId: "window:2" });
      buffer.appendText("Discard this");
      buffer.clear();
      buffer.setActiveApplication({ bundleId: "com.mitchellh.ghostty", windowId: "window:1" });

      expect(buffer.getState().context).toBe("Keep this");
    });

    it("purges retained sessions when secure input starts", () => {
      const buffer = createTypingContextBuffer();
      buffer.setActiveApplication({ bundleId: "com.mitchellh.ghostty", windowId: "window:1" });
      buffer.appendText("Do not retain this", "terminal_input");
      buffer.setActiveApplication({ bundleId: "com.google.Chrome", windowId: "window:2" });
      buffer.setSecureInput(true);
      buffer.setSecureInput(false);
      buffer.setActiveApplication({ bundleId: "com.mitchellh.ghostty", windowId: "window:1" });

      expect(buffer.getState().context).toBe("");
    });

    it("purges retained sessions when entering a private application", () => {
      const buffer = createTypingContextBuffer();
      buffer.setActiveApplication({ bundleId: "com.mitchellh.ghostty", windowId: "window:1" });
      buffer.appendText("Do not retain this", "terminal_input");
      buffer.setActiveApplication({ bundleId: "com.1password.1password" });
      buffer.setActiveApplication({ bundleId: "com.mitchellh.ghostty", windowId: "window:1" });

      expect(buffer.getState().context).toBe("");
    });

    it("clears context on secure input", () => {
      const buffer = createTypingContextBuffer();
      buffer.appendText("Hello");
      buffer.setSecureInput(true);
      expect(buffer.getState().context).toBe("");
      expect(buffer.getState().secureInput).toBe(true);
    });

    it("does not accumulate text while secure input is active", () => {
      const buffer = createTypingContextBuffer();
      buffer.setSecureInput(true);
      buffer.appendText("secret");
      expect(buffer.getState().context).toBe("");
    });

    it("clears context explicitly", () => {
      const buffer = createTypingContextBuffer();
      buffer.appendText("Hello");
      buffer.clear();
      expect(buffer.getState().context).toBe("");
    });

    it("removes deleted characters from typing context", () => {
      const buffer = createTypingContextBuffer();
      buffer.appendText("Hello");
      buffer.deleteBackward();
      expect(buffer.getState().context).toBe("Hell");
    });

    it("removes deleted tokens from typing context", () => {
      const buffer = createTypingContextBuffer();
      buffer.appendText("Hello brave world");
      buffer.deleteBackward("token");
      expect(buffer.getState().context).toBe("Hello brave");
    });

    it("preserves terminal source classification after deletion", () => {
      const buffer = createTypingContextBuffer();
      buffer.setActiveApplication({ bundleId: "com.mitchellh.ghostty" });
      buffer.appendText("hola", "terminal_input");
      buffer.deleteBackward("character", "terminal_input");

      expect(buffer.getState().context).toBe("hol");
      expect(buffer.getState().contextSource).toBe("terminal_input");
    });

    it("rolls off old context beyond max length", () => {
      const buffer = createTypingContextBuffer(10);
      buffer.appendText("0123456789");
      buffer.appendText("X");
      expect(buffer.getState().context).toBe("123456789X");
    });

    it("formats the last words for debug overlays", () => {
      expect(getLastWords("one two three four", 2)).toBe("three four");
      expect(getLastWords("  one\n two\tthree  ", 10)).toBe("one two three");
      expect(getLastWords("   ", 100)).toBe("");
    });
  });

  describe("Accessibility App Context provider", () => {
    it("defines trust controls and a validation matrix for supported App Context apps", async () => {
      const trustCopy = JSON.stringify(APP_CONTEXT_TRUST_COPY).toLowerCase();
      for (const phrase of [
        "temporary",
        "used only to make suggestions",
        "recent typing",
        "nearby app text",
        "saved memories",
        "metadata-only",
        "screen recording",
        "full disk access",
        "raw logs",
        "pause tab",
        "clear recent typing and nearby app text",
      ]) {
        expect(trustCopy).toContain(phrase);
      }

      for (const app of [
        "WhatsApp",
        "Ghostty",
        "Obsidian",
        "Zed",
        "Chrome",
        "Apple Notes",
        "Slack",
        "Discord",
        "Apple Mail",
        "VS Code",
        "TextEdit",
      ]) {
        expect(APP_CONTEXT_SUPPORTED_APP_MATRIX.some((entry) => entry.app === app && entry.allowlisted)).toBe(true);
      }

      const validationDoc = (await Bun.file("docs/manual-validation-app-context.md").text()).toLowerCase();
      for (const phrase of [
        "unsupported-app fallback",
        "low-confidence extraction",
        "secure/secret-like suppression",
        "metadata-only compatibility diagnostics",
      ]) {
        expect(validationDoc).toContain(phrase);
      }
    });

    it("extracts bounded suggestion-only context for supported writing apps", () => {
      const provider = createAccessibilityAppContextProvider(() => ({
        activeApplication: { bundleId: "net.whatsapp.WhatsApp", name: "WhatsApp" },
        visibleRoot: {
          role: "AXGroup",
          children: [
            { role: "AXStaticText", value: "Alex" },
            { role: "AXStaticText", value: "Can you confirm the launch date?" },
            { role: "AXStaticText", value: "Me: I can" },
          ],
        },
      }));

      const snapshot = provider();

      expect(snapshot.metadata).toMatchObject({
        provider: "whatsapp-accessibility",
        status: "available",
      });
      expect(snapshot.fragments).toHaveLength(1);
      expect(snapshot.fragments[0]).toMatchObject({
        provider: "whatsapp-accessibility",
        kind: "conversation",
        requestable: true,
        memoryEligible: false,
      });
      expect(snapshot.fragments[0].text).toContain("Alex");
      expect(snapshot.fragments[0].text).toContain("Can you confirm the launch date?");
    });

    it("falls back safely for unsupported apps", () => {
      const provider = createAccessibilityAppContextProvider(() => ({
        activeApplication: { bundleId: "com.example.Unknown" },
        visibleRoot: { role: "AXStaticText", value: "Visible text" },
      }));

      expect(provider()).toEqual({
        fragments: [],
        metadata: { status: "unsupported" },
      });
    });
  });

  describe("fake suggestion engine", () => {
    it("returns null for empty context", () => {
      expect(generateFakeSuggestion("")).toBeNull();
    });

    it("returns null for whitespace-only context", () => {
      expect(generateFakeSuggestion("   ")).toBeNull();
    });

    it("returns a fake suggestion for typed context", () => {
      const suggestion = generateFakeSuggestion("Hello");
      expect(suggestion).not.toBeNull();
      expect(suggestion?.text.length).toBeGreaterThan(0);
      expect(suggestion?.id.length).toBeGreaterThan(0);
    });

    it("produces deterministic continuation for known trigger words", () => {
      const suggestion = generateFakeSuggestion("thank");
      expect(suggestion?.text).toBe(" you");
    });

    it("produces a generic continuation for unknown words", () => {
      const suggestion = generateFakeSuggestion("wander");
      expect(suggestion?.text).toBeTruthy();
    });
  });

  describe("acceptance and insertion", () => {
    const semanticTarget: TextSessionSnapshot = {
      activeApplication: { bundleId: "com.apple.TextEdit", windowId: "window:1" },
      focusedElementId: "focus:1",
      textElementId: "text:1",
      selectedRange: { location: 5, length: 0 },
      caretIdentity: "range:5:0",
      secureLike: false,
      accessibilityReliability: "reliable",
      supportsSemanticInsertion: true,
      surroundingContext: { beforeCaret: "Hello", afterCaret: "" },
    };

    it("inserts the current suggestion into the previously active app", async () => {
      const calls: Array<{ type: string; value?: string }> = [];
      const result = await acceptAndInsertSuggestion({
        getCurrentSuggestion: () => ({ id: "s-1", text: " world" }),
        getPreviouslyActiveApplication: () => ({ bundleId: "com.apple.TextEdit" }),
        setClipboard: async (text) => {
          calls.push({ type: "setClipboard", value: text });
          return "previous-clipboard";
        },
        sendPaste: async () => calls.push({ type: "sendPaste" }),
        waitForPaste: async () => calls.push({ type: "waitForPaste" }),
        restoreClipboard: async (previous) => calls.push({ type: "restoreClipboard", value: previous }),
      });
      expect(result).toBe("inserted");
      expect(calls.map((c) => c.type)).toEqual(["setClipboard", "sendPaste", "waitForPaste", "restoreClipboard"]);
      expect(calls[0].value).toBe(" world");
      expect(calls[3].value).toBe("previous-clipboard");
    });

    it("restores the clipboard when paste dispatch fails", async () => {
      const calls: string[] = [];
      const insertion = acceptAndInsertSuggestion({
        getCurrentSuggestion: () => ({ id: "s-1", text: " world" }),
        getPreviouslyActiveApplication: () => ({ bundleId: "com.apple.TextEdit" }),
        setClipboard: async () => {
          calls.push("setClipboard");
          return "previous-clipboard";
        },
        sendPaste: async () => {
          calls.push("sendPaste");
          throw new Error("paste failed");
        },
        restoreClipboard: async () => {
          calls.push("restoreClipboard");
        },
      });

      await expect(insertion).rejects.toThrow("paste failed");
      expect(calls).toEqual(["setClipboard", "sendPaste", "restoreClipboard"]);
    });

    it("restores the clipboard when waiting for paste fails", async () => {
      const calls: string[] = [];
      const insertion = acceptAndInsertSuggestion({
        getCurrentSuggestion: () => ({ id: "s-1", text: " world" }),
        getPreviouslyActiveApplication: () => ({ bundleId: "com.apple.TextEdit" }),
        setClipboard: async () => {
          calls.push("setClipboard");
          return "previous-clipboard";
        },
        sendPaste: async () => {
          calls.push("sendPaste");
        },
        waitForPaste: async () => {
          calls.push("waitForPaste");
          throw new Error("paste did not settle");
        },
        restoreClipboard: async () => {
          calls.push("restoreClipboard");
        },
      });

      await expect(insertion).rejects.toThrow("paste did not settle");
      expect(calls).toEqual(["setClipboard", "sendPaste", "waitForPaste", "restoreClipboard"]);
    });

    it("preserves the insertion failure when clipboard restoration also fails", async () => {
      const insertion = acceptAndInsertSuggestion({
        getCurrentSuggestion: () => ({ id: "s-1", text: " world" }),
        getPreviouslyActiveApplication: () => ({ bundleId: "com.apple.TextEdit" }),
        setClipboard: async () => "previous-clipboard",
        sendPaste: async () => {
          throw new Error("paste failed");
        },
        restoreClipboard: async () => {
          throw new Error("restore failed");
        },
      });

      await expect(insertion).rejects.toThrow("paste failed");
    });

    it("treats clipboard restoration as best-effort after successful insertion", async () => {
      const result = acceptAndInsertSuggestion({
        getCurrentSuggestion: () => ({ id: "s-1", text: " world" }),
        getPreviouslyActiveApplication: () => ({ bundleId: "com.apple.TextEdit" }),
        setClipboard: async () => "previous-clipboard",
        sendPaste: async () => {},
        waitForPaste: async () => {},
        restoreClipboard: async () => {
          throw new Error("restore failed");
        },
      });

      await expect(result).resolves.toBe("inserted");
    });

    it("prefers semantic insertion when the visible Text Session target is still compatible", async () => {
      const calls: Array<{ type: string; value?: unknown }> = [];
      const result = await acceptAndInsertSuggestion({
        getCurrentSuggestion: () => ({ id: "s-1", text: " world" }),
        getPreviouslyActiveApplication: () => ({ bundleId: "com.apple.TextEdit", windowId: "window:1" }),
        getVisibleTextSessionTarget: () => semanticTarget,
        getCurrentTextSessionTarget: () => semanticTarget,
        insertSemantically: async (text, target) => {
          calls.push({ type: "insertSemantically", value: { text, target } });
          return true;
        },
        setClipboard: async (text) => {
          calls.push({ type: "setClipboard", value: text });
          return "previous-clipboard";
        },
        sendPaste: async () => calls.push({ type: "sendPaste" }),
        restoreClipboard: async (previous) => calls.push({ type: "restoreClipboard", value: previous }),
      });

      expect(result).toBe("inserted");
      expect(calls.map((call) => call.type)).toEqual(["insertSemantically"]);
    });

    it("falls back to clipboard paste when semantic insertion fails", async () => {
      const calls: Array<{ type: string; value?: unknown }> = [];
      const result = await acceptAndInsertSuggestion({
        getCurrentSuggestion: () => ({ id: "s-1", text: " world" }),
        getPreviouslyActiveApplication: () => ({ bundleId: "com.apple.TextEdit", windowId: "window:1" }),
        getVisibleTextSessionTarget: () => semanticTarget,
        getCurrentTextSessionTarget: () => semanticTarget,
        insertSemantically: async () => {
          calls.push({ type: "insertSemantically" });
          return false;
        },
        setClipboard: async (text) => {
          calls.push({ type: "setClipboard", value: text });
          return "previous-clipboard";
        },
        sendPaste: async () => calls.push({ type: "sendPaste" }),
        restoreClipboard: async (previous) => calls.push({ type: "restoreClipboard", value: previous }),
      });

      expect(result).toBe("inserted");
      expect(calls.map((call) => call.type)).toEqual(["insertSemantically", "setClipboard", "sendPaste", "restoreClipboard"]);
    });

    it("uses clipboard fallback without semantic insertion when app compatibility says semantic insertion is unreliable", async () => {
      const calls: Array<{ type: string; value?: unknown }> = [];
      const result = await acceptAndInsertSuggestion({
        getCurrentSuggestion: () => ({ id: "s-1", text: " world" }),
        getPreviouslyActiveApplication: () => ({ bundleId: "com.apple.TextEdit", windowId: "window:1" }),
        getVisibleTextSessionTarget: () => semanticTarget,
        getCurrentTextSessionTarget: () => semanticTarget,
        shouldPreferClipboardFallback: () => true,
        insertSemantically: async () => {
          calls.push({ type: "insertSemantically" });
          return true;
        },
        setClipboard: async (text) => {
          calls.push({ type: "setClipboard", value: text });
          return "previous-clipboard";
        },
        sendPaste: async () => calls.push({ type: "sendPaste" }),
        restoreClipboard: async (previous) => calls.push({ type: "restoreClipboard", value: previous }),
      });

      expect(result).toBe("inserted");
      expect(calls.map((call) => call.type)).toEqual(["setClipboard", "sendPaste", "restoreClipboard"]);
    });

    it("uses clipboard fallback without attempting semantic insertion when the target is stale", async () => {
      const calls: Array<{ type: string; value?: unknown }> = [];
      const result = await acceptAndInsertSuggestion({
        getCurrentSuggestion: () => ({ id: "s-1", text: " world" }),
        getPreviouslyActiveApplication: () => ({ bundleId: "com.apple.TextEdit", windowId: "window:1" }),
        getVisibleTextSessionTarget: () => semanticTarget,
        getCurrentTextSessionTarget: () => ({ ...semanticTarget, selectedRange: { location: 6, length: 0 } }),
        insertSemantically: async () => {
          calls.push({ type: "insertSemantically" });
          return true;
        },
        setClipboard: async (text) => {
          calls.push({ type: "setClipboard", value: text });
          return "previous-clipboard";
        },
        sendPaste: async () => calls.push({ type: "sendPaste" }),
        restoreClipboard: async (previous) => calls.push({ type: "restoreClipboard", value: previous }),
      });

      expect(result).toBe("inserted");
      expect(calls.map((call) => call.type)).toEqual(["setClipboard", "sendPaste", "restoreClipboard"]);
    });

    it("returns no_suggestion when there is nothing to insert", async () => {
      const result = await acceptAndInsertSuggestion({
        getCurrentSuggestion: () => null,
        getPreviouslyActiveApplication: () => ({ bundleId: "com.apple.TextEdit" }),
        setClipboard: async () => "",
        sendPaste: async () => {},
        restoreClipboard: async () => {},
      });
      expect(result).toBe("no_suggestion");
    });

    it("returns no_target_app when there is no previous application", async () => {
      const result = await acceptAndInsertSuggestion({
        getCurrentSuggestion: () => ({ id: "s-1", text: " world" }),
        getPreviouslyActiveApplication: () => null,
        setClipboard: async () => "",
        sendPaste: async () => {},
        restoreClipboard: async () => {},
      });
      expect(result).toBe("no_target_app");
    });
  });

  describe("Native Autocomplete App", () => {
    it("routes desktop input through Typing Context, Memory Extraction Window, App Context, and Suggestion seams", () => {
      const buffer = createTypingContextBuffer();
      const memoryAppends: unknown[] = [];
      const appContextTrees: unknown[] = [];
      const runtime = createNativeAutocompleteApp({
        typingContext: buffer,
        appContext: {
          ingestAccessibilityTree: (input) => appContextTrees.push(input),
          getSnapshot: () => ({ fragments: [], metadata: { status: "empty" } }),
          clear: () => appContextTrees.push({ clear: true }),
        },
        memoryExtraction: {
          append: (input) => {
            memoryAppends.push(input);
            return true;
          },
          flush: async () => {},
          stop: () => {},
        },
        requestDeepComplete: () => null,
        outputs: {
          showSuggestion: () => {},
          clearSuggestion: () => {},
          hideOverlay: () => {},
          showDebugContext: () => {},
          resetDebugApiState: () => {},
        },
        createAcceptanceDependencies: (getCurrentSuggestion, getPreviouslyActiveApplication) => ({
          getCurrentSuggestion,
          getPreviouslyActiveApplication,
          setClipboard: async () => "",
          sendPaste: async () => {},
          restoreClipboard: async () => {},
        }),
        debounceMs: 5,
      });

      runtime.setActiveApplication("com.apple.Terminal", "window:1");
      runtime.appendText("git status");
      runtime.ingestAppContextTree({ role: "AXGroup", children: [{ role: "AXStaticText", value: "repo status" }] });

      expect(buffer.getState().context).toBe("git status");
      expect(memoryAppends).toEqual([
        {
          text: "git status",
          source: "terminal_input",
          activeApplication: { bundleId: "com.apple.Terminal", windowId: "window:1" },
        },
      ]);
      const ingestedTree = appContextTrees.find((event) => !("clear" in (event as Record<string, unknown>)));
      expect(ingestedTree).toMatchObject({
        activeApplication: { bundleId: "com.apple.Terminal", windowId: "window:1" },
      });
    });

    it("re-enters the suggestion loop when asynchronous App Context publishes", async () => {
      const buffer = createTypingContextBuffer();
      let listener: (() => void) | null = null;
      let contextState: AppContextSnapshotState = {
        snapshot: { fragments: [], metadata: { status: "empty" } },
        pending: true,
        revision: 1,
      };
      const localSnapshots: RequestableTypingContextSnapshot[] = [];
      const runtime = createNativeAutocompleteApp({
        typingContext: buffer,
        appContext: {
          ingestAccessibilityTree: () => {},
          ingestTextSession: () => {},
          getSnapshot: () => contextState.snapshot,
          getSnapshotState: () => contextState,
          subscribe: (next) => {
            listener = next;
            return () => {};
          },
          clear: () => {},
        },
        memoryExtraction: {
          append: () => true,
          flush: async () => {},
          stop: () => {},
        },
        getAutomaticSuggestion: async (snapshot) => {
          localSnapshots.push(snapshot);
          return null;
        },
        requestDeepComplete: () => null,
        outputs: {
          showSuggestion: () => {},
          clearSuggestion: () => {},
          hideOverlay: () => {},
          showDebugContext: () => {},
          resetDebugApiState: () => {},
        },
        createAcceptanceDependencies: (getCurrentSuggestion, getPreviouslyActiveApplication) => ({
          getCurrentSuggestion,
          getPreviouslyActiveApplication,
          setClipboard: async () => "",
          sendPaste: async () => {},
          restoreClipboard: async () => {},
        }),
        debounceMs: 5,
        appContextGraceMs: 30,
      });

      runtime.setActiveApplication("com.mitchellh.ghostty", "window:1");
      runtime.appendText("Explain this");
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(localSnapshots).toHaveLength(0);

      contextState = {
        snapshot: {
          fragments: [{
            id: "opencode-conversation",
            provider: "opencode-local-session",
            kind: "conversation",
            text: "Assistant: The asynchronous context is now ready.",
            confidence: 0.95,
            redaction: { applied: false, redactionCount: 0, kinds: [] },
            requestable: true,
            memoryEligible: false,
          }],
          metadata: { provider: "opencode-local-session", status: "available", confidence: 0.95 },
        },
        pending: false,
        revision: 2,
      };
      listener?.();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(localSnapshots[0]?.appContext?.fragments[0]?.text).toContain("asynchronous context");
    });

    it("carries matched OpenCode database context through the Native Autocomplete App into local inference", async () => {
      const rows: OpenCodeContextRow[] = [{
        session_id: "session-1",
        title: "End-to-end local context",
        directory: "/repo",
        time_updated: 1,
        message_id: "message-1",
        message_time: 1,
        role: "user",
        text: "Use this submitted OpenCode turn as local suggestion background.",
      }];
      const appContext = createAppContextExtractor({
        openCodeConversation: createOpenCodeConversationContext({
          dataDirectory: "/missing",
          databasePaths: ["opencode.db"],
          queryDatabase: async () => rows,
        }),
      });
      const localSnapshots: RequestableTypingContextSnapshot[] = [];
      const runtime = createNativeAutocompleteApp({
        typingContext: createTypingContextBuffer(),
        appContext,
        memoryExtraction: {
          append: () => true,
          flush: async () => {},
          stop: () => {},
        },
        getAutomaticSuggestion: async (snapshot) => {
          localSnapshots.push(snapshot);
          return null;
        },
        requestDeepComplete: () => null,
        outputs: {
          showSuggestion: () => {},
          clearSuggestion: () => {},
          hideOverlay: () => {},
          showDebugContext: () => {},
          resetDebugApiState: () => {},
        },
        createAcceptanceDependencies: (getCurrentSuggestion, getPreviouslyActiveApplication) => ({
          getCurrentSuggestion,
          getPreviouslyActiveApplication,
          setClipboard: async () => "",
          sendPaste: async () => {},
          restoreClipboard: async () => {},
        }),
        debounceMs: 5,
        appContextGraceMs: 30,
      });

      runtime.setActiveApplication("com.mitchellh.ghostty", "window:1");
      runtime.applyTextSessionSnapshot({
        activeApplication: { bundleId: "com.mitchellh.ghostty", windowId: "window:1" },
        focusedElementId: "ghostty:text-area",
        textElementId: "ghostty:text-area",
        selectedRange: { location: 0, length: 0 },
        caretIdentity: "range:0:0",
        secureLike: false,
        accessibilityReliability: "reliable",
        terminalTitle: "OC | End-to-end local context",
        terminalContents: "┃ Explain this\n▣ Build · model · 1s\n╹",
      });
      runtime.appendText("Explain this");
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(localSnapshots).toHaveLength(1);
      expect(localSnapshots[0]?.appContext?.fragments[0]).toMatchObject({
        provider: "opencode-local-session",
        kind: "conversation",
      });
      expect(localSnapshots[0]?.appContext?.fragments[0]?.text).toContain("submitted OpenCode turn");
    });
  });

  describe("native suggestion session", () => {
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    function makeSession(overrides: {
      requestSuggestion?: SuggestionSource;
      getLocalSuggestion?: SuggestionSource;
      localSuggestionModelId?: string;
      maxVisibleMs?: number;
      recordInteractionTelemetry?: (event: RecordTelemetryEventRequest) => void | Promise<void>;
      canAcceptLocalSuggestion?: () => boolean;
      onLocalAllowanceExhausted?: () => void;
      recordAcceptedUsage?: (event: {
        acceptanceId: string;
        acceptedAt: string;
        wordCount: number;
        characterCount: number;
      }) => void | Promise<void>;
      onLocalSuggestionAccepted?: (suggestionId: string) => void;
      sendPaste?: () => Promise<void>;
      setClipboard?: (text: string) => Promise<string>;
      waitForPaste?: () => Promise<void>;
      restoreClipboard?: (previous: string) => Promise<void>;
      triggerPolicy?: ReturnType<typeof createPoliteTriggerPolicy>;
      insertSemantically?: (text: string, target: TextSessionSnapshot) => Promise<boolean>;
      refreshTextSessionTarget?: () => TextSessionSnapshot | null;
      compatibilityStore?: ReturnType<typeof createApplicationCompatibilityStore>;
      getAppContext?: (snapshot: SafeTypingContextSnapshot) => AppContextSnapshot;
      getAppContextState?: (snapshot: SafeTypingContextSnapshot) => AppContextSnapshotState;
      clearAppContext?: () => void;
      appContextGraceMs?: number;
    } = {}) {
      const buffer = createTypingContextBuffer();
      const calls: Array<{ type: string; value?: unknown }> = [];
      let appContextListener: (() => void) | undefined;
      const session = createNativeAutocompleteApp({
        typingContext: buffer,
        appContext: {
          ingestAccessibilityTree: () => {},
          getSnapshot: overrides.getAppContext ?? (() => ({
            fragments: [],
            metadata: { status: "empty" },
          })),
          getSnapshotState: overrides.getAppContextState,
          subscribe: (listener) => {
            appContextListener = listener;
            return () => {};
          },
          clear: overrides.clearAppContext ?? (() => {}),
        },
        memoryExtraction: {
          append: () => true,
          flush: async () => {},
          stop: () => {},
        },
        getAutomaticSuggestion: overrides.getLocalSuggestion ?? (async (snapshot, options) => {
          calls.push({
            type: "requestSuggestion",
            value: snapshot.appContext
              ? {
                typingContext: snapshot.sanitizedContext,
                appContextStatus: snapshot.appContext.metadata.status,
                appContextProvider: snapshot.appContext.metadata.provider,
                appContextFragmentCount: snapshot.appContext.fragments.length,
              }
              : snapshot.sanitizedContext,
          });
          return { id: "s-1", text: " world" };
        }),
        requestDeepComplete: async (snapshot, options) => {
          calls.push({ type: "requestDeepComplete", value: snapshot.sanitizedContext });
          return overrides.requestSuggestion?.(snapshot, options) ?? { id: "s-1", text: " world" };
        },
        getContextSource: () => "typed_text",
        outputs: {
          showSuggestion: (suggestion, provenance) => {
            calls.push({ type: "showSuggestion", value: suggestion });
            calls.push({ type: "showSuggestionProvenance", value: provenance });
          },
          showGuidance: (message) => calls.push({ type: "showGuidance", value: message }),
          clearSuggestion: () => calls.push({ type: "clearSuggestion" }),
          hideOverlay: () => calls.push({ type: "hideOverlay" }),
          showDebugContext: () => calls.push({ type: "showDebugContext" }),
          resetDebugApiState: () => calls.push({ type: "resetDebugApiState" }),
          setSuggestionRefreshing: (refreshing) => calls.push({ type: "setSuggestionRefreshing", value: refreshing }),
          onExplicitActionDiagnostic: (diagnostic) => calls.push({
            type: "explicitActionDiagnostic",
            value: diagnostic,
          }),
          onAcceptanceDiagnostic: (diagnostic) => calls.push({
            type: "acceptanceDiagnostic",
            value: diagnostic,
          }),
        },
        createAcceptanceDependencies: (getCurrentSuggestion, getPreviouslyActiveApplication) => ({
          getCurrentSuggestion,
          getPreviouslyActiveApplication,
          setClipboard: async (text) => {
            calls.push({ type: "setClipboard", value: text });
            return overrides.setClipboard?.(text) ?? "previous-clipboard";
          },
          sendPaste: async () => {
            calls.push({ type: "sendPaste" });
            await overrides.sendPaste?.();
          },
          waitForPaste: overrides.waitForPaste
            ? async () => {
              calls.push({ type: "waitForPaste" });
              await overrides.waitForPaste?.();
            }
            : undefined,
          restoreClipboard: async (previous) => {
            calls.push({ type: "restoreClipboard", value: previous });
            await overrides.restoreClipboard?.(previous);
          },
          insertSemantically: overrides.insertSemantically
            ? async (text, target) => {
              calls.push({ type: "insertSemantically", value: text });
              return overrides.insertSemantically?.(text, target) ?? false;
            }
            : undefined,
        }),
        refreshTextSessionTarget: overrides.refreshTextSessionTarget,
        debounceMs: 5,
        maxVisibleMs: overrides.maxVisibleMs,
        recordInteractionTelemetry: overrides.recordInteractionTelemetry,
        canAcceptLocalSuggestion: overrides.canAcceptLocalSuggestion,
        onLocalAllowanceExhausted: overrides.onLocalAllowanceExhausted,
        recordAcceptedUsage: overrides.recordAcceptedUsage,
        onLocalSuggestionAccepted: overrides.onLocalSuggestionAccepted,
        localSuggestionModelId: overrides.localSuggestionModelId,
        triggerPolicy: overrides.triggerPolicy,
        compatibilityStore: overrides.compatibilityStore,
        appContextGraceMs: overrides.appContextGraceMs,
      });
      return {
        buffer,
        calls,
        session,
        publishAppContextChange: () => appContextListener?.(),
      };
    }

    function applyReliableCaret(session: ReturnType<typeof makeSession>["session"], text = "hello"): void {
      session.applyTextSessionSnapshot({
        activeApplication: { bundleId: "com.apple.TextEdit", windowId: "window:1" },
        focusedElementId: "focus:1",
        textElementId: "text:1",
        selectedRange: { location: text.length, length: 0 },
        selectedText: "",
        caretIdentity: `range:${text.length}:0`,
        secureLike: false,
        accessibilityReliability: "reliable",
        surroundingContext: { beforeCaret: text, afterCaret: "" },
      });
    }

    function rewriteTarget(overrides: Partial<TextSessionSnapshot> = {}): TextSessionSnapshot {
      return {
        activeApplication: { bundleId: "com.apple.TextEdit", windowId: "window:1" },
        focusedElementId: "focus:1",
        textElementId: "text:1",
        selectedRange: { location: 7, length: 5 },
        selectedText: "Draft",
        caretIdentity: "range:7:5",
        secureLike: false,
        accessibilityReliability: "reliable",
        surroundingContext: { beforeCaret: "Before ", afterCaret: " after" },
        ...overrides,
      };
    }

    type SuggestionSession = ReturnType<typeof makeSession>["session"];
    type RewriteInvalidation = readonly [
      name: string,
      invalidate: (session: SuggestionSession, target: TextSessionSnapshot) => void,
    ];
    const rewriteInvalidations: RewriteInvalidation[] = [
      ["application changes", (session, target) => session.applyTextSessionSnapshot({
        ...target,
        activeApplication: { bundleId: "com.apple.Notes", windowId: "window:1" },
      })],
      ["window changes", (session, target) => session.applyTextSessionSnapshot({
        ...target,
        activeApplication: { bundleId: "com.apple.TextEdit", windowId: "window:2" },
      })],
      ["focus identity changes", (session, target) => session.applyTextSessionSnapshot({ ...target, focusedElementId: "focus:2" })],
      ["text element identity changes", (session, target) => session.applyTextSessionSnapshot({ ...target, textElementId: "text:2" })],
      ["selected range changes", (session, target) => session.applyTextSessionSnapshot({
        ...target,
        selectedRange: { location: 8, length: 5 },
      })],
      ["selected text changes", (session, target) => session.applyTextSessionSnapshot({ ...target, selectedText: "Other" })],
      ["context before the selection changes", (session, target) => session.applyTextSessionSnapshot({
        ...target,
        surroundingContext: { beforeCaret: "Changed ", afterCaret: " after" },
      })],
      ["context after the selection changes", (session, target) => session.applyTextSessionSnapshot({
        ...target,
        surroundingContext: { beforeCaret: "Before ", afterCaret: " changed" },
      })],
      ["the target becomes secure", (session, target) => session.applyTextSessionSnapshot({ ...target, secureLike: true })],
      ["the target becomes secret-like", (session, target) => session.applyTextSessionSnapshot({
        ...target,
        surroundingContext: { beforeCaret: "api_key=abcdefghijklmnop", afterCaret: " after" },
      })],
      ["observation pauses", (session) => session.setPaused(true)],
      ["suspend clears context", (session) => session.clearContext()],
      ["lock-screen clears context", (session) => session.clearContext()],
      ["context is explicitly cleared", (session) => session.clearContext()],
    ];

    it("owns context changes and current suggestion state behind one session seam", async () => {
      const { buffer, calls, session } = makeSession();

      session.setActiveApplication("com.apple.TextEdit", "window:1");
      session.appendText("Hello");
      await wait(10);

      expect(buffer.getState().context).toBe("Hello");
      expect(calls.map((call) => call.type)).toContain("resetDebugApiState");
      expect(calls.map((call) => call.type)).toContain("clearSuggestion");
      expect(calls).toContainEqual({ type: "requestSuggestion", value: "Hello" });
      expect(session.getCurrentSuggestion()).toEqual({ id: "s-1", text: " world" });
    });

    it("uses the Automatic Suggestion source without invoking Deep Complete", async () => {
      const { calls, session } = makeSession();

      session.setActiveApplication("com.apple.TextEdit", "window:1");
      session.appendText("thank");
      await wait(10);

      expect(calls.filter((call) => call.type === "requestDeepComplete")).toHaveLength(0);
      expect(calls).toContainEqual({ type: "showSuggestion", value: { id: "s-1", text: " world" } });
      expect(session.getCurrentSuggestion()).toEqual({ id: "s-1", text: " world" });
    });

    it("never invokes Deep Complete when Automatic Suggestion returns empty or fails", async () => {
      for (const getLocalSuggestion of [
        async () => null,
        async () => {
          throw new Error("local unavailable");
        },
      ]) {
        const { calls, session } = makeSession({ getLocalSuggestion });

        session.setActiveApplication("com.apple.TextEdit", "window:1");
        session.appendText("hello");
        await wait(10);

        expect(calls.filter((call) => call.type === "requestDeepComplete")).toHaveLength(0);
        expect(session.getCurrentSuggestion()).toBeNull();
      }
    });

    it("routes only selection states consistent with their selected range", async () => {
      const { calls, session } = makeSession({
        getLocalSuggestion: async () => null,
        requestSuggestion: async () => ({ id: "explicit", text: "Improved text" }),
      });

      session.applyTextSessionSnapshot(rewriteTarget({
        selectedRange: { location: 7, length: 0 },
        caretIdentity: "range:7:0",
      }));
      await session.requestSuggestionNow();
      expect(calls.filter((call) => call.type === "requestDeepComplete")).toHaveLength(0);

      applyReliableCaret(session);
      await session.requestSuggestionNow();
      expect(calls.filter((call) => call.type === "requestDeepComplete")).toHaveLength(1);
      expect(calls).toContainEqual({ type: "showSuggestionProvenance", value: "deep_complete" });

      session.applyTextSessionSnapshot(rewriteTarget());
      await session.requestSuggestionNow();
      expect(calls.filter((call) => call.type === "requestDeepComplete")).toHaveLength(2);
      expect(calls).toContainEqual({ type: "showSuggestionProvenance", value: "rewrite" });
      expect(calls).toContainEqual({
        type: "explicitActionDiagnostic",
        value: { stage: "explicit-action-classified", outcome: "rewrite" },
      });
    });

    it("routes only reliable exact explicit targets and gives non-acceptable oversized guidance", async () => {
      const { calls, session } = makeSession({
        getLocalSuggestion: async () => null,
        requestSuggestion: async () => ({ id: "rewrite", text: "Improved text" }),
      });
      const selection = (selectedText: string | undefined, length = selectedText?.length ?? 0, reliability: TextSessionSnapshot["accessibilityReliability"] = "reliable"): TextSessionSnapshot => ({
        activeApplication: { bundleId: "com.apple.TextEdit", windowId: "window:1" },
        focusedElementId: "focus:1",
        textElementId: "text:1",
        selectedRange: { location: 7, length },
        selectedText,
        caretIdentity: `range:7:${length}`,
        secureLike: false,
        accessibilityReliability: reliability,
        surroundingContext: { beforeCaret: "Before ", afterCaret: " after" },
      });

      await session.requestSuggestionNow();
      session.applyTextSessionSnapshot(selection(undefined, 3));
      await session.requestSuggestionNow();
      session.applyTextSessionSnapshot(selection("bad", 3, "unreliable"));
      await session.requestSuggestionNow();
      const validTarget = selection("Draft");
      const secret = "api_key=abcdefghijklmnop";
      for (const target of [
        { ...validTarget, activeApplication: null },
        { ...validTarget, activeApplication: { bundleId: "com.apple.TextEdit" } },
        { ...validTarget, focusedElementId: null },
        { ...validTarget, textElementId: null },
        { ...validTarget, selectedRange: null },
        { ...validTarget, secureLike: true },
        { ...validTarget, activeApplication: { bundleId: "com.1password.1password", windowId: "window:1" } },
        selection(secret),
        { ...validTarget, surroundingContext: { beforeCaret: secret, afterCaret: " after" } },
        { ...validTarget, surroundingContext: { beforeCaret: "Before ", afterCaret: secret } },
      ] satisfies TextSessionSnapshot[]) {
        session.applyTextSessionSnapshot(target);
        await session.requestSuggestionNow();
      }
      expect(calls.filter((call) => call.type === "requestDeepComplete")).toHaveLength(0);

      session.applyTextSessionSnapshot(selection("x"));
      await session.requestSuggestionNow();
      expect(calls.filter((call) => call.type === "requestDeepComplete")).toHaveLength(1);
      expect(calls).toContainEqual({ type: "showSuggestionProvenance", value: "rewrite" });

      session.applyTextSessionSnapshot(selection("word ".repeat(400)));
      await session.requestSuggestionNow();
      expect(calls.filter((call) => call.type === "requestDeepComplete")).toHaveLength(2);

      session.applyTextSessionSnapshot(selection(`${"word ".repeat(400)}x`));
      await session.requestSuggestionNow();
      expect(calls).toContainEqual({ type: "showGuidance", value: "Select up to 2,000 characters" });
      expect(calls.filter((call) => call.type === "requestDeepComplete")).toHaveLength(2);
    });

    it("requests and bounds a Rewrite selected at the start of a field", async () => {
      const { calls, session } = makeSession({
        getLocalSuggestion: async () => null,
        requestSuggestion: async () => ({ id: "rewrite", text: "Improved" }),
      });
      session.applyTextSessionSnapshot(rewriteTarget({
        selectedRange: { location: 0, length: 5 },
        caretIdentity: "range:0:5",
        surroundingContext: { beforeCaret: "", afterCaret: " after" },
      }));

      await session.requestSuggestionNow();

      expect(calls.filter((call) => call.type === "requestDeepComplete")).toHaveLength(1);
      expect(calls).toContainEqual({ type: "showSuggestionProvenance", value: "rewrite" });
    });

    it("invalidates a pending Rewrite selected at the start of a field", async () => {
      let resolveRequest!: (suggestion: Suggestion | null) => void;
      let requestSignal: AbortSignal | undefined;
      const { calls, session } = makeSession({
        getLocalSuggestion: async () => null,
        requestSuggestion: async (_snapshot, options) => {
          requestSignal = options?.signal;
          return await new Promise<Suggestion | null>((resolve) => {
            resolveRequest = resolve;
          });
        },
      });
      const target = rewriteTarget({
        selectedRange: { location: 0, length: 5 },
        caretIdentity: "range:0:5",
        surroundingContext: { beforeCaret: "", afterCaret: " after" },
      });

      session.applyTextSessionSnapshot(target);
      const request = session.requestSuggestionNow();
      await wait(1);
      session.applyTextSessionSnapshot({ ...target, selectedText: "Other" });

      expect(requestSignal?.aborted).toBe(true);
      resolveRequest({ id: "late-rewrite", text: "Late replacement" });
      await request;
      expect(session.getCurrentSuggestion()).toBeNull();
      expect(calls).not.toContainEqual({ type: "showSuggestion", value: { id: "late-rewrite", text: "Late replacement" } });
    });

    it("invalidates a visible Rewrite selected at the start of a field", async () => {
      const { calls, session } = makeSession({
        getLocalSuggestion: async () => null,
        requestSuggestion: async () => ({ id: "visible-rewrite", text: "Clear replacement" }),
      });
      const target = rewriteTarget({
        selectedRange: { location: 0, length: 5 },
        caretIdentity: "range:0:5",
        surroundingContext: { beforeCaret: "", afterCaret: " after" },
      });

      session.applyTextSessionSnapshot(target);
      await session.requestSuggestionNow();
      expect(session.getCurrentSuggestion()).toEqual({ id: "visible-rewrite", text: "Clear replacement" });
      calls.length = 0;

      session.applyTextSessionSnapshot({ ...target, selectedText: "Other" });

      expect(session.getCurrentSuggestion()).toBeNull();
      expect(calls.map((call) => call.type)).toContain("clearSuggestion");
    });

    it("briefly presents oversized Rewrite guidance", async () => {
      const { calls, session } = makeSession({ maxVisibleMs: 5, getLocalSuggestion: async () => null });
      const selectedText = "x".repeat(2_001);
      session.applyTextSessionSnapshot(rewriteTarget({
        selectedRange: { location: 0, length: selectedText.length },
        selectedText,
        caretIdentity: `range:0:${selectedText.length}`,
        surroundingContext: { beforeCaret: "", afterCaret: "" },
      }));

      await session.requestSuggestionNow();
      expect(calls).toContainEqual({ type: "showGuidance", value: "Select up to 2,000 characters" });
      await wait(10);
      expect(calls.map((call) => call.type)).toContain("hideOverlay");
    });

    for (const [name, invalidate] of rewriteInvalidations) {
      it(`invalidates a pending Rewrite when ${name}`, async () => {
        let resolveRequest!: (suggestion: Suggestion | null) => void;
        let requestSignal: AbortSignal | undefined;
        const { calls, session } = makeSession({
          getLocalSuggestion: async () => null,
          requestSuggestion: async (_snapshot, options) => {
            requestSignal = options?.signal;
            return await new Promise<Suggestion | null>((resolve) => {
              resolveRequest = resolve;
            });
          },
        });
        const target = rewriteTarget();

        session.applyTextSessionSnapshot(target);
        const request = session.requestSuggestionNow();
        await wait(1);
        invalidate(session, target);

        expect(requestSignal?.aborted).toBe(true);
        resolveRequest({ id: "late-rewrite", text: "Late replacement" });
        await request;

        expect(session.getCurrentSuggestion()).toBeNull();
        expect(calls).not.toContainEqual({ type: "showSuggestion", value: { id: "late-rewrite", text: "Late replacement" } });
      });

      it(`invalidates a visible Rewrite when ${name}`, async () => {
        const { calls, session } = makeSession({
          getLocalSuggestion: async () => null,
          requestSuggestion: async () => ({ id: "visible-rewrite", text: "Clear replacement" }),
        });
        const target = rewriteTarget();
        session.applyTextSessionSnapshot(target);
        await session.requestSuggestionNow();
        expect(session.getCurrentSuggestion()).toEqual({ id: "visible-rewrite", text: "Clear replacement" });
        expect(calls).toContainEqual({ type: "showSuggestionProvenance", value: "rewrite" });
        calls.length = 0;

        invalidate(session, target);
        await session.acceptCurrentSuggestion();

        expect(session.getCurrentSuggestion()).toBeNull();
        expect(calls.map((call) => call.type)).not.toContain("setClipboard");
        expect(calls.map((call) => call.type)).not.toContain("sendPaste");
      });
    }

    it("does not present a Rewrite when a reliable selection returns empty", async () => {
      const { calls, session } = makeSession({
        getLocalSuggestion: async () => null,
        requestSuggestion: async () => null,
      });

      session.applyTextSessionSnapshot(rewriteTarget());
      await session.requestSuggestionNow();

      expect(session.getCurrentSuggestion()).toBeNull();
      expect(calls.map((call) => call.type)).not.toContain("showSuggestion");
    });

    it("records metadata-only telemetry for a dismissed Rewrite", async () => {
      const telemetry: RecordTelemetryEventRequest[] = [];
      const target = rewriteTarget({
        selectedText: "rewrite-selected-private-source",
        selectedRange: { location: 7, length: 31 },
        caretIdentity: "range:7:31",
        surroundingContext: {
          beforeCaret: "rewrite-before-private-context",
          afterCaret: "rewrite-after-private-context",
        },
      });
      const replacement = "rewrite-private-replacement";
      const { session } = makeSession({
        getLocalSuggestion: async () => null,
        requestSuggestion: async () => ({ id: "sg-rewrite-request-1", text: replacement }),
        recordInteractionTelemetry: (event) => telemetry.push(event),
      });

      session.applyTextSessionSnapshot(target);
      await session.requestSuggestionNow();
      session.clearContext();

      expect(telemetry).toHaveLength(1);
      expect(telemetry[0]).toMatchObject({
        eventType: "suggestion_dismissed",
        requestId: "rewrite-request-1",
        inferenceSource: "deep_complete",
        trigger: "explicit",
        suggestionLength: replacement.length,
      });
      const serialized = JSON.stringify(telemetry);
      for (const privateText of [
        target.selectedText,
        target.surroundingContext?.beforeCaret,
        target.surroundingContext?.afterCaret,
        replacement,
      ]) {
        expect(serialized).not.toContain(privateText!);
      }
    });

    it("accepts Rewrite through one synchronous exact-target refresh without Local usage", async () => {
      const target = rewriteTarget();
      const telemetry: RecordTelemetryEventRequest[] = [];
      const usage: unknown[] = [];
      const refreshes: string[] = [];
      const { calls, session } = makeSession({
        getLocalSuggestion: async () => null,
        requestSuggestion: async () => ({ id: "sg-rewrite-accept", text: "Clear replacement" }),
        refreshTextSessionTarget: () => {
          refreshes.push("refresh");
          return target;
        },
        canAcceptLocalSuggestion: () => false,
        recordAcceptedUsage: (event) => usage.push(event),
        recordInteractionTelemetry: (event) => telemetry.push(event),
      });
      session.applyTextSessionSnapshot(target);
      await session.requestSuggestionNow();
      calls.length = 0;

      await createSuggestionAcceptanceTriggers(() => session.acceptCurrentSuggestion()).keyboard();

      expect(refreshes).toEqual(["refresh"]);
      expect(calls.filter((call) => call.type === "setClipboard")).toEqual([
        { type: "setClipboard", value: "Clear replacement" },
      ]);
      expect(calls.filter((call) => call.type === "sendPaste")).toHaveLength(1);
      expect(calls.map((call) => call.type)).not.toContain("insertSemantically");
      expect(calls.filter((call) => call.type === "acceptanceDiagnostic").map((call) => call.value)).toEqual([
        { stage: "acceptance-entry", outcome: "rewrite" },
        { stage: "acceptance-guard", outcome: "ready" },
        { stage: "target-revalidation", outcome: "matched" },
        { stage: "clipboard-write", outcome: "started" },
        { stage: "clipboard-write", outcome: "succeeded" },
        { stage: "paste-dispatch", outcome: "started" },
        { stage: "paste-dispatch", outcome: "succeeded" },
        { stage: "paste-wait", outcome: "started" },
        { stage: "paste-wait", outcome: "succeeded" },
        { stage: "clipboard-restoration", outcome: "started" },
        { stage: "clipboard-restoration", outcome: "succeeded" },
        { stage: "insertion-outcome", outcome: "succeeded" },
        { stage: "acceptance-result", outcome: "inserted" },
      ]);
      expect(usage).toEqual([]);
      expect(session.getCurrentSuggestion()).toBeNull();
      const accepted = telemetry.find((event) => event.eventType === "suggestion_accepted");
      expect(accepted).toMatchObject({
        inferenceSource: "deep_complete",
        trigger: "explicit",
        acceptedWordCount: 2,
        acceptedCharacterCount: 17,
        applicationCategory: "productivity",
        selectedTextLength: 5,
      });
      const serialized = JSON.stringify(telemetry);
      for (const raw of [target.selectedText, target.surroundingContext?.beforeCaret, target.surroundingContext?.afterCaret, "Clear replacement"]) {
        expect(serialized).not.toContain(raw!);
      }
    });

    it("keyboard and click invoke the same public Acceptance behavior", async () => {
      for (const triggerName of ["keyboard", "click"] as const) {
        const target = rewriteTarget();
        const { calls, session } = makeSession({
          getLocalSuggestion: async () => null,
          requestSuggestion: async () => ({ id: `sg-${triggerName}`, text: "Clear replacement" }),
          refreshTextSessionTarget: () => target,
        });
        session.applyTextSessionSnapshot(target);
        await session.requestSuggestionNow();
        calls.length = 0;
        await createSuggestionAcceptanceTriggers(() => session.acceptCurrentSuggestion())[triggerName]();
        expect(calls.filter((call) => call.type === "setClipboard")).toHaveLength(1);
        expect(calls.filter((call) => call.type === "sendPaste")).toHaveLength(1);
        expect(calls.filter((call) => call.type === "restoreClipboard")).toHaveLength(1);
      }
    });

    for (const triggerName of ["keyboard", "click"] as const) {
      it(`${triggerName} Acceptance refreshes every stale target through the public trigger path`, async () => {
        const target = rewriteTarget();
        const secret = "api_key=abcdefghijklmnop";
        const staleTargets: Array<TextSessionSnapshot | null> = [
          null,
          { ...target, activeApplication: { bundleId: "com.apple.Notes", windowId: "window:1" } },
          { ...target, activeApplication: { bundleId: "com.apple.TextEdit", windowId: "window:2" } },
          { ...target, focusedElementId: "focus:2" },
          { ...target, textElementId: "text:2" },
          { ...target, selectedRange: { location: 8, length: 5 } },
          { ...target, selectedText: "Other" },
          { ...target, surroundingContext: { beforeCaret: "Changed ", afterCaret: " after" } },
          { ...target, surroundingContext: { beforeCaret: "Before ", afterCaret: " changed" } },
          { ...target, accessibilityReliability: "unreliable" },
          { ...target, secureLike: true },
          { ...target, selectedText: secret, selectedRange: { location: 7, length: secret.length } },
          { ...target, focusedElementId: null },
          { ...target, textElementId: null },
          { ...target, selectedRange: null },
          { ...target, selectedText: undefined },
          { ...target, surroundingContext: undefined },
          { ...target, caretIdentity: "range:8:5" },
          { ...target, activeApplication: { bundleId: "com.apple.TextEdit", windowId: "app:123" } },
          { ...target, focusedElementId: "ax:com.apple.TextEdit:AXTextArea:unknown-subrole" },
          { ...target, textElementId: "ax:com.apple.TextEdit:AXTextArea:unknown-subrole" },
        ];
        for (const staleTarget of staleTargets) {
          let refreshes = 0;
          const { calls, session } = makeSession({
            getLocalSuggestion: async () => null,
            requestSuggestion: async () => ({ id: "sg-rewrite-stale", text: "Clear replacement" }),
            refreshTextSessionTarget: () => { refreshes += 1; return staleTarget; },
          });
          session.applyTextSessionSnapshot(target);
          await session.requestSuggestionNow();
          calls.length = 0;
          const triggers = createSuggestionAcceptanceTriggers(() => session.acceptCurrentSuggestion());
          await triggers[triggerName]();
          expect(refreshes).toBe(1);
          expect(calls.map((call) => call.type)).not.toContain("setClipboard");
          expect(calls.map((call) => call.type)).not.toContain("sendPaste");
        }
      });
    }

    for (const failure of ["clipboard", "dispatch", "wait", "restore"] as const) {
      it(`public Acceptance trigger covers ${failure} behavior and usage/privacy separation`, async () => {
        const target = rewriteTarget();
        const telemetry: RecordTelemetryEventRequest[] = [];
        const usage: unknown[] = [];
        const { calls, session } = makeSession({
          getLocalSuggestion: async () => null,
          requestSuggestion: async () => ({ id: "sg-rewrite-failure", text: "Clear replacement" }),
          refreshTextSessionTarget: () => target,
          recordInteractionTelemetry: (event) => telemetry.push(event),
          recordAcceptedUsage: (event) => usage.push(event),
          insertSemantically: async () => true,
          setClipboard: failure === "clipboard" ? async () => { throw new Error("clipboard failed"); } : undefined,
          sendPaste: failure === "dispatch" ? async () => { throw new Error("dispatch failed"); } : undefined,
          waitForPaste: failure === "wait" ? async () => { throw new Error("wait failed"); } : async () => {},
          restoreClipboard: failure === "restore" ? async () => { throw new Error("restore failed"); } : undefined,
        });
        session.applyTextSessionSnapshot(target);
        await session.requestSuggestionNow();
        calls.length = 0;
        const triggers = createSuggestionAcceptanceTriggers(() => session.acceptCurrentSuggestion());
        if (failure === "restore") await expect(triggers.click()).resolves.toBeUndefined();
        else await expect(triggers.keyboard()).rejects.toThrow();
        expect(calls.map((call) => call.type)).not.toContain("insertSemantically");
        expect(usage).toEqual([]);
        expect(telemetry.some((event) => event.eventType === "suggestion_accepted")).toBe(failure === "restore");
        expect(JSON.stringify(telemetry)).not.toContain(target.selectedText!);
        if (failure !== "clipboard") expect(calls.map((call) => call.type)).toContain("restoreClipboard");
      });
    }

    it("keeps the overlay mounted while replacing a local suggestion after continued typing", async () => {
      const { calls, session } = makeSession({
        getLocalSuggestion: async (snapshot) => snapshot.sanitizedContext === "hello"
          ? { id: "sg-local-hello", text: " there" }
          : { id: "sg-local-world", text: " today" },
      });

      session.setActiveApplication("com.mitchellh.ghostty", "window:1");
      session.appendText("hello");
      await wait(10);
      expect(session.getCurrentSuggestion()).toEqual({ id: "sg-local-hello", text: " there" });
      calls.length = 0;

      session.appendText(" world");

      expect(calls).toContainEqual({ type: "setSuggestionRefreshing", value: true });
      expect(calls.map((call) => call.type)).not.toContain("hideOverlay");
      expect(calls.map((call) => call.type)).not.toContain("clearSuggestion");

      await wait(10);

      expect(calls).toContainEqual({
        type: "showSuggestion",
        value: { id: "sg-local-world", text: " today" },
      });
      expect(calls).toContainEqual({ type: "setSuggestionRefreshing", value: false });
      expect(session.getCurrentSuggestion()).toEqual({ id: "sg-local-world", text: " today" });
    });

    it("replaces a visible async local suggestion with an explicit cloud suggestion", async () => {
      const { calls, session } = makeSession({
        getLocalSuggestion: async () => ({ id: "sg-local-thank", text: " you" }),
        requestSuggestion: async () => ({ id: "cloud-thank", text: " you very much" }),
      });

      applyReliableCaret(session, "thank");
      await wait(10);
      expect(session.getCurrentSuggestion()).toEqual({ id: "sg-local-thank", text: " you" });
      calls.length = 0;

      await session.requestSuggestionNow();

      expect(calls).toContainEqual({ type: "setSuggestionRefreshing", value: true });
      expect(calls).toContainEqual({ type: "setSuggestionRefreshing", value: false });
      expect(calls.map((call) => call.type)).not.toContain("hideOverlay");
      expect(calls.map((call) => call.type)).not.toContain("clearSuggestion");
      expect(calls).toContainEqual({ type: "requestDeepComplete", value: "thank" });
      expect(calls).toContainEqual({ type: "showSuggestion", value: { id: "cloud-thank", text: " you very much" } });
      expect(session.getCurrentSuggestion()).toEqual({ id: "cloud-thank", text: " you very much" });
    });

    it("keeps the visible local suggestion when an explicit cloud request returns empty", async () => {
      const { calls, session } = makeSession({
        getLocalSuggestion: async () => ({ id: "sg-local-thank", text: " you" }),
        requestSuggestion: async () => null,
      });

      applyReliableCaret(session, "thank");
      await wait(10);
      calls.length = 0;

      await session.requestSuggestionNow();

      expect(calls).toContainEqual({ type: "showSuggestion", value: { id: "sg-local-thank", text: " you" } });
      expect(session.getCurrentSuggestion()).toEqual({ id: "sg-local-thank", text: " you" });
    });

    it("restores an Automatic Suggestion for only its remaining lifetime", async () => {
      const { calls, session } = makeSession({
        getLocalSuggestion: async () => ({ id: "automatic", text: " retained" }),
        requestSuggestion: async () => {
          await wait(40);
          return null;
        },
        maxVisibleMs: 200,
      });

      applyReliableCaret(session);
      await wait(10);
      await session.requestSuggestionNow();
      expect(session.getCurrentSuggestion()).toEqual({ id: "automatic", text: " retained" });

      await wait(175);

      expect(session.getCurrentSuggestion()).toBeNull();
      expect(calls.map((call) => call.type)).toContain("hideOverlay");
    });

    it("does not restore or accept a prior Deep Complete after its absolute deadline", async () => {
      let deepCalls = 0;
      const { calls, session } = makeSession({
        getLocalSuggestion: async () => ({ id: "automatic", text: " initial" }),
        requestSuggestion: async () => {
          deepCalls += 1;
          if (deepCalls === 1) return { id: "deep", text: " prior deep" };
          await wait(60);
          return null;
        },
        maxVisibleMs: 40,
      });

      session.setActiveApplication("com.apple.TextEdit", "window:1");
      session.appendText("hello");
      await wait(10);
      applyReliableCaret(session);
      await session.requestSuggestionNow();
      expect(session.getCurrentSuggestion()).toEqual({ id: "deep", text: " prior deep" });
      calls.length = 0;

      await session.requestSuggestionNow();
      await session.acceptCurrentSuggestion();

      expect(session.getCurrentSuggestion()).toBeNull();
      expect(calls.map((call) => call.type)).toContain("hideOverlay");
      expect(calls.map((call) => call.type)).not.toContain("setClipboard");
    });

    it("cancels an in-flight Automatic Suggestion when Deep Complete takes overlay ownership", async () => {
      let automaticCalls = 0;
      let automaticSignal: AbortSignal | undefined;
      let resolveAutomatic: ((suggestion: Suggestion | null) => void) | undefined;
      const { session } = makeSession({
        getLocalSuggestion: async (_snapshot, options) => {
          automaticCalls += 1;
          if (automaticCalls === 1) return { id: "initial", text: " first" };
          automaticSignal = options?.signal;
          return new Promise((resolve) => {
            resolveAutomatic = resolve;
          });
        },
        requestSuggestion: async () => ({ id: "deep", text: " definitive" }),
      });

      session.setActiveApplication("com.apple.TextEdit", "window:1");
      session.appendText("hello");
      await wait(10);
      session.appendText(" again");
      await wait(10);

      applyReliableCaret(session, "hello again");
      await session.requestSuggestionNow();
      resolveAutomatic?.({ id: "late-automatic", text: " stale" });
      await wait(1);

      expect(automaticSignal?.aborted).toBe(true);
      expect(session.getCurrentSuggestion()).toEqual({ id: "deep", text: " definitive" });
    });

    it("restores the previous Suggestion when Deep Complete inference fails", async () => {
      const { calls, session } = makeSession({
        getLocalSuggestion: async () => ({ id: "previous", text: " retained" }),
        requestSuggestion: async () => {
          throw new Error("cloud unavailable");
        },
      });

      applyReliableCaret(session);
      await wait(10);
      calls.length = 0;

      await session.requestSuggestionNow();

      expect(session.getCurrentSuggestion()).toEqual({ id: "previous", text: " retained" });
      expect(calls).toContainEqual({
        type: "showSuggestion",
        value: { id: "previous", text: " retained" },
      });
    });

    it("uses Deep Complete provenance instead of an ID prefix for Accepted Word enforcement", async () => {
      const usage: unknown[] = [];
      const { calls, session } = makeSession({
        getLocalSuggestion: async () => ({ id: "automatic", text: " initial" }),
        requestSuggestion: async () => ({ id: "sg-local-misleading", text: " deep words" }),
        canAcceptLocalSuggestion: () => false,
        recordAcceptedUsage: (event) => usage.push(event),
      });

      session.setActiveApplication("com.apple.TextEdit", "window:1");
      session.appendText("hello");
      await wait(10);
      applyReliableCaret(session);
      await session.requestSuggestionNow();
      await session.acceptCurrentSuggestion();

      expect(calls).toContainEqual({ type: "setClipboard", value: " deep words" });
      expect(usage).toEqual([]);
    });

    it("accepts the visible suggestion into the previously active application", async () => {
      const { buffer, calls, session } = makeSession();

      session.setActiveApplication("com.apple.TextEdit", "window:1");
      session.appendText("Hello");
      await wait(10);
      await session.acceptCurrentSuggestion();

      expect(calls.map((call) => call.type)).toContain("setClipboard");
      expect(calls).toContainEqual({ type: "setClipboard", value: " world" });
      expect(calls.map((call) => call.type)).toContain("sendPaste");
      expect(buffer.getState().context).toBe("Hello world");
    });

    it("requests another local suggestion after accepting into fallback terminal context", async () => {
      const requestedContexts: string[] = [];
      const { session, publishAppContextChange } = makeSession({
        getLocalSuggestion: async (snapshot) => {
          requestedContexts.push(snapshot.sanitizedContext);
          return snapshot.sanitizedContext === "hello"
            ? { id: "sg-local-first", text: " there" }
            : { id: "sg-local-second", text: " friend" };
        },
      });

      session.setActiveApplication("com.mitchellh.ghostty", "window:1");
      session.appendText("hello");
      await wait(10);
      await session.acceptCurrentSuggestion();
      await wait(10);

      expect(requestedContexts).toEqual(["hello", "hello there"]);
      expect(session.getCurrentSuggestion()).toEqual({ id: "sg-local-second", text: " friend" });
    });

    it("accepts through semantic insertion and clears only after insertion succeeds", async () => {
      const { buffer, calls, session } = makeSession({ insertSemantically: async () => true });
      const textSession: TextSessionSnapshot = {
        activeApplication: { bundleId: "com.apple.TextEdit", windowId: "window:1" },
        focusedElementId: "focus:1",
        textElementId: "text:1",
        selectedRange: { location: 5, length: 0 },
        caretIdentity: "range:5:0",
        secureLike: false,
        accessibilityReliability: "reliable",
        supportsSemanticInsertion: true,
        surroundingContext: { beforeCaret: "Hello", afterCaret: "" },
      };

      session.applyTextSessionSnapshot(textSession);
      await wait(10);
      await session.acceptCurrentSuggestion();

      expect(calls.map((call) => call.type)).toContain("insertSemantically");
      expect(calls.map((call) => call.type)).not.toContain("setClipboard");
      expect(calls.map((call) => call.type)).toContain("hideOverlay");
      expect(buffer.getState().context).toBe("");
      expect(session.getCurrentSuggestion()).toBeNull();
    });

    it("clears context and suppresses observation while paused", () => {
      const { buffer, session } = makeSession();

      session.appendText("Hello");
      session.setPaused(true);
      session.appendText(" world");

      expect(session.isPaused()).toBe(true);
      expect(buffer.getState().context).toBe("");
    });

    it("attaches suggestion-only App Context to requestable snapshots", async () => {
      const { calls, session } = makeSession({
        getAppContext: () => ({
          fragments: [
            {
              id: "fragment-1",
              provider: "synthetic-provider",
              kind: "visible_text",
              text: "Background only",
              confidence: 0.9,
              redaction: { applied: false, redactionCount: 0, kinds: [] },
              requestable: true,
              memoryEligible: false,
            },
          ],
          metadata: { provider: "synthetic-provider", status: "available", confidence: 0.9 },
        }),
      });

      session.setActiveApplication("com.apple.TextEdit", "window:1");
      session.appendText("Hello");
      await wait(10);

      const requestCall = calls.find((call) => call.type === "requestSuggestion");
      expect(requestCall?.value).toMatchObject({
        typingContext: "Hello",
        appContextStatus: "available",
        appContextProvider: "synthetic-provider",
        appContextFragmentCount: 1,
      });
    });

    it("records App Context compatibility metadata without raw context", async () => {
      const compatibilityStore = createApplicationCompatibilityStore();
      const rawAppContext = "Dana: The launch room is Atlas 417";
      const { session, publishAppContextChange } = makeSession({
        compatibilityStore,
        getAppContext: () => ({
          fragments: [
            {
              id: "slack-1",
              provider: "slack-accessibility",
              kind: "conversation",
              text: rawAppContext,
              confidence: 0.82,
              redaction: { applied: false, redactionCount: 0, kinds: [] },
              requestable: true,
              memoryEligible: false,
            },
          ],
          metadata: { provider: "slack-accessibility", status: "available", confidence: 0.82 },
        }),
      });

      session.setActiveApplication("com.tinyspeck.slackmacgap", "window:1");
      session.appendText("Reply draft");
      await wait(10);

      const profile = compatibilityStore.getProfile({ bundleId: "com.tinyspeck.slackmacgap" });
      expect(profile.appContextAvailableCount).toBeGreaterThan(0);
      expect(JSON.stringify(profile)).not.toContain(rawAppContext);
      expect(JSON.stringify(profile)).not.toContain("Reply draft");
      expect(JSON.stringify(profile)).not.toContain("suggestionText");
      expect(JSON.stringify(profile)).not.toContain("finalInsertedText");
    });

    it("clears App Context on lifecycle clearing events", () => {
      const manager = createAppContextManager();
      manager.setCandidate({
        fragments: [
          {
            id: "fragment-1",
            provider: "synthetic-provider",
            kind: "visible_text",
            text: "Temporary background",
            confidence: 0.9,
          },
        ],
        metadata: { provider: "synthetic-provider", status: "available", confidence: 0.9 },
      });
      const { session } = makeSession({
        getAppContext: () => manager.getSnapshot(),
        clearAppContext: () => manager.clear(),
      });

      session.clearContext();

      expect(manager.getSnapshot().fragments).toHaveLength(0);
      expect(manager.getSnapshot().metadata.status).toBe("cleared");
    });

    describe("Zed focused editor App Context", () => {
      const zedProvider = createZedFocusedEditorAppContextCandidateProvider();
      const zedTextSession = (overrides: Partial<TextSessionSnapshot> = {}): TextSessionSnapshot => {
        const beforeCaret = overrides.surroundingContext?.beforeCaret ?? "# Launch notes\n\nWe should explain the privacy model";
        const afterCaret = overrides.surroundingContext?.afterCaret ?? " before the demo starts.";
        return {
          activeApplication: { bundleId: "dev.zed.Zed", windowId: "window:zed" },
          focusedElementId: "focus:editor",
          textElementId: "text:editor",
          selectedRange: { location: beforeCaret.length, length: 0 },
          caretIdentity: `caret:${beforeCaret.length}`,
          secureLike: false,
          accessibilityReliability: "reliable",
          supportsSemanticInsertion: true,
          surroundingContext: { beforeCaret, afterCaret },
          ...overrides,
        };
      };
      const providerSnapshot = (textSession: TextSessionSnapshot): AppContextSnapshot =>
        normalizeAppContext(zedProvider(createSafeTextSessionSnapshot(textSession)));

      it("extracts bounded suggestion-only context for Zed prose, markdown, and comments", () => {
        const candidate = zedProvider(createSafeTextSessionSnapshot(zedTextSession()));
        expect(candidate.fragments[0]).not.toHaveProperty("redaction");
        expect(candidate.fragments[0]).not.toHaveProperty("requestable");
        expect(candidate.fragments[0]).not.toHaveProperty("memoryEligible");

        const markdown = normalizeAppContext(candidate);
        expect(markdown.metadata).toMatchObject({
          provider: "zed-focused-editor",
          status: "available",
        });
        expect(markdown.fragments).toHaveLength(1);
        const markdownFragment = markdown.fragments[0];
        expect(markdownFragment).toMatchObject({
          provider: "zed-focused-editor",
          kind: "focused_editor",
          requestable: true,
          memoryEligible: false,
        });
        expect(markdownFragment.text).toContain("# Launch notes");
        expect(markdownFragment.text).toContain("before the demo starts.");

        const comment = providerSnapshot(zedTextSession({
          surroundingContext: {
            beforeCaret: "function buildPrompt() {\n  // Keep app context separate from typing context",
            afterCaret: "\n  return prompt;\n}",
          },
        }));

        expect(comment.metadata.status).toBe("available");
        const commentFragment = comment.fragments[0];
        expect(commentFragment.text).toContain("// Keep app context separate");

        const longBefore = `${"Earlier paragraph. ".repeat(220)}Current caret idea`;
        const long = providerSnapshot(zedTextSession({
          surroundingContext: { beforeCaret: longBefore, afterCaret: " Next sentence." },
        }));

        const longFragment = long.fragments[0];
        expect(longFragment.text.length).toBeLessThanOrEqual(2_000);
        expect(longFragment.text).toContain("Current caret idea");
        expect(longFragment.text).not.toBe(longBefore + " Next sentence.");
        expect(longFragment.text).not.toStartWith("Earlier paragraph. Earlier paragraph. Earlier paragraph.");
      });

      it("falls back safely for unsupported, unreliable, partial, and secret-like editor states", () => {
        const unsupported = providerSnapshot(zedTextSession({
          activeApplication: { bundleId: "com.apple.TextEdit", windowId: "window:1" },
        }));
        expect(unsupported.fragments).toHaveLength(0);
        expect(unsupported.metadata.status).toBe("unsupported");

        const unreliable = providerSnapshot(zedTextSession({ accessibilityReliability: "unreliable" }));
        expect(unreliable.fragments).toHaveLength(0);
        expect(unreliable.metadata.status).toBe("empty");

        const partial = providerSnapshot(zedTextSession({ surroundingContext: { beforeCaret: "", afterCaret: "" } }));
        expect(partial.fragments).toHaveLength(0);
        expect(partial.metadata.status).toBe("empty");

        const secretLike = providerSnapshot(zedTextSession({
          surroundingContext: { beforeCaret: "OPENAI_API_KEY=sk-abc1234567890", afterCaret: "" },
        }));
        expect(secretLike.fragments).toHaveLength(0);
        expect(secretLike.metadata.status).toBe("suppressed");
        expect(secretLike.metadata.suppressionReason).toBe("secret_like_context");

        const codeLike = providerSnapshot(zedTextSession({
          surroundingContext: {
            beforeCaret: "function issueToken(user) {\n  const token = sign(user.id);\n  return token;\n}",
            afterCaret: "",
          },
        }));
        expect(codeLike.fragments).toHaveLength(0);
        expect(codeLike.metadata.status).toBe("suppressed");
        expect(codeLike.metadata.suppressionReason).toBe("code_like_context");
      });
    });

    it("updates context when the user deletes text", () => {
      const { buffer, session } = makeSession();

      session.setActiveApplication("com.apple.TextEdit", "window:1");
      session.appendText("Hello world");
      session.deleteBackward("token");

      expect(buffer.getState().context).toBe("Hello");
    });

    it("clears an uncertain terminal draft after an unmodeled edit", async () => {
      const { buffer, calls, session } = makeSession();

      session.setActiveApplication("com.mitchellh.ghostty", "window:1");
      session.appendText("Explain this");
      await wait(10);
      expect(session.getCurrentSuggestion()).not.toBeNull();

      session.invalidateContext();

      expect(buffer.getState().context).toBe("");
      expect(session.getCurrentSuggestion()).toBeNull();
      expect(calls.map((call) => call.type)).toContain("clearSuggestion");
    });

    it("routes reliable Text Session snapshots through the loop and falls back to Typing Context when unreliable", async () => {
      const { calls, session } = makeSession();
      const textSession = (overrides: Partial<TextSessionSnapshot> = {}): TextSessionSnapshot => ({
        activeApplication: { bundleId: "com.apple.TextEdit", windowId: "window:1" },
        focusedElementId: "focus:1",
        textElementId: "text:1",
        selectedRange: { location: 5, length: 0 },
        caretIdentity: "caret:5",
        secureLike: false,
        accessibilityReliability: "reliable",
        surroundingContext: { beforeCaret: "Hello", afterCaret: "" },
        caretBounds: { x: 10, y: 20, width: 1, height: 18 },
        ...overrides,
      });

      session.applyTextSessionSnapshot(textSession());
      await wait(10);

      expect(calls).toContainEqual({ type: "requestSuggestion", value: "Hello" });
      expect(session.getCurrentSuggestion()).toEqual({ id: "s-1", text: " world" });

      session.applyTextSessionSnapshot(textSession({ caretIdentity: "caret:3", selectedRange: { location: 3, length: 0 } }));
      await wait(10);

      expect(calls.map((call) => call.type)).not.toContain("hideOverlay");
      expect(calls).toContainEqual({ type: "setSuggestionRefreshing", value: true });

      const hidesAfterCaretChange = calls.filter((call) => call.type === "hideOverlay").length;
      session.applyTextSessionSnapshot(textSession({ focusedElementId: "focus:2", textElementId: "text:2" }));
      await wait(10);

      expect(calls.filter((call) => call.type === "hideOverlay").length).toBeGreaterThan(hidesAfterCaretChange);

      const hidesAfterElementChange = calls.filter((call) => call.type === "hideOverlay").length;
      session.applyTextSessionSnapshot(textSession({ activeApplication: { bundleId: "com.apple.Notes", windowId: "window:2" } }));
      await wait(10);

      expect(calls.filter((call) => call.type === "hideOverlay").length).toBeGreaterThan(hidesAfterElementChange);

      const requestsBeforeSecureSnapshot = calls.filter((call) => call.type === "requestSuggestion").length;
      session.applyTextSessionSnapshot(textSession({ secureLike: true }));
      await wait(10);

      expect(calls.filter((call) => call.type === "requestSuggestion")).toHaveLength(requestsBeforeSecureSnapshot);
      expect(session.getCurrentSuggestion()).toBeNull();

      session.applyTextSessionSnapshot(textSession({ accessibilityReliability: "unreliable" }));
      session.setActiveApplication("com.apple.TextEdit", "window:1");
      session.appendText("Fallback");
      await wait(10);

      expect(calls).toContainEqual({ type: "requestSuggestion", value: "Fallback" });
    });

    it("falls back to terminal input when Accessibility reports a reliable but contextless Text Session", async () => {
      const { calls, session } = makeSession();

      session.setActiveApplication("com.mitchellh.ghostty", "window:1");
      session.applyTextSessionSnapshot({
        activeApplication: { bundleId: "com.mitchellh.ghostty", windowId: "window:1" },
        focusedElementId: "ghostty:text-area",
        textElementId: "ghostty:text-area",
        selectedRange: { location: 0, length: 0 },
        caretIdentity: "range:0:0",
        secureLike: false,
        accessibilityReliability: "reliable",
        surroundingContext: { beforeCaret: "", afterCaret: "" },
      });
      session.appendText("Analyze this");
      await wait(10);

      expect(session.getCurrentSnapshot().sanitizedContext).toBe("Analyze this");
      expect(calls).toContainEqual({ type: "requestSuggestion", value: "Analyze this" });
    });

    it("keeps terminal input authoritative when Ghostty exposes intermittent Accessibility text", async () => {
      const { buffer, session } = makeSession();

      session.setActiveApplication("com.mitchellh.ghostty", "window:1");
      session.appendText("Analyze this");
      session.applyTextSessionSnapshot({
        activeApplication: { bundleId: "com.mitchellh.ghostty", windowId: "window:1" },
        focusedElementId: "ghostty:text-area",
        textElementId: "ghostty:text-area",
        selectedRange: { location: 5, length: 0 },
        caretIdentity: "range:5:0",
        secureLike: false,
        accessibilityReliability: "reliable",
        surroundingContext: { beforeCaret: "shell", afterCaret: "" },
      });

      expect(session.getCurrentSnapshot().sanitizedContext).toBe("Analyze this");
      expect(buffer.getState().context).toBe("Analyze this");
    });

    it("uses Ghostty Accessibility text as separate OpenCode App Context", async () => {
      const appContext = createAppContextExtractor();
      let requestedSnapshot: RequestableTypingContextSnapshot | null = null;
      const { session } = makeSession({
        getAppContext: (snapshot) => appContext.getSnapshot(snapshot),
        getLocalSuggestion: async (snapshot) => {
          requestedSnapshot = snapshot;
          return null;
        },
      });

      session.setActiveApplication("com.mitchellh.ghostty", "window:1");
      session.appendText("Explain this");
      session.applyTextSessionSnapshot({
        activeApplication: { bundleId: "com.mitchellh.ghostty", windowId: "window:1" },
        focusedElementId: "ghostty:text-area",
        textElementId: "ghostty:text-area",
        selectedRange: { location: 0, length: 0 },
        caretIdentity: "range:0:0",
        secureLike: false,
        accessibilityReliability: "reliable",
        terminalTitle: "OC | Fix terminal context",
        terminalContents: "┃ Fix terminal context\n\n  The previous implementation dropped this context.\n▣ Build · model · 2s\n╹",
      });
      await wait(10);

      expect(requestedSnapshot?.sanitizedContext).toBe("Explain this");
      expect(requestedSnapshot?.textSession).toBeUndefined();
      expect(requestedSnapshot?.appContext?.metadata.provider).toBe("ghostty-terminal");
      expect(requestedSnapshot?.appContext?.fragments[0]).toMatchObject({
        kind: "terminal_visible_context",
        memoryEligible: false,
        metadata: { terminalApplication: "opencode" },
      });
    });

    it("waits briefly for pending OpenCode context before local inference", async () => {
      let contextState: AppContextSnapshotState = {
        snapshot: { fragments: [], metadata: { provider: "opencode-local-session", status: "empty" } },
        pending: true,
        revision: 1,
      };
      const localSnapshots: RequestableTypingContextSnapshot[] = [];
      const { session, publishAppContextChange } = makeSession({
        appContextGraceMs: 30,
        getAppContextState: () => contextState,
        getLocalSuggestion: async (snapshot) => {
          localSnapshots.push(snapshot);
          return null;
        },
      });

      session.setActiveApplication("com.mitchellh.ghostty", "window:1");
      session.appendText("Explain this");
      await wait(10);
      expect(localSnapshots).toHaveLength(0);

      contextState = {
        snapshot: {
          fragments: [{
            id: "opencode-conversation",
            provider: "opencode-local-session",
            kind: "conversation",
            text: "User: Explain the current implementation.",
            confidence: 0.95,
            redaction: { applied: false, redactionCount: 0, kinds: [] },
            requestable: true,
            memoryEligible: false,
          }],
          metadata: { provider: "opencode-local-session", status: "available", confidence: 0.95 },
        },
        pending: false,
        revision: 2,
      };
      publishAppContextChange();
      await wait(10);

      expect(localSnapshots).toHaveLength(1);
      expect(localSnapshots[0]?.appContext?.fragments[0]?.text).toContain("current implementation");
    });

    it("aborts fallback local inference when OpenCode context arrives late", async () => {
      let contextState: AppContextSnapshotState = {
        snapshot: { fragments: [], metadata: { provider: "opencode-local-session", status: "empty" } },
        pending: true,
        revision: 1,
      };
      const signals: AbortSignal[] = [];
      const hashes: string[] = [];
      let markFallbackStarted: () => void = () => {};
      let markContextRetryStarted: () => void = () => {};
      const fallbackStarted = new Promise<void>((resolve) => {
        markFallbackStarted = resolve;
      });
      const contextRetryStarted = new Promise<void>((resolve) => {
        markContextRetryStarted = resolve;
      });
      const { session, publishAppContextChange } = makeSession({
        appContextGraceMs: 2,
        getAppContextState: () => contextState,
        getLocalSuggestion: (snapshot, options) => {
          hashes.push(snapshot.contextHash);
          if (options?.signal) signals.push(options.signal);
          if (signals.length > 1) {
            markContextRetryStarted();
            return null;
          }
          markFallbackStarted();
          return new Promise((resolve) => options?.signal?.addEventListener("abort", () => resolve(null), { once: true }));
        },
      });

      session.setActiveApplication("com.mitchellh.ghostty", "window:1");
      session.appendText("Explain this");
      await fallbackStarted;
      expect(signals).toHaveLength(1);

      contextState = {
        snapshot: {
          fragments: [{
            id: "opencode-conversation",
            provider: "opencode-local-session",
            kind: "conversation",
            text: "Assistant: Context resolved after fallback inference began.",
            confidence: 0.95,
            redaction: { applied: false, redactionCount: 0, kinds: [] },
            requestable: true,
            memoryEligible: false,
          }],
          metadata: { provider: "opencode-local-session", status: "available", confidence: 0.95 },
        },
        pending: false,
        revision: 2,
      };
      publishAppContextChange();
      await contextRetryStarted;

      expect(signals[0]?.aborted).toBe(true);
      expect(hashes).toHaveLength(2);
      expect(hashes[1]).not.toBe(hashes[0]);
    });

    it("clears a visible suggestion when only OpenCode App Context changes", async () => {
      let contextState: AppContextSnapshotState = {
        snapshot: {
          fragments: [{
            id: "opencode-conversation",
            provider: "opencode-local-session",
            kind: "conversation",
            text: "Assistant: Original conversation context.",
            confidence: 0.95,
            redaction: { applied: false, redactionCount: 0, kinds: [] },
            requestable: true,
            memoryEligible: false,
          }],
          metadata: { provider: "opencode-local-session", status: "available", confidence: 0.95 },
        },
        pending: false,
        revision: 1,
      };
      const { calls, session, publishAppContextChange } = makeSession({
        getAppContextState: () => contextState,
        getLocalSuggestion: async () => ({ id: "sg-local-original", text: " next" }),
      });
      session.setActiveApplication("com.mitchellh.ghostty", "window:1");
      session.appendText("Explain this");
      await wait(10);
      expect(session.getCurrentSuggestion()).not.toBeNull();

      contextState = {
        snapshot: { fragments: [], metadata: { provider: "opencode-local-session", status: "empty" } },
        pending: true,
        revision: 2,
      };
      publishAppContextChange();

      expect(session.getCurrentSuggestion()).toBeNull();
      expect(calls.map((call) => call.type)).toContain("clearSuggestion");
    });

    it("retries an explicit request when OpenCode App Context changes in flight", async () => {
      let contextState: AppContextSnapshotState = {
        snapshot: { fragments: [], metadata: { provider: "opencode-local-session", status: "empty" } },
        pending: true,
        revision: 1,
      };
      const snapshots: RequestableTypingContextSnapshot[] = [];
      const signals: AbortSignal[] = [];
      const { session, publishAppContextChange } = makeSession({
        getAppContextState: () => contextState,
        requestSuggestion: (snapshot, options) => {
          snapshots.push(snapshot);
          if (options?.signal) signals.push(options.signal);
          if (snapshots.length > 1) return { id: "cloud-context-rich", text: " next" };
          return new Promise((resolve) => options?.signal?.addEventListener("abort", () => resolve(null), { once: true }));
        },
      });
      session.setActiveApplication("com.mitchellh.ghostty", "window:1");
      session.appendText("Explain this");
      session.applyTextSessionSnapshot({
        activeApplication: { bundleId: "com.mitchellh.ghostty", windowId: "window:1" },
        focusedElementId: "focus:1",
        textElementId: "text:1",
        selectedRange: { location: 12, length: 0 },
        selectedText: "",
        caretIdentity: "range:12:0",
        secureLike: false,
        accessibilityReliability: "reliable",
        surroundingContext: { beforeCaret: "Explain this", afterCaret: "" },
      });
      const request = session.requestSuggestionNow();
      await wait(1);

      contextState = {
        snapshot: {
          fragments: [{
            id: "opencode-conversation",
            provider: "opencode-local-session",
            kind: "conversation",
            text: "Assistant: Retry explicit work with current context.",
            confidence: 0.95,
            redaction: { applied: false, redactionCount: 0, kinds: [] },
            requestable: true,
            memoryEligible: false,
          }],
          metadata: { provider: "opencode-local-session", status: "available", confidence: 0.95 },
        },
        pending: false,
        revision: 2,
      };
      publishAppContextChange();
      await request;

      expect(signals[0]?.aborted).toBe(true);
      expect(snapshots).toHaveLength(2);
      expect(snapshots[1]?.appContext?.fragments[0]?.text).toContain("Retry explicit work");
      expect(session.getCurrentSuggestion()).toEqual({ id: "cloud-context-rich", text: " next" });
    });

    it("does not let raw dead-key fallback text overwrite a reliable Text Session snapshot", async () => {
      const { buffer, calls, session } = makeSession();
      const composedContext = "ok! ahora una tilde por aqu\u00ed. una tilde por all\u00e1";
      const textSession: TextSessionSnapshot = {
        activeApplication: { bundleId: "com.google.Chrome", windowId: "window:1" },
        focusedElementId: "focus:1",
        textElementId: "text:1",
        selectedRange: { location: composedContext.length, length: 0 },
        caretIdentity: `caret:${composedContext.length}`,
        secureLike: false,
        accessibilityReliability: "reliable",
        surroundingContext: { beforeCaret: composedContext, afterCaret: "" },
      };

      session.applyTextSessionSnapshot(textSession);
      session.appendText("i2s");
      await wait(10);

      expect(session.getCurrentSnapshot().sanitizedContext).toBe(composedContext);
      expect(buffer.getState().context).toBe("");
      expect(calls).toContainEqual({ type: "requestSuggestion", value: composedContext });
      expect(calls).not.toContainEqual({ type: "requestSuggestion", value: "i2s" });
    });

    it("does not request a stale Text Session snapshot when fallback text arrives first", async () => {
      const { calls, session } = makeSession();
      const textSession = (beforeCaret: string): TextSessionSnapshot => ({
        activeApplication: { bundleId: "com.apple.TextEdit", windowId: "window:1" },
        focusedElementId: "focus:1",
        textElementId: "text:1",
        selectedRange: { location: beforeCaret.length, length: 0 },
        caretIdentity: `range:${beforeCaret.length}:0`,
        secureLike: false,
        accessibilityReliability: "reliable",
        supportsSemanticInsertion: true,
        surroundingContext: { beforeCaret, afterCaret: "" },
      });

      session.applyTextSessionSnapshot(textSession("Alpha"));
      await wait(10);
      calls.length = 0;

      session.appendText("!");
      await wait(10);

      expect(calls.filter((call) => call.type === "requestSuggestion")).toHaveLength(0);
      expect(session.getCurrentSnapshot().sanitizedContext).toBe("Alpha");

      session.applyTextSessionSnapshot(textSession("Alpha!"));
      await wait(10);

      expect(calls).toContainEqual({ type: "requestSuggestion", value: "Alpha!" });
    });

    it("keeps a visible Text Session suggestion mounted until the next snapshot replaces it", async () => {
      const { calls, session } = makeSession();
      const textSession = (beforeCaret: string): TextSessionSnapshot => ({
        activeApplication: { bundleId: "com.apple.TextEdit", windowId: "window:1" },
        focusedElementId: "focus:1",
        textElementId: "text:1",
        selectedRange: { location: beforeCaret.length, length: 0 },
        caretIdentity: `range:${beforeCaret.length}:0`,
        secureLike: false,
        accessibilityReliability: "reliable",
        supportsSemanticInsertion: true,
        surroundingContext: { beforeCaret, afterCaret: "" },
      });

      session.applyTextSessionSnapshot(textSession("Alpha"));
      await wait(10);

      expect(session.getCurrentSuggestion()).toEqual({ id: "s-1", text: " world" });
      calls.length = 0;

      session.appendText("!");
      await wait(10);

      expect(calls.filter((call) => call.type === "requestSuggestion")).toHaveLength(0);
      expect(calls).toContainEqual({ type: "setSuggestionRefreshing", value: true });
      expect(calls.map((call) => call.type)).not.toContain("clearSuggestion");
      expect(calls.map((call) => call.type)).not.toContain("hideOverlay");
      expect(session.getCurrentSuggestion()).toEqual({ id: "s-1", text: " world" });
      expect(session.getLoopState().status).toBe("idle");
      expect(session.getCurrentSnapshot().sanitizedContext).toBe("Alpha");

      session.applyTextSessionSnapshot(textSession("Alpha!"));
      await wait(10);

      expect(calls).toContainEqual({ type: "showSuggestion", value: { id: "s-1", text: " world" } });
      expect(calls).toContainEqual({ type: "setSuggestionRefreshing", value: false });
    });

    it("does not clear or request again when only Text Session caret bounds change", async () => {
      const { calls, session } = makeSession();
      const textSession = (x: number): TextSessionSnapshot => ({
        activeApplication: { bundleId: "com.apple.TextEdit", windowId: "window:1" },
        focusedElementId: "focus:1",
        textElementId: "text:1",
        selectedRange: { location: 5, length: 0 },
        caretIdentity: "range:5:0",
        secureLike: false,
        accessibilityReliability: "reliable",
        supportsSemanticInsertion: true,
        surroundingContext: { beforeCaret: "Alpha", afterCaret: "" },
        caretBounds: { x, y: 20, width: 1, height: 18 },
      });

      session.applyTextSessionSnapshot(textSession(10));
      await wait(10);
      calls.length = 0;

      session.applyTextSessionSnapshot(textSession(11));
      await wait(10);

      expect(calls).toHaveLength(0);
      expect(session.getCurrentSuggestion()).toEqual({ id: "s-1", text: " world" });
    });

    it("clears fallback context and disables memory work for secure Text Session snapshots", async () => {
      const { buffer, calls, session } = makeSession();
      const secureTextSession: TextSessionSnapshot = {
        activeApplication: { bundleId: "com.apple.TextEdit", windowId: "window:1" },
        focusedElementId: "focus:password",
        textElementId: "text:password",
        selectedRange: { location: 18, length: 0 },
        caretIdentity: "caret:18",
        secureLike: true,
        accessibilityReliability: "reliable",
        surroundingContext: { beforeCaret: "password123secret", afterCaret: "" },
      };

      session.setActiveApplication("com.apple.TextEdit", "window:1");
      session.appendText("ordinary prose");
      await wait(10);

      expect(session.getCurrentSuggestion()).toEqual({ id: "s-1", text: " world" });

      const requestsBeforeSecureSnapshot = calls.filter((call) => call.type === "requestSuggestion").length;
      session.applyTextSessionSnapshot(secureTextSession);
      await wait(10);

      const safeSecureSnapshot = createSafeTextSessionSnapshot(secureTextSession);
      expect(buffer.getState().context).toBe("");
      expect(safeSecureSnapshot.requestable).toBe(false);
      expect(safeSecureSnapshot.suppressionReason).toBe("secure_input");
      expect(safeSecureSnapshot.memoryEligible).toBe(false);
      expect(calls.filter((call) => call.type === "requestSuggestion")).toHaveLength(requestsBeforeSecureSnapshot);
      expect(calls.map((call) => call.type)).toContain("hideOverlay");
      expect(session.getCurrentSuggestion()).toBeNull();
    });

    it("records metadata-only accepted, dismissed, and stale interaction telemetry", async () => {
      const telemetry: RecordTelemetryEventRequest[] = [];
      const rawTypingContext = "Hello private typing context";
      const rawSuggestionText = " secret suggestion text";

      const createSession = (maxVisibleMs = 1_000) => makeSession({
        maxVisibleMs,
        getLocalSuggestion: async () => ({ id: "sg-req-1", text: rawSuggestionText }),
        recordInteractionTelemetry: async (event) => {
          telemetry.push(event);
        },
      });

      const accepted = createSession();
      accepted.session.setActiveApplication("com.apple.TextEdit", "window:1");
      accepted.session.appendText(rawTypingContext);
      await wait(10);
      await accepted.session.acceptCurrentSuggestion();

      const dismissed = createSession();
      dismissed.session.setActiveApplication("com.apple.Mail", "window:1");
      dismissed.session.appendText(rawTypingContext);
      await wait(10);
      dismissed.session.appendText("!");

      const stale = createSession(5);
      stale.session.setActiveApplication("com.apple.Notes", "window:1");
      stale.session.appendText(rawTypingContext);
      await wait(20);

      const interactions = telemetry.filter((event) =>
        ["suggestion_accepted", "suggestion_dismissed", "suggestion_stale"].includes(event.eventType)
      );
      expect(interactions.map((event) => event.eventType)).toEqual([
        "suggestion_accepted",
        "suggestion_dismissed",
        "suggestion_stale",
      ]);
      expect(interactions[0]).toMatchObject({
        requestId: "req-1",
        inferenceSource: "local",
        trigger: "automatic",
        applicationCategory: "productivity",
        acceptedWordCount: 3,
        acceptedCharacterCount: rawSuggestionText.length,
        suggestionLength: rawSuggestionText.length,
      });
      expect(telemetry.every((event) => typeof event.timestamp === "string")).toBe(true);
      expect(telemetry.every((event) => typeof event.latencyMs === "number")).toBe(true);
      expect(telemetry.every((event) => (event.latencyMs ?? -1) >= 0)).toBe(true);

      const json = JSON.stringify(telemetry);
      expect(json).not.toContain(rawTypingContext);
      expect(json).not.toContain(rawSuggestionText);
      expect(json).not.toContain("rawTypingContext");
      expect(json).not.toContain("suggestionText");
      expect(json).not.toContain("acceptedText");
      expect(json).not.toContain("finalInsertedText");
      expect(json).not.toContain("surroundingText");
    });

    it("marks accepted local suggestions with their model without sending text", async () => {
      const telemetry: RecordTelemetryEventRequest[] = [];
      const usage: Array<{ wordCount: number; characterCount: number }> = [];
      const { session } = makeSession({
        getLocalSuggestion: async () => ({ id: "sg-local-request-1", text: " hello, world!" }),
        localSuggestionModelId: "local-model-1",
        recordInteractionTelemetry: (event) => telemetry.push(event),
        recordAcceptedUsage: (event) => usage.push(event),
      });

      session.setActiveApplication("com.apple.TextEdit", "window:1");
      session.appendText("private context");
      await wait(10);
      await session.acceptCurrentSuggestion();

      expect(telemetry.map((event) => event.eventType)).toEqual([
        "suggestion_generated",
        "suggestion_shown",
        "suggestion_accepted",
      ]);
      expect(
        telemetry.find((event) => event.eventType === "suggestion_accepted"),
      ).toMatchObject({
        eventType: "suggestion_accepted",
        requestId: "local-request-1",
        modelId: "local-model-1",
        inferenceSource: "local",
        trigger: "automatic",
        acceptedWordCount: 2,
      });
      expect(usage).toEqual([
        expect.objectContaining({ wordCount: 2, characterCount: 14 }),
      ]);
      expect(JSON.stringify(telemetry)).not.toContain("hello, world");
      expect(JSON.stringify(telemetry)).not.toContain("private context");
    });

    it("publishes local suggestions to history only after successful Acceptance", async () => {
      const acceptedSuggestionIds: string[] = [];
      const { session } = makeSession({
        getLocalSuggestion: async () => ({ id: "sg-local-history", text: " accepted words" }),
        onLocalSuggestionAccepted: (suggestionId) => acceptedSuggestionIds.push(suggestionId),
      });

      session.setActiveApplication("com.apple.TextEdit", "window:1");
      session.appendText("private context");
      await wait(10);

      expect(acceptedSuggestionIds).toEqual([]);

      await session.acceptCurrentSuggestion();

      expect(acceptedSuggestionIds).toEqual(["sg-local-history"]);
    });

    it("does not insert or count a later local Acceptance after its allowance is exhausted", async () => {
      const usage: unknown[] = [];
      let allowanceExhausted = false;
      const { calls, session } = makeSession({
        getLocalSuggestion: async () => ({
          id: "sg-local-blocked",
          text: " blocked words",
        }),
        canAcceptLocalSuggestion: () => false,
        onLocalAllowanceExhausted: () => {
          allowanceExhausted = true;
        },
        recordAcceptedUsage: (event) => usage.push(event),
      });
      session.setActiveApplication("com.apple.TextEdit", "window:1");
      session.appendText("Private context");
      await wait(10);
      await session.acceptCurrentSuggestion();

      expect(calls.some((call) => call.type === "setClipboard")).toBe(false);
      expect(calls.some((call) => call.type === "hideOverlay")).toBe(true);
      expect(allowanceExhausted).toBe(true);
      expect(usage).toEqual([]);
    });

    it("does not count local words when insertion fails", async () => {
      const usage: unknown[] = [];
      const { session } = makeSession({
        getLocalSuggestion: async () => ({
          id: "sg-local-failed",
          text: " failed words",
        }),
        sendPaste: async () => {
          throw new Error("paste failed");
        },
        recordAcceptedUsage: (event) => usage.push(event),
      });
      session.setActiveApplication("com.apple.TextEdit", "window:1");
      session.appendText("Private context");
      await wait(10);
      await expect(session.acceptCurrentSuggestion()).rejects.toThrow(
        "paste failed",
      );
      expect(usage).toEqual([]);
    });

    it("continues suggesting after repeated dismissals", async () => {
      const triggerPolicy = createPoliteTriggerPolicy();
      const { calls, session } = makeSession({ triggerPolicy });

      session.setActiveApplication("com.apple.TextEdit", "window:1");
      session.appendText("Hello ");
      await wait(10);
      expect(calls.filter((call) => call.type === "requestSuggestion")).toHaveLength(1);

      session.appendText("again ");
      await wait(10);
      expect(calls.filter((call) => call.type === "requestSuggestion")).toHaveLength(2);

      session.appendText("friend ");
      await wait(10);
      expect(calls.filter((call) => call.type === "requestSuggestion")).toHaveLength(3);
    });

    it("tracks metadata-only compatibility per Active Application for safer insertion", async () => {
      const compatibilityStore = createApplicationCompatibilityStore({
        preferClipboardSemanticFailureThreshold: 1,
      });
      const { calls, session } = makeSession({
        compatibilityStore,
        insertSemantically: async () => false,
      });
      const textSession = (bundleId: string, beforeCaret: string): TextSessionSnapshot => ({
        activeApplication: { bundleId, windowId: "window:1" },
        focusedElementId: `focus:${bundleId}`,
        textElementId: `text:${bundleId}`,
        selectedRange: { location: beforeCaret.length, length: 0 },
        caretIdentity: `caret:${beforeCaret.length}`,
        secureLike: false,
        accessibilityReliability: "reliable",
        supportsSemanticInsertion: true,
        surroundingContext: { beforeCaret, afterCaret: "" },
      });

      session.applyTextSessionSnapshot(textSession("com.example.Unreliable", "Hello "));
      await wait(10);
      await session.acceptCurrentSuggestion();

      expect(calls.map((call) => call.type)).toContain("insertSemantically");
      expect(calls.map((call) => call.type)).toContain("setClipboard");

      session.applyTextSessionSnapshot(textSession("com.example.Unreliable", "Hello again "));
      await wait(10);
      session.applyTextSessionSnapshot(textSession("com.example.Unreliable", "Hello again friend"));
      await wait(10);

      const unreliableRequests = calls.filter(
        (call) => call.type === "requestSuggestion" && call.value === "Hello again friend",
      );
      expect(unreliableRequests).toHaveLength(1);

      const callTypesBeforeSecondAcceptance = calls.map((call) => call.type);
      session.applyTextSessionSnapshot(textSession("com.example.Unreliable", "Hello again friend "));
      await wait(10);
      await session.acceptCurrentSuggestion();
      const secondAcceptanceCallTypes = calls.map((call) => call.type).slice(callTypesBeforeSecondAcceptance.length);

      expect(secondAcceptanceCallTypes).not.toContain("insertSemantically");
      expect(secondAcceptanceCallTypes).toContain("setClipboard");

      const reliableCallsBefore = calls.filter((call) => call.type === "requestSuggestion").length;
      session.applyTextSessionSnapshot(textSession("com.example.Reliable", "Hello friend"));
      await wait(10);

      expect(calls.filter((call) => call.type === "requestSuggestion").length).toBe(reliableCallsBefore + 1);

      const unreliableProfile = compatibilityStore.getProfile({ bundleId: "com.example.Unreliable" });
      expect(unreliableProfile).toMatchObject({
        dismissalCount: 2,
        acceptanceCount: 2,
        textSessionReliableCount: 4,
        semanticInsertionFailureCount: 1,
        clipboardInsertionSuccessCount: 2,
      });

      const compatibilityJson = JSON.stringify(unreliableProfile);
      expect(compatibilityJson).not.toContain("Hello");
      expect(compatibilityJson).not.toContain("world");
      expect(compatibilityJson).not.toContain("rawTypingContext");
      expect(compatibilityJson).not.toContain("suggestionText");
      expect(compatibilityJson).not.toContain("finalInsertedText");
    });
  });

  describe("local privacy suppression and redaction", () => {
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    function makePrivacyDeps(overrides: {
      getContext?: () => SafeTypingContextSnapshot;
      getLocalSuggestion?: (snapshot: RequestableTypingContextSnapshot) => Promise<Suggestion | null>;
    } = {}) {
      const events: Array<{ type: string; payload?: unknown }> = [];
      const requestSuggestionCalls: string[] = [];
      return {
        events,
        requestSuggestionCalls,
        deps: {
          getContext:
            overrides.getContext ??
            (() => makeSnapshot()),
          getLocalSuggestion: async (snapshot: RequestableTypingContextSnapshot) => {
            requestSuggestionCalls.push(snapshot.sanitizedContext);
            return overrides.getLocalSuggestion?.(snapshot) ?? { id: "s-1", text: " world" };
          },
          onShowSuggestion: (suggestion: Suggestion) => events.push({ type: "show", payload: suggestion }),
          onHideSuggestion: () => events.push({ type: "hide" }),
          onSecretLikeContextDetected: () => events.push({ type: "secretDetected" }),
          debounceMs: 5,
        },
      };
    }

    describe("typing context source and memory eligibility", () => {
      it("treats typed text as memory eligible", () => {
        const buffer = createTypingContextBuffer();
        buffer.appendText("hello");
        expect(buffer.getState().contextSource).toBe("typed_text");
        expect(buffer.getState().memoryEligible).toBe(true);
        expect(getMemoryEligibility("typed_text").eligible).toBe(true);
      });

      it("treats terminal input as memory eligible", () => {
        const buffer = createTypingContextBuffer();
        buffer.appendText("npm install", "terminal_input");
        expect(buffer.getState().contextSource).toBe("terminal_input");
        expect(buffer.getState().memoryEligible).toBe(true);
        expect(getMemoryEligibility("terminal_input").eligible).toBe(true);
      });

      it("treats pasted text as not memory eligible", () => {
        const buffer = createTypingContextBuffer();
        buffer.appendPastedText("some pasted text");
        expect(buffer.getState().contextSource).toBe("pasted_text");
        expect(buffer.getState().memoryEligible).toBe(false);
        expect(getMemoryEligibility("pasted_text").eligible).toBe(false);
      });

      it("does not capture terminal output as typing context", () => {
        // Terminal output is never fed into the buffer by the native input bridge.
        // The public buffer API only accepts typed_text, pasted_text, or terminal_input.
        const buffer = createTypingContextBuffer();
        buffer.setActiveApplication({ bundleId: "com.apple.Terminal" });
        expect(buffer.getState().context).toBe("");
        expect(buffer.getState().contextSource).toBe("typed_text");
      });
    });

    describe("local redaction", () => {
      it("redacts pasted text before adding to the buffer", () => {
        const buffer = createTypingContextBuffer();
        buffer.appendPastedText("api_key=sk-abc1234567890 hello");
        expect(buffer.getState().context).toContain("[REDACTED_SECRET]");
        expect(buffer.getState().context).not.toContain("sk-abc1234567890");
      });

      it("redacts api keys in typed context and suppresses the request", async () => {
        const { events, requestSuggestionCalls, deps } = makePrivacyDeps();
        const context = "api_key=sk-abc1234567890";
        deps.getContext = () => makeSnapshot({ context });
        const loop = createAutomaticSuggestion(deps);
        loop.onContextChanged();
        await wait(10);
        expect(requestSuggestionCalls).toHaveLength(0);
        expect(events.some((e) => e.type === "secretDetected")).toBe(true);
      });

      it("redacts and suppresses secret-like App Context fragments before requests", async () => {
        const manager = createAppContextManager();
        manager.setCandidate({
          fragments: [
            {
              id: "fragment-1",
              provider: "synthetic-provider",
              kind: "visible_text",
              text: "api_key=sk-abc1234567890",
              confidence: 0.9,
            },
          ],
          metadata: { provider: "synthetic-provider", status: "available", confidence: 0.9 },
        });

        const snapshot = manager.getSnapshot();

        expect(snapshot.fragments).toHaveLength(0);
        expect(snapshot.metadata.status).toBe("suppressed");
        expect(snapshot.metadata.suppressionReason).toBe("secret_like_context");
      });

      it("redacts bearer tokens in typed context and suppresses the request", async () => {
        const { events, requestSuggestionCalls, deps } = makePrivacyDeps();
        const context = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
        deps.getContext = () => makeSnapshot({ context });
        const loop = createAutomaticSuggestion(deps);
        loop.onContextChanged();
        await wait(10);
        expect(requestSuggestionCalls).toHaveLength(0);
        expect(events.some((e) => e.type === "secretDetected")).toBe(true);
      });

      it("redacts private key blocks in typed context and suppresses the request", async () => {
        const { events, requestSuggestionCalls, deps } = makePrivacyDeps();
        const context = "-----BEGIN OPENSSH PRIVATE KEY-----\nabc123\n-----END OPENSSH PRIVATE KEY-----";
        deps.getContext = () => makeSnapshot({ context });
        const loop = createAutomaticSuggestion(deps);
        loop.onContextChanged();
        await wait(10);
        expect(requestSuggestionCalls).toHaveLength(0);
        expect(events.some((e) => e.type === "secretDetected")).toBe(true);
      });

      it("redacts database URLs in typed context and suppresses the request", async () => {
        const { events, requestSuggestionCalls, deps } = makePrivacyDeps();
        const context = "DATABASE_URL=postgres://user:pass@localhost:5432/db";
        deps.getContext = () => makeSnapshot({ context });
        const loop = createAutomaticSuggestion(deps);
        loop.onContextChanged();
        await wait(10);
        expect(requestSuggestionCalls).toHaveLength(0);
        expect(events.some((e) => e.type === "secretDetected")).toBe(true);
      });

      it("allows normal typed prose to request suggestions", async () => {
        const { requestSuggestionCalls, deps } = makePrivacyDeps();
        const context = "hello world";
        deps.getContext = () => makeSnapshot({ context });
        const loop = createAutomaticSuggestion(deps);
        loop.onContextChanged();
        await wait(10);
        expect(requestSuggestionCalls).toHaveLength(1);
        expect(requestSuggestionCalls[0]).toBe("hello world");
      });

      it("clears the typing context buffer when secret-like context is detected", async () => {
        const buffer = createTypingContextBuffer();
        const { events, requestSuggestionCalls, deps } = makePrivacyDeps();
        deps.getContext = () => buffer.getSnapshot();
        deps.onSecretLikeContextDetected = () => {
          buffer.clear();
          events.push({ type: "secretDetected" });
        };
        buffer.setActiveApplication({ bundleId: "com.apple.TextEdit" });
        buffer.appendText("api_key=sk-abc1234567890");
        const loop = createAutomaticSuggestion(deps);
        loop.onContextChanged();
        await wait(10);
        expect(requestSuggestionCalls).toHaveLength(0);
        expect(buffer.getState().context).toBe("");
        expect(events.some((e) => e.type === "secretDetected")).toBe(true);
      });
    });

    describe("password manager suppression", () => {
      it("clears context when active application is a known password manager", () => {
        const buffer = createTypingContextBuffer();
        buffer.setActiveApplication({ bundleId: "com.apple.TextEdit" });
        buffer.appendText("hello");
        buffer.setActiveApplication({ bundleId: "com.1password.1password" });
        expect(buffer.getState().context).toBe("");
        buffer.appendText("secret");
        expect(buffer.getState().context).toBe("");
      });

      it("suppresses suggestion requests in password manager contexts", async () => {
        const { events, requestSuggestionCalls, deps } = makePrivacyDeps();
        deps.getContext = () => makeSnapshot({
          activeApplication: { bundleId: "com.1password.1password" },
          privateContext: true,
        });
        const loop = createAutomaticSuggestion(deps);
        loop.onContextChanged();
        await wait(10);
        expect(requestSuggestionCalls).toHaveLength(0);
        expect(events.some((e) => e.type === "hide")).toBe(false);
      });
    });

    describe("global pause control", () => {
      it("clears context and disables observation when paused", () => {
        const buffer = createTypingContextBuffer();
        buffer.appendText("hello");
        buffer.setPaused(true);
        expect(buffer.getState().context).toBe("");
        expect(buffer.getState().paused).toBe(true);
        buffer.appendText("world");
        expect(buffer.getState().context).toBe("");
      });

      it("suppresses suggestion requests while paused", async () => {
        const { requestSuggestionCalls, deps } = makePrivacyDeps();
        deps.getContext = () => makeSnapshot({ paused: true });
        const loop = createAutomaticSuggestion(deps);
        loop.onContextChanged();
        await wait(10);
        expect(requestSuggestionCalls).toHaveLength(0);
      });
    });
  });

  describe("Obsidian App Context provider", () => {
    function makeObsidianTextSession(overrides: Partial<TextSessionSnapshot> = {}): TextSessionSnapshot {
      return {
        activeApplication: { bundleId: "md.obsidian", windowId: "vault-window" },
        focusedElementId: "focus-editor",
        textElementId: "markdown-editor",
        selectedRange: { location: 72, length: 0 },
        caretIdentity: "range:72:0",
        secureLike: false,
        accessibilityReliability: "reliable",
        surroundingContext: {
          beforeCaret: "# Launch Notes\n\n- Confirm beta scope\n- Draft rollout email\n\nNext we should",
          afterCaret: " include support timings and owner handoffs.\n\n## Open Questions\n- Who signs off?",
        },
        ...overrides,
      };
    }

    function obsidianSnapshot(textSession: TextSessionSnapshot): AppContextSnapshot {
      return normalizeAppContext(createObsidianDocumentAppContextCandidate(textSession));
    }

    it("extracts nearby Obsidian markdown context from the focused editor", () => {
      const candidate = createObsidianDocumentAppContextCandidate(makeObsidianTextSession());
      expect(candidate.fragments[0]).not.toHaveProperty("redaction");
      expect(candidate.fragments[0]).not.toHaveProperty("requestable");
      expect(candidate.fragments[0]).not.toHaveProperty("memoryEligible");

      const snapshot = normalizeAppContext(candidate);

      expect(snapshot.metadata).toMatchObject({
        provider: "obsidian-accessibility-editor",
        status: "available",
      });
      expect(snapshot.fragments).toHaveLength(1);
      expect(snapshot.fragments[0]).toMatchObject({
        provider: "obsidian-accessibility-editor",
        kind: "markdown_document",
        requestable: true,
        memoryEligible: false,
      });
      expect(snapshot.fragments[0].text).toContain("# Launch Notes");
      expect(snapshot.fragments[0].text).toContain("- Draft rollout email");
      expect(snapshot.fragments[0].text).toContain("Next we should include support timings");
    });

    it("bounds long notes to nearby editor context", () => {
      const beforeCaret = `${"old paragraph\n".repeat(260)}# Current Heading\nRelevant paragraph before caret`;
      const afterCaret = ` continues after caret\n${"later paragraph\n".repeat(260)}`;
      const snapshot = obsidianSnapshot(
        makeObsidianTextSession({ surroundingContext: { beforeCaret, afterCaret } }),
      );

      expect(snapshot.metadata.status).toBe("available");
      expect(snapshot.fragments[0].text.length).toBeLessThanOrEqual(1_600);
      expect(snapshot.fragments[0].text).toContain("# Current Heading");
      expect(snapshot.fragments[0].text).toContain("Relevant paragraph before caret continues after caret");
      expect(snapshot.fragments[0].text).not.toContain("old paragraph\nold paragraph\nold paragraph");
      expect(snapshot.fragments[0].text).not.toContain("later paragraph\nlater paragraph\nlater paragraph");
    });

    it("falls back safely when focused editor semantics are missing", () => {
      const snapshot = obsidianSnapshot(
        makeObsidianTextSession({ focusedElementId: null, textElementId: null }),
      );

      expect(snapshot.fragments).toHaveLength(0);
      expect(snapshot.metadata).toMatchObject({
        provider: "obsidian-accessibility-editor",
        status: "empty",
        suppressionReason: "missing_focused_editor_semantics",
      });
    });

    it("falls back safely when Obsidian editor Accessibility semantics are unreliable", () => {
      const snapshot = obsidianSnapshot(
        makeObsidianTextSession({ accessibilityReliability: "unreliable" }),
      );

      expect(snapshot.fragments).toHaveLength(0);
      expect(snapshot.metadata).toMatchObject({
        provider: "obsidian-accessibility-editor",
        status: "empty",
        suppressionReason: "missing_focused_editor_semantics",
      });
    });

    it("drops noisy extraction instead of sending unreliable context", () => {
      const snapshot = obsidianSnapshot(
        makeObsidianTextSession({
          surroundingContext: {
            beforeCaret: "\u0000\u0000\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd",
            afterCaret: "\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd",
          },
        }),
      );

      expect(snapshot.fragments).toHaveLength(0);
      expect(snapshot.metadata.status).toBe("empty");
      expect(snapshot.metadata.suppressionReason).toBe("noisy_extraction");
    });

    it("does not activate outside Obsidian", () => {
      const snapshot = obsidianSnapshot(
        makeObsidianTextSession({ activeApplication: { bundleId: "com.apple.TextEdit" } }),
      );

      expect(snapshot.fragments).toHaveLength(0);
      expect(snapshot.metadata.status).toBe("unsupported");
    });
  });
});
