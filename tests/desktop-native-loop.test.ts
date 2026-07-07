import { describe, it, expect } from "bun:test";
import { createTypingContextBuffer, getLastWords } from "../apps/desktop/src/main/typing-context.ts";
import { generateFakeSuggestion } from "../apps/desktop/src/main/suggestion-engine.ts";
import { createSuggestionLoop } from "../apps/desktop/src/main/suggestion-loop.ts";
import { acceptAndInsertSuggestion } from "../apps/desktop/src/main/acceptance.ts";
import { redactSensitiveText } from "../packages/redaction/src/index.ts";
import { getMemoryEligibility } from "../packages/memory-policy/src/index.ts";
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

    it("clears context when active window changes within the same application", () => {
      const buffer = createTypingContextBuffer();
      buffer.setActiveApplication({ bundleId: "com.apple.TextEdit", windowId: "window:1" });
      buffer.appendText("Hello");
      buffer.setActiveApplication({ bundleId: "com.apple.TextEdit", windowId: "window:2" });
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
      maxVisibleMs?: number;
    } = {}) {
      const events: Array<{ type: string; payload?: unknown }> = [];
      return {
        events,
        deps: {
          getContext: overrides.getContext ?? (() => ({ context: "hello", activeApplication: { bundleId: "com.apple.TextEdit" }, secureInput: false })),
          requestSuggestion: overrides.requestSuggestion ?? (async () => ({ id: "s-1", text: " world" })),
          onShowSuggestion: (suggestion: Suggestion) => events.push({ type: "show", payload: suggestion }),
          onHideSuggestion: () => events.push({ type: "hide" }),
          onRequestStarted: (context: string) => events.push({ type: "requestStarted", payload: context }),
          onRequestFinished: (suggestion: Suggestion | null) => events.push({ type: "requestFinished", payload: suggestion }),
          debounceMs: 5,
          maxVisibleMs: overrides.maxVisibleMs,
        },
      };
    }

    it("does not show a suggestion before debounce", async () => {
      const { events, deps } = makeDeps();
      const loop = createSuggestionLoop(deps);
      loop.onContextChanged();
      expect(events).toHaveLength(0);
      await wait(10);
      expect(events.some((event) => event.type === "show")).toBe(true);
    });

    it("reports request lifecycle events around suggestion requests", async () => {
      const { events, deps } = makeDeps();
      const loop = createSuggestionLoop(deps);
      loop.onContextChanged();
      await wait(10);

      expect(events.map((event) => event.type)).toEqual(["requestStarted", "requestFinished", "show"]);
      expect(events[0].payload).toBe("hello");
      expect(events[1].payload).toEqual({ id: "s-1", text: " world" });
    });

    it("reports empty request results without showing a suggestion", async () => {
      const { events, deps } = makeDeps({ requestSuggestion: async () => null });
      const loop = createSuggestionLoop(deps);
      loop.onContextChanged();
      await wait(10);

      expect(events.map((event) => event.type)).toEqual(["requestStarted", "requestFinished"]);
      expect(events[1].payload).toBeNull();
    });

    it("cancels stale debounced requests when context changes", async () => {
      const { events, deps } = makeDeps();
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
      const { events, deps } = makeDeps();
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
      const { events, deps } = makeDeps();
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
      const { events, deps } = makeDeps();
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

    it("hides a shown suggestion after the visible timeout", async () => {
      const { events, deps } = makeDeps({ maxVisibleMs: 5 });
      const loop = createSuggestionLoop(deps);
      loop.onContextChanged();
      await wait(15);
      expect(events.map((event) => event.type)).toEqual(["requestStarted", "requestFinished", "show", "hide"]);
      expect(loop.getState().status).toBe("idle");
    });

    it("hides a suggestion when the active window changes within the same application", async () => {
      const { events, deps } = makeDeps();
      let app: ActiveApplication | null = { bundleId: "com.apple.TextEdit", windowId: "window:1" };
      deps.getContext = () => ({ context: "hello", activeApplication: app, secureInput: false });
      const loop = createSuggestionLoop(deps);
      loop.onContextChanged();
      await wait(10);
      app = { bundleId: "com.apple.TextEdit", windowId: "window:2" };
      loop.onContextChanged();
      await wait(10);
      expect(events.some((e) => e.type === "hide")).toBe(true);
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
        waitForPaste: async () => calls.push({ type: "waitForPaste" }),
        restoreClipboard: async (previous) => calls.push({ type: "restoreClipboard", value: previous }),
      });
      expect(result).toBe("inserted");
      expect(calls.map((c) => c.type)).toEqual(["setClipboard", "sendPaste", "waitForPaste", "restoreClipboard"]);
      expect(calls[0].value).toBe(" world");
      expect(calls[3].value).toBe("previous-clipboard");
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

  describe("local privacy suppression and redaction", () => {
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    type PrivacyContext = {
      context: string;
      activeApplication: ActiveApplication | null;
      secureInput: boolean;
      paused?: boolean;
      privateContext?: boolean;
    };

    function makePrivacyDeps(overrides: {
      getContext?: () => PrivacyContext;
      requestSuggestion?: (context: string) => Promise<Suggestion | null>;
    } = {}) {
      const events: Array<{ type: string; payload?: unknown }> = [];
      const requestSuggestionCalls: string[] = [];
      return {
        events,
        requestSuggestionCalls,
        deps: {
          getContext:
            overrides.getContext ??
            (() => ({ context: "hello", activeApplication: { bundleId: "com.apple.TextEdit" }, secureInput: false })),
          requestSuggestion: async (context: string) => {
            requestSuggestionCalls.push(context);
            return overrides.requestSuggestion?.(context) ?? { id: "s-1", text: " world" };
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
        deps.getContext = () => ({ context, activeApplication: { bundleId: "com.apple.TextEdit" }, secureInput: false });
        const loop = createSuggestionLoop(deps);
        loop.onContextChanged();
        await wait(10);
        expect(requestSuggestionCalls).toHaveLength(0);
        expect(events.some((e) => e.type === "secretDetected")).toBe(true);
      });

      it("redacts bearer tokens in typed context and suppresses the request", async () => {
        const { events, requestSuggestionCalls, deps } = makePrivacyDeps();
        const context = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
        deps.getContext = () => ({ context, activeApplication: { bundleId: "com.apple.TextEdit" }, secureInput: false });
        const loop = createSuggestionLoop(deps);
        loop.onContextChanged();
        await wait(10);
        expect(requestSuggestionCalls).toHaveLength(0);
        expect(events.some((e) => e.type === "secretDetected")).toBe(true);
      });

      it("redacts private key blocks in typed context and suppresses the request", async () => {
        const { events, requestSuggestionCalls, deps } = makePrivacyDeps();
        const context = "-----BEGIN OPENSSH PRIVATE KEY-----\nabc123\n-----END OPENSSH PRIVATE KEY-----";
        deps.getContext = () => ({ context, activeApplication: { bundleId: "com.apple.TextEdit" }, secureInput: false });
        const loop = createSuggestionLoop(deps);
        loop.onContextChanged();
        await wait(10);
        expect(requestSuggestionCalls).toHaveLength(0);
        expect(events.some((e) => e.type === "secretDetected")).toBe(true);
      });

      it("redacts database URLs in typed context and suppresses the request", async () => {
        const { events, requestSuggestionCalls, deps } = makePrivacyDeps();
        const context = "DATABASE_URL=postgres://user:pass@localhost:5432/db";
        deps.getContext = () => ({ context, activeApplication: { bundleId: "com.apple.TextEdit" }, secureInput: false });
        const loop = createSuggestionLoop(deps);
        loop.onContextChanged();
        await wait(10);
        expect(requestSuggestionCalls).toHaveLength(0);
        expect(events.some((e) => e.type === "secretDetected")).toBe(true);
      });

      it("allows normal typed prose to request suggestions", async () => {
        const { requestSuggestionCalls, deps } = makePrivacyDeps();
        const context = "hello world";
        deps.getContext = () => ({ context, activeApplication: { bundleId: "com.apple.TextEdit" }, secureInput: false });
        const loop = createSuggestionLoop(deps);
        loop.onContextChanged();
        await wait(10);
        expect(requestSuggestionCalls).toHaveLength(1);
        expect(requestSuggestionCalls[0]).toBe("hello world");
      });

      it("clears the typing context buffer when secret-like context is detected", async () => {
        const buffer = createTypingContextBuffer();
        const { events, requestSuggestionCalls, deps } = makePrivacyDeps();
        deps.getContext = () => buffer.getState();
        deps.onSecretLikeContextDetected = () => {
          buffer.clear();
          events.push({ type: "secretDetected" });
        };
        buffer.appendText("api_key=sk-abc1234567890");
        const loop = createSuggestionLoop(deps);
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
        deps.getContext = () => ({
          context: "hello",
          activeApplication: { bundleId: "com.1password.1password" },
          secureInput: false,
          privateContext: true,
        });
        const loop = createSuggestionLoop(deps);
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
        deps.getContext = () => ({
          context: "hello",
          activeApplication: { bundleId: "com.apple.TextEdit" },
          secureInput: false,
          paused: true,
        });
        const loop = createSuggestionLoop(deps);
        loop.onContextChanged();
        await wait(10);
        expect(requestSuggestionCalls).toHaveLength(0);
      });
    });
  });
});
