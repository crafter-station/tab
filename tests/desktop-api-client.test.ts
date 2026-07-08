import { describe, it, expect } from "bun:test";
import { SuggestionRequestSchema } from "../packages/contracts/src/index.ts";
import { createApiSuggestionClient } from "../apps/desktop/src/main/suggestion-client.ts";
import {
  createSafeTypingContextSnapshot,
  type RequestableTypingContextSnapshot,
  type TypingContextState,
} from "../apps/desktop/src/main/typing-context.ts";

function makeState(overrides: Partial<TypingContextState> = {}): TypingContextState {
  return {
    context: "hello",
    activeApplication: { bundleId: "com.apple.TextEdit" },
    secureInput: false,
    paused: false,
    privateContext: false,
    contextSource: "typed_text",
    memoryEligible: true,
    ...overrides,
  };
}

function makeSnapshot(
  overrides: Partial<TypingContextState> = {},
): RequestableTypingContextSnapshot {
  const snapshot = createSafeTypingContextSnapshot(makeState(overrides));
  if (!snapshot.requestable || !snapshot.activeApplication) {
    throw new Error("test snapshot must be requestable");
  }
  return snapshot as RequestableTypingContextSnapshot;
}

describe("desktop API suggestion client", () => {
  it("returns the first suggestion from a successful API response", async () => {
    const captured: { url?: string; body?: unknown } = {};
    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      captured.url = String(url);
      captured.body = init?.body ? JSON.parse(String(init.body)) : undefined;
      return new Response(
        JSON.stringify({ status: "ok", data: { suggestions: [{ id: "s-1", text: " world" }] } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const requestSuggestion = createApiSuggestionClient({
      apiBaseUrl: "http://localhost:8787",
      deviceId: "device-1",
      appVersion: "0.0.1",
      platform: "darwin",
      fetch,
    });

    const suggestion = await requestSuggestion(makeSnapshot());

    expect(suggestion).not.toBeNull();
    expect(suggestion?.text).toBe(" world");
    expect(captured.url).toBe("http://localhost:8787/suggestions");
    const request = SuggestionRequestSchema.parse(captured.body);
    expect(request.contextHash).toBe("com.apple.TextEdit:window-unknown:hello:false");
  });

  it("can disable memories in the suggestion request", async () => {
    const captured: { body?: unknown } = {};
    const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      captured.body = init?.body ? JSON.parse(String(init.body)) : undefined;
      return new Response(
        JSON.stringify({ status: "ok", data: { suggestions: [{ id: "s-1", text: " world" }] } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const requestSuggestion = createApiSuggestionClient({
      apiBaseUrl: "http://localhost:8787",
      deviceId: "device-1",
      appVersion: "0.0.1",
      platform: "darwin",
      memoryEnabled: false,
      fetch,
    });

    await requestSuggestion(makeSnapshot());

    const request = SuggestionRequestSchema.parse(captured.body);
    expect(request.memoryEnabled).toBe(false);
  });

  it("can enable memories in the suggestion request", async () => {
    const captured: { body?: unknown } = {};
    const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      captured.body = init?.body ? JSON.parse(String(init.body)) : undefined;
      return new Response(
        JSON.stringify({ status: "ok", data: { suggestions: [{ id: "s-1", text: " world" }] } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const requestSuggestion = createApiSuggestionClient({
      apiBaseUrl: "http://localhost:8787",
      deviceId: "device-1",
      appVersion: "0.0.1",
      platform: "darwin",
      memoryEnabled: true,
      fetch,
    });

    await requestSuggestion(makeSnapshot());

    const request = SuggestionRequestSchema.parse(captured.body);
    expect(request.memoryEnabled).toBe(true);
  });

  it("excludes memories for pasted text even when memory usage is enabled", async () => {
    const captured: { body?: unknown } = {};
    const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      captured.body = init?.body ? JSON.parse(String(init.body)) : undefined;
      return new Response(
        JSON.stringify({ status: "ok", data: { suggestions: [{ id: "s-1", text: " world" }] } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const requestSuggestion = createApiSuggestionClient({
      apiBaseUrl: "http://localhost:8787",
      deviceId: "device-1",
      appVersion: "0.0.1",
      platform: "darwin",
      memoryEnabled: true,
      fetch,
    });

    await requestSuggestion(makeSnapshot({ contextSource: "pasted_text", memoryEligible: false }));

    const request = SuggestionRequestSchema.parse(captured.body);
    expect(request.contextSource).toBe("pasted_text");
    expect(request.memoryEnabled).toBe(false);
  });

  it("reads the latest memory setting for each suggestion request", async () => {
    const captured: unknown[] = [];
    let memoryEnabled = false;
    const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      captured.push(init?.body ? JSON.parse(String(init.body)) : undefined);
      return new Response(
        JSON.stringify({ status: "ok", data: { suggestions: [{ id: "s-1", text: " world" }] } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const requestSuggestion = createApiSuggestionClient({
      apiBaseUrl: "http://localhost:8787",
      deviceId: "device-1",
      appVersion: "0.0.1",
      platform: "darwin",
      memoryEnabled: () => memoryEnabled,
      fetch,
    });

    await requestSuggestion(makeSnapshot());
    memoryEnabled = true;
    await requestSuggestion(makeSnapshot());

    expect(SuggestionRequestSchema.parse(captured[0]).memoryEnabled).toBe(false);
    expect(SuggestionRequestSchema.parse(captured[1]).memoryEnabled).toBe(true);
  });

  it("returns null when the API returns an empty suggestions array", async () => {
    const fetch = async () =>
      new Response(JSON.stringify({ status: "ok", data: { suggestions: [] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const requestSuggestion = createApiSuggestionClient({
      apiBaseUrl: "http://localhost:8787",
      deviceId: "device-1",
      appVersion: "0.0.1",
      platform: "darwin",
      fetch,
    });

    const suggestion = await requestSuggestion(makeSnapshot());
    expect(suggestion).toBeNull();
  });

  it("fails silently when the API returns an error", async () => {
    const fetch = async () =>
      new Response(
        JSON.stringify({ status: "error", error: { code: "provider_failure", message: "timeout" } }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );

    const requestSuggestion = createApiSuggestionClient({
      apiBaseUrl: "http://localhost:8787",
      deviceId: "device-1",
      appVersion: "0.0.1",
      platform: "darwin",
      fetch,
    });

    const suggestion = await requestSuggestion(makeSnapshot());
    expect(suggestion).toBeNull();
  });

  it("fails silently when the network request throws", async () => {
    const fetch = async () => {
      throw new Error("network unreachable");
    };

    const requestSuggestion = createApiSuggestionClient({
      apiBaseUrl: "http://localhost:8787",
      deviceId: "device-1",
      appVersion: "0.0.1",
      platform: "darwin",
      fetch,
    });

    const suggestion = await requestSuggestion(makeSnapshot());
    expect(suggestion).toBeNull();
  });
});
