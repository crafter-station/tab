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
import { createSuggestionLoop } from "../apps/desktop/src/main/suggestion-loop.ts";
import { createPoliteTriggerPolicy } from "../apps/desktop/src/main/trigger-policy.ts";
import { acceptAndInsertSuggestion } from "../apps/desktop/src/main/acceptance.ts";
import {
  createAccessibilityAppContextProvider,
  createAppContextManager,
  type AppContextSnapshot,
} from "../apps/desktop/src/main/app-context.ts";
import { createApplicationCompatibilityStore } from "../apps/desktop/src/main/application-compatibility.ts";
import { createNativeSuggestionSession } from "../apps/desktop/src/main/native-suggestion-session.ts";
import { redactSensitiveText } from "../packages/redaction/src/index.ts";
import { getMemoryEligibility } from "../packages/memory-policy/src/index.ts";
import type { Suggestion, ActiveApplication, RecordTelemetryEventRequest } from "@tabb/contracts";

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

    it("does not resume old context when switching back to a previous window", () => {
      const buffer = createTypingContextBuffer();
      buffer.setActiveApplication({ bundleId: "com.apple.TextEdit", windowId: "window:1" });
      buffer.appendText("Hello");
      buffer.setActiveApplication({ bundleId: "com.apple.TextEdit", windowId: "window:2" });
      buffer.appendText("World");
      buffer.setActiveApplication({ bundleId: "com.apple.TextEdit", windowId: "window:1" });
      buffer.appendText("Again");
      expect(buffer.getState().context).toBe("Again");
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

  describe("suggestion loop", () => {
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    function makeDeps(overrides: {
      requestSuggestion?: (snapshot: RequestableTypingContextSnapshot) => Promise<Suggestion | null>;
      getLocalSuggestion?: (snapshot: RequestableTypingContextSnapshot) => Promise<Suggestion | null> | Suggestion | null;
      getContext?: () => SafeTypingContextSnapshot;
      maxVisibleMs?: number;
    } = {}) {
      const events: Array<{ type: string; payload?: unknown }> = [];
      return {
        events,
        deps: {
          getContext: overrides.getContext ?? (() => makeSnapshot()),
          getLocalSuggestion: overrides.getLocalSuggestion,
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
      deps.getContext = () => makeSnapshot({ context });
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
      deps.getContext = () => makeSnapshot({ context });
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
      deps.getContext = () => makeSnapshot({ context: "" });
      const loop = createSuggestionLoop(deps);
      loop.onContextChanged();
      await wait(10);
      expect(events).toHaveLength(0);
    });

    it("does not show a suggestion while secure input is active", async () => {
      const { events, deps } = makeDeps();
      deps.getContext = () => makeSnapshot({ secureInput: true });
      const loop = createSuggestionLoop(deps);
      loop.onContextChanged();
      await wait(10);
      expect(events).toHaveLength(0);
    });

    it("hides an existing suggestion when secure input activates", async () => {
      const { events, deps } = makeDeps();
      let secureInput = false;
      deps.getContext = () => makeSnapshot({ secureInput });
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
      deps.getContext = () => makeSnapshot({ activeApplication: app });
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
      deps.getContext = () => makeSnapshot({ activeApplication: app });
      const loop = createSuggestionLoop(deps);
      loop.onContextChanged();
      await wait(10);
      app = { bundleId: "com.apple.TextEdit", windowId: "window:2" };
      loop.onContextChanged();
      await wait(10);
      expect(events.some((e) => e.type === "hide")).toBe(true);
    });

    it("suppresses cloud requests while prose typing cadence is still rapid", async () => {
      let now = 1_000;
      let context = "Hello";
      const policy = createPoliteTriggerPolicy({ now: () => now, rapidTypingMs: 250 });
      const requestSuggestionCalls: string[] = [];
      const { deps } = makeDeps({
        getContext: () => makeSnapshot({ context }),
        requestSuggestion: async (snapshot) => {
          requestSuggestionCalls.push(snapshot.sanitizedContext);
          return { id: "s-1", text: " world" };
        },
      });
      const loop = createSuggestionLoop({ ...deps, triggerPolicy: policy });

      loop.onContextChanged();
      now += 40;
      context = "Hello t";
      loop.onContextChanged();
      await wait(10);

      expect(requestSuggestionCalls).toHaveLength(0);
    });

    it("hides candidates that the trigger policy decides are too interruptive to show", async () => {
      const policy = createPoliteTriggerPolicy({ maxSuggestionCharacters: 8 });
      const { events, deps } = makeDeps({
        requestSuggestion: async () => ({ id: "s-long", text: " this candidate is too long" }),
      });
      const loop = createSuggestionLoop({ ...deps, triggerPolicy: policy });

      loop.onContextChanged();
      await wait(10);

      expect(events.map((event) => event.type)).toEqual(["requestStarted", "requestFinished"]);
    });

    it("uses stricter trigger behavior in terminal contexts than prose contexts", async () => {
      const policy = createPoliteTriggerPolicy({ now: () => 10_000 });
      const terminalRequestSuggestionCalls: string[] = [];
      const proseRequestSuggestionCalls: string[] = [];
      const terminal = makeDeps({
        getContext: () => makeSnapshot({
          context: "git status",
          activeApplication: { bundleId: "com.apple.Terminal" },
          contextSource: "terminal_input",
        }),
        requestSuggestion: async (snapshot) => {
          terminalRequestSuggestionCalls.push(snapshot.sanitizedContext);
          return { id: "s-terminal", text: " --short" };
        },
      });
      const prose = makeDeps({
        getContext: () => makeSnapshot({ context: "git status" }),
        requestSuggestion: async (snapshot) => {
          proseRequestSuggestionCalls.push(snapshot.sanitizedContext);
          return { id: "s-prose", text: " update" };
        },
      });

      createSuggestionLoop({ ...terminal.deps, triggerPolicy: policy }).onContextChanged();
      createSuggestionLoop({
        ...prose.deps,
        triggerPolicy: createPoliteTriggerPolicy({ now: () => 10_000 }),
      }).onContextChanged();
      await wait(10);

      expect(terminalRequestSuggestionCalls).toHaveLength(0);
      expect(proseRequestSuggestionCalls).toEqual(["git status"]);
    });

    it("activates bounded cooldowns after repeated stale suggestions", async () => {
      let now = 1_000;
      let context = "Hello ";
      const policy = createPoliteTriggerPolicy({
        now: () => now,
        staleCooldownThreshold: 1,
        staleCooldownMs: 500,
      });
      const requestSuggestionCalls: string[] = [];
      const { deps } = makeDeps({
        getContext: () => makeSnapshot({ context }),
        requestSuggestion: async (snapshot) => {
          requestSuggestionCalls.push(snapshot.sanitizedContext);
          return { id: `s-${requestSuggestionCalls.length}`, text: " world" };
        },
      });
      const loop = createSuggestionLoop({ ...deps, triggerPolicy: policy, maxVisibleMs: 5 });

      loop.onContextChanged();
      await wait(25);
      context = "Hello again ";
      now += 100;
      loop.onContextChanged();
      await wait(15);

      expect(requestSuggestionCalls).toHaveLength(1);

      now += 600;
      context = "Hello again friend ";
      loop.onContextChanged();
      await wait(15);

      expect(requestSuggestionCalls).toHaveLength(2);
    });

    it("shows a confident local suggestion without making a cloud request", async () => {
      const localCalls: string[] = [];
      const cloudCalls: string[] = [];
      const { events, deps } = makeDeps({
        getContext: () => makeSnapshot({ context: "thank" }),
        getLocalSuggestion: (snapshot) => {
          localCalls.push(snapshot.sanitizedContext);
          return { id: "local-thank", text: " you" };
        },
        requestSuggestion: async (snapshot) => {
          cloudCalls.push(snapshot.sanitizedContext);
          return { id: "cloud-thank", text: " you very much" };
        },
      });

      createSuggestionLoop(deps).onContextChanged();
      await wait(10);

      expect(localCalls).toEqual(["thank"]);
      expect(cloudCalls).toHaveLength(0);
      expect(events.map((event) => event.type)).toEqual(["show"]);
      expect(events[0].payload).toEqual({ id: "local-thank", text: " you" });
    });

    it("falls back to the cloud suggestion path when local has no confident candidate", async () => {
      const localCalls: string[] = [];
      const cloudCalls: string[] = [];
      const { events, deps } = makeDeps({
        getLocalSuggestion: (snapshot) => {
          localCalls.push(snapshot.sanitizedContext);
          return null;
        },
        requestSuggestion: async (snapshot) => {
          cloudCalls.push(snapshot.sanitizedContext);
          return { id: "cloud-hello", text: " world" };
        },
      });

      createSuggestionLoop(deps).onContextChanged();
      await wait(10);

      expect(localCalls).toEqual(["hello"]);
      expect(cloudCalls).toEqual(["hello"]);
      expect(events.map((event) => event.type)).toEqual(["requestStarted", "requestFinished", "show"]);
      expect(events[2].payload).toEqual({ id: "cloud-hello", text: " world" });
    });

    it("does not call local or cloud suggestion sources for unsafe contexts", async () => {
      const localCalls: string[] = [];
      const cloudCalls: string[] = [];
      const { events, deps } = makeDeps({
        getContext: () => makeSnapshot({ context: "sk-live-secret", privateContext: true }),
        getLocalSuggestion: (snapshot) => {
          localCalls.push(snapshot.sanitizedContext);
          return { id: "local-secret", text: " value" };
        },
        requestSuggestion: async (snapshot) => {
          cloudCalls.push(snapshot.sanitizedContext);
          return { id: "cloud-secret", text: " value" };
        },
      });

      createSuggestionLoop(deps).onContextChanged();
      await wait(10);

      expect(localCalls).toHaveLength(0);
      expect(cloudCalls).toHaveLength(0);
      expect(events).toHaveLength(0);
    });

    it("does not show a stale local suggestion if context changes while local resolves", async () => {
      let context = "thank";
      const localResolves: Array<(suggestion: Suggestion | null) => void> = [];
      const cloudCalls: string[] = [];
      const { events, deps } = makeDeps({
        getContext: () => makeSnapshot({ context }),
        getLocalSuggestion: () => new Promise((resolve) => {
          localResolves.push(resolve);
        }),
        requestSuggestion: async (snapshot) => {
          cloudCalls.push(snapshot.sanitizedContext);
          return { id: "cloud-next", text: " step" };
        },
      });
      const loop = createSuggestionLoop(deps);

      loop.onContextChanged();
      await wait(10);
      context = "please";
      loop.onContextChanged();
      localResolves[0]?.({ id: "local-thank", text: " you" });
      await wait(10);

      expect(events.filter((event) => event.type === "show" && (event.payload as Suggestion).id === "local-thank")).toHaveLength(0);
      expect(cloudCalls).not.toContain("thank");
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

  describe("native suggestion session", () => {
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    function makeSession(overrides: {
      requestSuggestion?: (snapshot: RequestableTypingContextSnapshot) => Promise<Suggestion | null>;
      maxVisibleMs?: number;
      recordInteractionTelemetry?: (event: RecordTelemetryEventRequest) => void | Promise<void>;
      triggerPolicy?: ReturnType<typeof createPoliteTriggerPolicy>;
      insertSemantically?: (text: string, target: TextSessionSnapshot) => Promise<boolean>;
      compatibilityStore?: ReturnType<typeof createApplicationCompatibilityStore>;
      getAppContext?: (snapshot: SafeTypingContextSnapshot) => AppContextSnapshot;
      clearAppContext?: () => void;
    } = {}) {
      const buffer = createTypingContextBuffer();
      const calls: Array<{ type: string; value?: unknown }> = [];
      const session = createNativeSuggestionSession({
        typingContext: buffer,
        requestSuggestion: async (snapshot) => {
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
          return overrides.requestSuggestion?.(snapshot) ?? { id: "s-1", text: " world" };
        },
        getContextSource: () => "typed_text",
        outputs: {
          showSuggestion: (suggestion) => calls.push({ type: "showSuggestion", value: suggestion }),
          clearSuggestion: () => calls.push({ type: "clearSuggestion" }),
          hideOverlay: () => calls.push({ type: "hideOverlay" }),
          showDebugContext: () => calls.push({ type: "showDebugContext" }),
          resetDebugApiState: () => calls.push({ type: "resetDebugApiState" }),
        },
        createAcceptanceDependencies: (getCurrentSuggestion, getPreviouslyActiveApplication) => ({
          getCurrentSuggestion,
          getPreviouslyActiveApplication,
          setClipboard: async (text) => {
            calls.push({ type: "setClipboard", value: text });
            return "previous-clipboard";
          },
          sendPaste: async () => calls.push({ type: "sendPaste" }),
          restoreClipboard: async (previous) => calls.push({ type: "restoreClipboard", value: previous }),
          insertSemantically: overrides.insertSemantically
            ? async (text, target) => {
              calls.push({ type: "insertSemantically", value: text });
              return overrides.insertSemantically?.(text, target) ?? false;
            }
            : undefined,
        }),
        debounceMs: 5,
        maxVisibleMs: overrides.maxVisibleMs,
        recordInteractionTelemetry: overrides.recordInteractionTelemetry,
        triggerPolicy: overrides.triggerPolicy,
        compatibilityStore: overrides.compatibilityStore,
        getAppContext: overrides.getAppContext,
        clearAppContext: overrides.clearAppContext,
      });
      return { buffer, calls, session };
    }

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

    it("uses the built-in local suggestion cascade before the API path", async () => {
      const { calls, session } = makeSession();

      session.setActiveApplication("com.apple.TextEdit", "window:1");
      session.appendText("thank");
      await wait(10);

      expect(calls.filter((call) => call.type === "requestSuggestion")).toHaveLength(0);
      expect(calls).toContainEqual({ type: "showSuggestion", value: { id: "local-thank", text: " you" } });
      expect(session.getCurrentSuggestion()).toEqual({ id: "local-thank", text: " you" });
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
      expect(buffer.getState().context).toBe("");
      expect(session.getCurrentSuggestion()).toBeNull();
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

    it("clears App Context on lifecycle clearing events", () => {
      const manager = createAppContextManager();
      manager.setSnapshot({
        fragments: [
          {
            id: "fragment-1",
            provider: "synthetic-provider",
            kind: "visible_text",
            text: "Temporary background",
            confidence: 0.9,
            redaction: { applied: false, redactionCount: 0, kinds: [] },
            requestable: true,
            memoryEligible: false,
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

    it("updates context when the user deletes text", () => {
      const { buffer, session } = makeSession();

      session.setActiveApplication("com.apple.TextEdit", "window:1");
      session.appendText("Hello world");
      session.deleteBackward("token");

      expect(buffer.getState().context).toBe("Hello");
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

      expect(calls.map((call) => call.type)).toContain("hideOverlay");

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
        requestSuggestion: async () => ({ id: `sg-req-${telemetry.length + 1}`, text: rawSuggestionText }),
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

      expect(telemetry.map((event) => event.eventType)).toEqual([
        "suggestion_accepted",
        "suggestion_dismissed",
        "suggestion_stale",
      ]);
      expect(telemetry[0]).toMatchObject({
        requestId: "req-1",
        activeApplicationBundleId: "com.apple.TextEdit",
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

    it("suppresses further suggestions for a bounded cooldown after repeated dismissals", async () => {
      let now = 1_000;
      const triggerPolicy = createPoliteTriggerPolicy({
        now: () => now,
        dismissalCooldownThreshold: 1,
        dismissalCooldownMs: 500,
      });
      const { calls, session } = makeSession({ triggerPolicy });

      session.setActiveApplication("com.apple.TextEdit", "window:1");
      session.appendText("Hello ");
      await wait(10);
      expect(calls.filter((call) => call.type === "requestSuggestion")).toHaveLength(1);

      now += 100;
      session.appendText("again ");
      await wait(10);
      expect(calls.filter((call) => call.type === "requestSuggestion")).toHaveLength(1);

      now += 600;
      session.appendText("friend ");
      await wait(10);
      expect(calls.filter((call) => call.type === "requestSuggestion")).toHaveLength(2);
    });

    it("tracks metadata-only compatibility per Active Application for stricter triggers and safer insertion", async () => {
      const compatibilityStore = createApplicationCompatibilityStore({
        strictDismissalThreshold: 1,
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
      expect(unreliableRequests).toHaveLength(0);

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
        dismissalCount: 1,
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
    type PrivacyContext = {
      context: string;
      activeApplication: ActiveApplication | null;
      secureInput: boolean;
      paused?: boolean;
      privateContext?: boolean;
    };

    function makePrivacyDeps(overrides: {
      getContext?: () => PrivacyContext;
      requestSuggestion?: (snapshot: RequestableTypingContextSnapshot) => Promise<Suggestion | null>;
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
          requestSuggestion: async (snapshot: RequestableTypingContextSnapshot) => {
            requestSuggestionCalls.push(snapshot.sanitizedContext);
            return overrides.requestSuggestion?.(snapshot) ?? { id: "s-1", text: " world" };
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
        const loop = createSuggestionLoop(deps);
        loop.onContextChanged();
        await wait(10);
        expect(requestSuggestionCalls).toHaveLength(0);
        expect(events.some((e) => e.type === "secretDetected")).toBe(true);
      });

      it("redacts and suppresses secret-like App Context fragments before requests", async () => {
        const manager = createAppContextManager();
        manager.setSnapshot({
          fragments: [
            {
              id: "fragment-1",
              provider: "synthetic-provider",
              kind: "visible_text",
              text: "api_key=sk-abc1234567890",
              confidence: 0.9,
              redaction: { applied: false, redactionCount: 0, kinds: [] },
              requestable: true,
              memoryEligible: false,
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
        const loop = createSuggestionLoop(deps);
        loop.onContextChanged();
        await wait(10);
        expect(requestSuggestionCalls).toHaveLength(0);
        expect(events.some((e) => e.type === "secretDetected")).toBe(true);
      });

      it("redacts private key blocks in typed context and suppresses the request", async () => {
        const { events, requestSuggestionCalls, deps } = makePrivacyDeps();
        const context = "-----BEGIN OPENSSH PRIVATE KEY-----\nabc123\n-----END OPENSSH PRIVATE KEY-----";
        deps.getContext = () => makeSnapshot({ context });
        const loop = createSuggestionLoop(deps);
        loop.onContextChanged();
        await wait(10);
        expect(requestSuggestionCalls).toHaveLength(0);
        expect(events.some((e) => e.type === "secretDetected")).toBe(true);
      });

      it("redacts database URLs in typed context and suppresses the request", async () => {
        const { events, requestSuggestionCalls, deps } = makePrivacyDeps();
        const context = "DATABASE_URL=postgres://user:pass@localhost:5432/db";
        deps.getContext = () => makeSnapshot({ context });
        const loop = createSuggestionLoop(deps);
        loop.onContextChanged();
        await wait(10);
        expect(requestSuggestionCalls).toHaveLength(0);
        expect(events.some((e) => e.type === "secretDetected")).toBe(true);
      });

      it("allows normal typed prose to request suggestions", async () => {
        const { requestSuggestionCalls, deps } = makePrivacyDeps();
        const context = "hello world";
        deps.getContext = () => makeSnapshot({ context });
        const loop = createSuggestionLoop(deps);
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
        deps.getContext = () => makeSnapshot({
          activeApplication: { bundleId: "com.1password.1password" },
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
        deps.getContext = () => makeSnapshot({ paused: true });
        const loop = createSuggestionLoop(deps);
        loop.onContextChanged();
        await wait(10);
        expect(requestSuggestionCalls).toHaveLength(0);
      });
    });
  });
});
