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
import { createSuggestionLoop, type SuggestionSource } from "../apps/desktop/src/main/suggestion-loop.ts";
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
import { createNativeAutocompleteRuntime } from "../apps/desktop/src/main/native-autocomplete-runtime.ts";
import { createNativeSuggestionSession } from "../apps/desktop/src/main/native-suggestion-session.ts";
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

  describe("suggestion loop", () => {
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    function makeDeps(overrides: {
      requestSuggestion?: SuggestionSource;
      getLocalSuggestion?: SuggestionSource;
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

    it("requests a cloud suggestion immediately for explicit triggers", async () => {
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
      const loop = createSuggestionLoop(deps);

      await loop.requestCloudSuggestionNow();

      expect(localCalls).toHaveLength(0);
      expect(cloudCalls).toEqual(["thank"]);
      expect(events.map((event) => event.type)).toEqual(["requestStarted", "requestFinished", "show"]);
      expect(events[2].payload).toEqual({ id: "cloud-thank", text: " you very much" });
    });

    it("shares active work between duplicate explicit requests for unchanged context", async () => {
      const resolves: Array<(suggestion: Suggestion | null) => void> = [];
      let calls = 0;
      const { deps } = makeDeps({
        requestSuggestion: () => {
          calls += 1;
          return new Promise((resolve) => {
            resolves.push(resolve);
          });
        },
      });
      const loop = createSuggestionLoop(deps);

      const firstRequest = loop.requestCloudSuggestionNow();
      const secondRequest = loop.requestCloudSuggestionNow();

      expect(calls).toBe(1);
      resolves[0]?.(null);
      expect(await Promise.all([firstRequest, secondRequest])).toEqual([undefined, undefined]);
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

    it("requests a suggestion for the latest prose after a rapid typing burst stops", async () => {
      let context = "Hello";
      const policy = createPoliteTriggerPolicy();
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
      context = "Hello t";
      loop.onContextChanged();
      await wait(10);

      expect(requestSuggestionCalls).toEqual(["Hello t"]);
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

    it("requests local-first suggestions in terminal and prose contexts", async () => {
      const policy = createPoliteTriggerPolicy();
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
        triggerPolicy: createPoliteTriggerPolicy(),
      }).onContextChanged();
      await wait(10);

      expect(terminalRequestSuggestionCalls).toEqual(["git status"]);
      expect(proseRequestSuggestionCalls).toEqual(["git status"]);
    });

    it("requests suggestions when Accessibility marks a safe Text Session as unreliable", async () => {
      const requestSuggestionCalls: string[] = [];
      const textSession: TextSessionSnapshot = {
        activeApplication: { bundleId: "com.apple.TextEdit", windowId: "window:1" },
        focusedElementId: "focus:1",
        textElementId: "text:1",
        selectedRange: { location: 5, length: 0 },
        caretIdentity: "caret:5",
        secureLike: false,
        accessibilityReliability: "unreliable",
        surroundingContext: { beforeCaret: "hello", afterCaret: "" },
      };
      const { deps } = makeDeps({
        getContext: () => createSafeTextSessionSnapshot(textSession),
        requestSuggestion: async (snapshot) => {
          requestSuggestionCalls.push(snapshot.sanitizedContext);
          return { id: "s-unreliable", text: " world" };
        },
      });

      createSuggestionLoop({ ...deps, triggerPolicy: createPoliteTriggerPolicy() }).onContextChanged();
      await wait(10);

      expect(requestSuggestionCalls).toEqual(["hello"]);
    });

    it("continues requesting after stale suggestions", async () => {
      let context = "Hello ";
      const policy = createPoliteTriggerPolicy();
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
      loop.onContextChanged();
      await wait(15);

      expect(requestSuggestionCalls).toHaveLength(2);

      context = "Hello again friend ";
      loop.onContextChanged();
      await wait(15);

      expect(requestSuggestionCalls).toHaveLength(3);
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

    it("does not fall through to cloud when automatic suggestions are local-only", async () => {
      const cloudCalls: string[] = [];
      const { events, deps } = makeDeps({
        getLocalSuggestion: () => null,
        requestSuggestion: async (snapshot) => {
          cloudCalls.push(snapshot.sanitizedContext);
          return { id: "cloud-hello", text: " world" };
        },
      });

      createSuggestionLoop({ ...deps, fallbackToCloudOnLocalMiss: false }).onContextChanged();
      await wait(10);

      expect(cloudCalls).toHaveLength(0);
      expect(events).toHaveLength(0);
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

    it("aborts local inference when Typing Context becomes stale", async () => {
      let context = "thank";
      let localSignal: AbortSignal | undefined;
      const { deps } = makeDeps({
        getContext: () => makeSnapshot({ context }),
        getLocalSuggestion: (_snapshot, options) => {
          localSignal = options?.signal;
          return new Promise(() => {});
        },
      });
      const loop = createSuggestionLoop(deps);

      loop.onContextChanged();
      await wait(10);
      context = "please";
      loop.onContextChanged();

      expect(localSignal?.aborted).toBe(true);
      loop.invalidate();
    });

    it("does not start duplicate requests for unchanged context while a request is in flight", async () => {
      const calls: string[] = [];
      const resolves: Array<(suggestion: Suggestion | null) => void> = [];
      const { events, deps } = makeDeps({
        requestSuggestion: (snapshot) => {
          calls.push(snapshot.sanitizedContext);
          return new Promise((resolve) => {
            resolves.push(resolve);
          });
        },
      });
      const loop = createSuggestionLoop(deps);

      loop.onContextChanged();
      await wait(10);
      loop.onContextChanged();
      await wait(10);

      expect(calls).toEqual(["hello"]);
      resolves[0]?.({ id: "s-1", text: " world" });
      await wait(1);
      expect(events.filter((event) => event.type === "show")).toHaveLength(1);
      expect(events.find((event) => event.type === "show")?.payload).toEqual({ id: "s-1", text: " world" });
    });

    it("withholds stale debounced cloud responses even when the source ignores abort", async () => {
      let context = "hello";
      const resolves: Array<(suggestion: Suggestion | null) => void> = [];
      const { events, deps } = makeDeps({
        getContext: () => makeSnapshot({ context }),
        requestSuggestion: () => new Promise((resolve) => {
          resolves.push(resolve);
        }),
      });
      const loop = createSuggestionLoop(deps);

      loop.onContextChanged();
      await wait(10);
      context = "hello again";
      loop.onContextChanged();
      resolves[0]?.({ id: "stale", text: " world" });
      await wait(1);

      expect(events.filter((event) => event.type === "show")).toHaveLength(0);
      loop.invalidate();
    });

    it("withholds stale explicit cloud responses for every Typing Context identity change", async () => {
      const textSession = (caretIdentity: string): TextSessionSnapshot => ({
        activeApplication: { bundleId: "com.apple.TextEdit", windowId: "window:1" },
        focusedElementId: "focus:1",
        textElementId: "text:1",
        selectedRange: { location: 5, length: 0 },
        caretIdentity,
        secureLike: false,
        accessibilityReliability: "reliable",
        supportsSemanticInsertion: true,
        surroundingContext: { beforeCaret: "hello", afterCaret: "" },
      });
      const cases: Array<[string, SafeTypingContextSnapshot, SafeTypingContextSnapshot]> = [
        ["text", makeSnapshot({ context: "hello" }), makeSnapshot({ context: "hello again" })],
        [
          "active application",
          makeSnapshot({ activeApplication: { bundleId: "com.apple.TextEdit" } }),
          makeSnapshot({ activeApplication: { bundleId: "com.apple.Notes" } }),
        ],
        [
          "active window",
          makeSnapshot({ activeApplication: { bundleId: "com.apple.TextEdit", windowId: "window:1" } }),
          makeSnapshot({ activeApplication: { bundleId: "com.apple.TextEdit", windowId: "window:2" } }),
        ],
        [
          "Text Session",
          createSafeTextSessionSnapshot(textSession("caret:1")),
          createSafeTextSessionSnapshot(textSession("caret:2")),
        ],
      ];

      for (const [identity, initial, changed] of cases) {
        let snapshot = initial;
        let resolveRequest: ((suggestion: Suggestion | null) => void) | undefined;
        const { events, deps } = makeDeps({
          getContext: () => snapshot,
          requestSuggestion: () => new Promise((resolve) => {
            resolveRequest = resolve;
          }),
        });
        const loop = createSuggestionLoop(deps);

        const request = loop.requestCloudSuggestionNow();
        snapshot = changed;
        loop.onContextChanged();
        resolveRequest?.({ id: `stale-${identity}`, text: " world" });
        await request;

        expect(events.filter((event) => event.type === "show"), identity).toHaveLength(0);
        loop.invalidate();
      }
    });

    it("suppresses an automatic request while explicit work owns unchanged context", async () => {
      const resolves: Array<(suggestion: Suggestion | null) => void> = [];
      let calls = 0;
      const { deps } = makeDeps({
        requestSuggestion: () => {
          calls += 1;
          return new Promise((resolve) => {
            resolves.push(resolve);
          });
        },
      });
      const loop = createSuggestionLoop(deps);

      const request = loop.requestCloudSuggestionNow();
      loop.onContextChanged();

      expect(calls).toBe(1);
      resolves[0]?.(null);
      await request;
    });

    it("releases explicit request ownership when the source rejects", async () => {
      let calls = 0;
      const { deps } = makeDeps({
        requestSuggestion: async () => {
          calls += 1;
          if (calls === 1) throw new Error("source failed");
          return null;
        },
      });
      const loop = createSuggestionLoop(deps);

      await expect(loop.requestCloudSuggestionNow()).rejects.toThrow("source failed");
      loop.onContextChanged();
      await wait(10);

      expect(calls).toBe(2);
    });

    it("retries unchanged debounced context after a source rejection", async () => {
      let calls = 0;
      const { deps } = makeDeps({
        requestSuggestion: async () => {
          calls += 1;
          if (calls === 1) throw new Error("source failed");
          return null;
        },
      });
      const loop = createSuggestionLoop(deps);

      loop.onContextChanged();
      await wait(10);

      expect(calls).toBe(1);
      expect(loop.getState().status).toBe("idle");

      loop.onContextChanged();
      await wait(10);

      expect(calls).toBe(2);
    });

    it("aborts stale cloud requests when context changes", async () => {
      let context = "hello";
      const signals: AbortSignal[] = [];
      const { deps } = makeDeps({
        getContext: () => makeSnapshot({ context }),
        requestSuggestion: (_snapshot, options) => {
          if (options?.signal) signals.push(options.signal);
          return new Promise(() => {});
        },
      });
      const loop = createSuggestionLoop(deps);

      loop.onContextChanged();
      await wait(10);
      context = "hello again";
      loop.onContextChanged();

      expect(signals).toHaveLength(1);
      expect(signals[0].aborted).toBe(true);
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

  describe("native autocomplete runtime", () => {
    it("routes desktop input through Typing Context, Memory Extraction Window, App Context, and Suggestion seams", () => {
      const buffer = createTypingContextBuffer();
      const memoryAppends: unknown[] = [];
      const appContextTrees: unknown[] = [];
      const runtime = createNativeAutocompleteRuntime({
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
        requestSuggestion: () => null,
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

    it("can explicitly request a cloud suggestion for the current context", async () => {
      const { calls, session } = makeSession({
        requestSuggestion: async () => ({ id: "cloud-thank", text: " you very much" }),
      });

      session.setActiveApplication("com.apple.TextEdit", "window:1");
      session.appendText("thank");
      await wait(10);
      calls.length = 0;

      await session.requestSuggestionNow();

      expect(calls).toContainEqual({ type: "requestSuggestion", value: "thank" });
      expect(calls).toContainEqual({ type: "showSuggestion", value: { id: "cloud-thank", text: " you very much" } });
      expect(session.getCurrentSuggestion()).toEqual({ id: "cloud-thank", text: " you very much" });
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

    it("records App Context compatibility metadata without raw context", async () => {
      const compatibilityStore = createApplicationCompatibilityStore();
      const rawAppContext = "Dana: The launch room is Atlas 417";
      const { session } = makeSession({
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

    it("clears a visible Text Session suggestion when fallback text arrives before the next snapshot", async () => {
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
      expect(calls.map((call) => call.type)).toContain("clearSuggestion");
      expect(calls.map((call) => call.type)).toContain("hideOverlay");
      expect(session.getCurrentSuggestion()).toBeNull();
      expect(session.getLoopState().status).toBe("idle");
      expect(session.getCurrentSnapshot().sanitizedContext).toBe("Alpha");
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
