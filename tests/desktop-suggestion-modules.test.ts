import { describe, expect, it } from "bun:test";
import type { Suggestion } from "@tab/contracts";
import { createAutomaticSuggestion } from "../apps/desktop/src/main/automatic-suggestion.ts";
import { createDeepComplete } from "../apps/desktop/src/main/deep-complete.ts";
import { createSuggestionPresentation } from "../apps/desktop/src/main/suggestion-presentation.ts";
import { createSafeTypingContextSnapshot } from "../apps/desktop/src/main/typing-context.ts";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function snapshot(context = "hello") {
  return createSafeTypingContextSnapshot({
    context,
    activeApplication: { bundleId: "com.apple.TextEdit" },
    secureInput: false,
    paused: false,
    privateContext: false,
    contextSource: "typed_text",
    memoryEligible: true,
  });
}

describe("Suggestion presentation", () => {
  it("owns restore validation and the remaining absolute lifetime", async () => {
    let current = snapshot();
    const shown: Suggestion[] = [];
    let hides = 0;
    const presentation = createSuggestionPresentation({
      getContext: () => current,
      onShowSuggestion: (suggestion) => shown.push(suggestion),
      onHideSuggestion: () => hides += 1,
    });
    const suggestion = { id: "shared", text: " result" };
    const expiresAtMs = Date.now() + 30;

    expect(presentation.restore(suggestion, current.contextHash, expiresAtMs)).not.toBeNull();
    await wait(40);
    expect(shown).toEqual([suggestion]);
    expect(hides).toBe(1);

    const previousContextHash = current.contextHash;
    current = snapshot("changed");
    expect(presentation.restore(suggestion, previousContextHash, Date.now() + 30)).toBeNull();
    expect(shown).toHaveLength(1);
  });

  it("finishes its lifecycle when context changes before expiry", async () => {
    let current = snapshot();
    let expired = 0;
    let hides = 0;
    const presentation = createSuggestionPresentation({
      getContext: () => current,
      onShowSuggestion: () => {},
      onHideSuggestion: () => hides += 1,
    });

    presentation.present(current, { id: "shared", text: " result" }, Date.now() + 20, {
      onExpired: () => expired += 1,
    });
    current = snapshot("changed");
    await wait(30);

    expect(expired).toBe(1);
    expect(hides).toBe(0);
  });
});

describe("Automatic Suggestion", () => {
  it("finishes empty local inference without any cloud inference seam", async () => {
    const shown: Suggestion[] = [];
    const finished: Array<Suggestion | null> = [];
    const automatic = createAutomaticSuggestion({
      getContext: () => snapshot(),
      getLocalSuggestion: async () => null,
      onShowSuggestion: (suggestion) => shown.push(suggestion),
      onHideSuggestion: () => {},
      onRequestFinished: (suggestion) => finished.push(suggestion),
      debounceMs: 1,
    });

    automatic.onContextChanged();
    await wait(5);

    expect(shown).toEqual([]);
    expect(finished).toEqual([null]);
  });

  it("contains local inference failures without displaying or falling through", async () => {
    let failures = 0;
    const shown: Suggestion[] = [];
    const automatic = createAutomaticSuggestion({
      getContext: () => snapshot(),
      getLocalSuggestion: async () => {
        throw new Error("local unavailable");
      },
      onShowSuggestion: (suggestion) => shown.push(suggestion),
      onHideSuggestion: () => {},
      onSuggestionFailed: () => failures += 1,
      debounceMs: 1,
    });

    automatic.onContextChanged();
    await wait(5);

    expect(failures).toBe(1);
    expect(shown).toEqual([]);
  });

  it("displays only the final Suggestion returned by local inference", async () => {
    const shown: Suggestion[] = [];
    const automatic = createAutomaticSuggestion({
      getContext: () => snapshot(),
      getLocalSuggestion: async () => ({ id: "arbitrary-id", text: " final" }),
      onShowSuggestion: (suggestion) => shown.push(suggestion),
      onHideSuggestion: () => {},
      debounceMs: 1,
    });

    automatic.onContextChanged();
    await wait(5);

    expect(shown).toEqual([{ id: "arbitrary-id", text: " final" }]);
  });

  it("restores only current-context Suggestions for their remaining absolute lifetime", async () => {
    let current = snapshot();
    const shown: Suggestion[] = [];
    let expiresAtMs = 0;
    let hides = 0;
    const automatic = createAutomaticSuggestion({
      getContext: () => current,
      getLocalSuggestion: async () => ({ id: "automatic", text: " result" }),
      onShowSuggestion: (suggestion, deadline) => {
        shown.push(suggestion);
        expiresAtMs = deadline;
      },
      onHideSuggestion: () => hides += 1,
      debounceMs: 1,
      maxVisibleMs: 80,
    });

    automatic.onContextChanged();
    await wait(5);
    const contextHash = current.contextHash;
    automatic.suspend();
    await wait(15);
    expect(hides).toBe(0);

    expect(automatic.restore({ id: "automatic", text: " result" }, contextHash, expiresAtMs)).toBe(true);
    await wait(Math.max(0, expiresAtMs - Date.now() + 10));
    expect(hides).toBe(1);

    current = snapshot("changed");
    expect(automatic.restore(
      { id: "automatic", text: " result" },
      contextHash,
      Date.now() + 80,
    )).toBe(false);
    expect(shown).toHaveLength(2);
  });
});

describe("Deep Complete", () => {
  it("uses cloud inference only for its explicit action", async () => {
    const cloudContexts: string[] = [];
    const shown: Suggestion[] = [];
    const deepComplete = createDeepComplete({
      getContext: () => snapshot("hard writing moment"),
      requestCloudSuggestion: async (current) => {
        cloudContexts.push(current.sanitizedContext);
        return { id: "arbitrary-cloud-id", text: " resolved" };
      },
      onShowSuggestion: (suggestion) => shown.push(suggestion),
      onHideSuggestion: () => {},
    });

    expect(cloudContexts).toEqual([]);
    await deepComplete.requestNow();

    expect(cloudContexts).toEqual(["hard writing moment"]);
    expect(shown).toEqual([{ id: "arbitrary-cloud-id", text: " resolved" }]);
  });
});
