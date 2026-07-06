import { describe, it, expect } from "bun:test";
import { createTypingContextBuffer } from "../apps/desktop/src/typing-context.ts";
import { generateFakeSuggestion } from "../apps/desktop/src/suggestion-engine.ts";
import { createSuggestionLoop } from "../apps/desktop/src/suggestion-loop.ts";
import { acceptAndInsertSuggestion } from "../apps/desktop/src/acceptance.ts";
import type { Suggestion, ActiveApplication } from "@tabb/contracts";

describe("desktop native suggestion loop", () => {
  describe("typing context buffer", () => {
    it("accumulates user-authored text input", () => {
      const buffer = createTypingContextBuffer();
      buffer.appendText("Hello");
      buffer.appendText(" ");
      buffer.appendText("world");
      expect(buffer.getState().context).toBe("Hello world");
    });

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

    it("rolls off old context beyond max length", () => {
      const buffer = createTypingContextBuffer(10);
      buffer.appendText("0123456789");
      buffer.appendText("X");
      expect(buffer.getState().context).toBe("123456789X");
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

  describe("suggestion loop", () => {
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    function makeDeps(overrides: {
      requestSuggestion?: (context: string) => Promise<Suggestion | null>;
      getContext?: () => { context: string; activeApplication: ActiveApplication | null; secureInput: boolean };
    } = {}) {
      const events: Array<{ type: string; payload?: unknown }> = [];
      const getContext = overrides.getContext ?? (() => ({ context: "hello", activeApplication: { bundleId: "com.apple.TextEdit" }, secureInput: false }));
      return {
        events,
        getContext,
        deps: {
          getContext,
          requestSuggestion: overrides.requestSuggestion ?? (async () => ({ id: "s-1", text: " world" })),
          onShowSuggestion: (suggestion: Suggestion) => events.push({ type: "show", payload: suggestion }),
          onHideSuggestion: () => events.push({ type: "hide" }),
          debounceMs: 5,
        },
      };
    }

    it("does not show a suggestion before debounce", async () => {
      const { events, deps } = makeDeps();
      const loop = createSuggestionLoop(deps);
      loop.onContextChanged();
      expect(events).toHaveLength(0);
      await wait(10);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("show");
    });

    it("cancels stale debounced requests when context changes", async () => {
      const { events, deps, getContext } = makeDeps();
      let context = "hello";
      deps.getContext = () => ({ context, activeApplication: { bundleId: "com.apple.TextEdit" }, secureInput: false });
      const loop = createSuggestionLoop(deps);
      loop.onContextChanged();
      await wait(3);
      context = "world";
      loop.onContextChanged();
      await wait(10);
      expect(events.filter((e) => e.type === "show")).toHaveLength(1);
    });

    it("hides a suggestion when context changes after it is shown", async () => {
      const { events, deps, getContext } = makeDeps();
      let context = "hello";
      deps.getContext = () => ({ context, activeApplication: { bundleId: "com.apple.TextEdit" }, secureInput: false });
      const loop = createSuggestionLoop(deps);
      loop.onContextChanged();
      await wait(10);
      context = "changed";
      loop.onContextChanged();
      await wait(10);
      expect(events.some((e) => e.type === "hide")).toBe(true);
    });

    it("does not show a suggestion for empty context", async () => {
      const { events, deps } = makeDeps();
      deps.getContext = () => ({ context: "", activeApplication: { bundleId: "com.apple.TextEdit" }, secureInput: false });
      const loop = createSuggestionLoop(deps);
      loop.onContextChanged();
      await wait(10);
      expect(events).toHaveLength(0);
    });

    it("does not show a suggestion while secure input is active", async () => {
      const { events, deps } = makeDeps();
      deps.getContext = () => ({ context: "hello", activeApplication: { bundleId: "com.apple.TextEdit" }, secureInput: true });
      const loop = createSuggestionLoop(deps);
      loop.onContextChanged();
      await wait(10);
      expect(events).toHaveLength(0);
    });

    it("hides an existing suggestion when secure input activates", async () => {
      const { events, deps, getContext } = makeDeps();
      let secureInput = false;
      deps.getContext = () => ({ context: "hello", activeApplication: { bundleId: "com.apple.TextEdit" }, secureInput });
      const loop = createSuggestionLoop(deps);
      loop.onContextChanged();
      await wait(10);
      secureInput = true;
      loop.onContextChanged();
      await wait(10);
      expect(events.some((e) => e.type === "hide")).toBe(true);
    });

    it("does not show a stale response if the active application switched during debounce", async () => {
      const { events, deps, getContext } = makeDeps();
      let app: ActiveApplication | null = { bundleId: "com.apple.TextEdit" };
      deps.getContext = () => ({ context: "hello", activeApplication: app, secureInput: false });
      const loop = createSuggestionLoop(deps);
      loop.onContextChanged();
      await wait(3);
      app = { bundleId: "com.apple.Notes" };
      loop.onContextChanged();
      await wait(10);
      expect(events.filter((e) => e.type === "show")).toHaveLength(1);
    });
  });

  describe("acceptance and insertion", () => {
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
        restoreClipboard: async (previous) => calls.push({ type: "restoreClipboard", value: previous }),
      });
      expect(result).toBe("inserted");
      expect(calls.map((c) => c.type)).toEqual(["setClipboard", "sendPaste", "restoreClipboard"]);
      expect(calls[0].value).toBe(" world");
      expect(calls[2].value).toBe("previous-clipboard");
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
});
