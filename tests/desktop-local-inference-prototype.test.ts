import { describe, expect, it } from "bun:test";
import { createLocalInferencePrototype } from "../apps/desktop/src/main/local-inference-prototype.ts";
import { createSafeTypingContextSnapshot, type RequestableTypingContextSnapshot } from "../apps/desktop/src/main/typing-context.ts";

function requestableSnapshot(context = "Hello"): RequestableTypingContextSnapshot {
  const snapshot = createSafeTypingContextSnapshot({
    context,
    activeApplication: { bundleId: "com.apple.TextEdit" },
    secureInput: false,
    paused: false,
    privateContext: false,
    contextSource: "typed_text",
    memoryEligible: true,
  });
  if (!snapshot.requestable || !snapshot.activeApplication) throw new Error("Expected requestable fixture");
  return snapshot as RequestableTypingContextSnapshot;
}

function requestableSnapshotWithAppContext(): RequestableTypingContextSnapshot {
  return {
    ...requestableSnapshot("Continue this"),
    appContext: {
      fragments: [{
        id: "opencode-conversation",
        provider: "opencode-local-session",
        kind: "conversation",
        text: "User: Please keep the implementation local-first.",
        confidence: 0.95,
        redaction: { applied: false, redactionCount: 0, kinds: [] },
        requestable: true,
        memoryEligible: false,
      }],
      metadata: { provider: "opencode-local-session", status: "available", confidence: 0.95 },
    },
  };
}

function completionStream(content: string, timings: Record<string, number> = {}): Response {
  const encoder = new TextEncoder();
  const events = [
    `data: ${JSON.stringify({ content })}\n\n`,
    `data: ${JSON.stringify({ stop: true, timings })}\n\n`,
  ].join("");
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(events));
      controller.close();
    },
  }));
}

function chatCompletionStream(content: string): Response {
  const encoder = new TextEncoder();
  const events = [
    `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
  ].join("");
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(events));
      controller.close();
    },
  }));
}

describe("local inference prototype", () => {
  it("starts the pinned llama.cpp configuration and returns a normalized Suggestion", async () => {
    const spawnCalls: Array<{ executable: string; args: string[] }> = [];
    const requestBodies: unknown[] = [];
    const partialSuggestions: string[] = [];
    const runtime = createLocalInferencePrototype({
      executablePath: "/opt/llama-server",
      modelPath: "/tmp/model.gguf",
      port: 40_001,
      apiKey: "test-api-key",
      modelExists: () => true,
      verifyModelArtifact: async () => true,
      getRuntimeVersion: async () => "version: 9910 (f5525f7e7)",
      spawnHelper: (executable, args) => {
        spawnCalls.push({ executable, args });
        return { pid: 123, kill: () => true, once: () => {} };
      },
      fetch: async (input, init) => {
        if (String(input).endsWith("/health")) return new Response("ok");
        requestBodies.push(JSON.parse(String(init?.body)));
        return completionStream("world peace", { prompt_n: 12, prompt_ms: 20, predicted_n: 2, predicted_ms: 30 });
      },
    });

    await runtime.start();
    const suggestion = await runtime.getSuggestion(requestableSnapshot(), {
      onPartialSuggestion: (partial) => partialSuggestions.push(partial.text),
    });

    expect(runtime.getStatus()).toEqual({ status: "ready", modelId: "qwen2.5-3b-instruct-q4_k_m" });
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]?.executable).toBe("/opt/llama-server");
    expect(spawnCalls[0]?.args).toEqual([
      "--model", "/tmp/model.gguf",
      "--host", "127.0.0.1",
      "--port", "40001",
      "--ctx-size", "2048",
      "--parallel", "1",
      "--n-predict", "16",
      "--gpu-layers", "all",
      "--flash-attn", "on",
      "--cache-prompt",
      "--no-webui",
      "--log-disable",
      "--api-key", "test-api-key",
    ]);
    expect(requestBodies).toHaveLength(1);
    expect(requestBodies[0]).toMatchObject({
      max_tokens: 16,
      stream: true,
      cache_prompt: true,
      chat_template_kwargs: { enable_thinking: false },
    });
    expect(partialSuggestions).toEqual([" world"]);
    expect(suggestion?.text).toBe(" world peace");
    expect(suggestion?.id).toStartWith("sg-local-");
    expect(runtime.getLastTiming()).toMatchObject({
      promptTokens: 12,
      promptMs: 20,
      predictedTokens: 2,
      predictedMs: 30,
    });
    runtime.stop();
  });

  it("includes OpenCode App Context in the local llama request", async () => {
    let requestBody: { messages?: Array<{ role: string; content: string }> } | null = null;
    const runtime = createLocalInferencePrototype({
      executablePath: "/opt/llama-server",
      modelPath: "/tmp/model.gguf",
      port: 40_001,
      apiKey: "test-api-key",
      modelExists: () => true,
      verifyModelArtifact: async () => true,
      getRuntimeVersion: async () => "version: 9910 (f5525f7e7)",
      spawnHelper: () => ({ pid: 123, kill: () => true, once: () => {} }),
      fetch: async (input, init) => {
        if (String(input).endsWith("/health")) return new Response("ok");
        requestBody = JSON.parse(String(init?.body));
        return completionStream("next step");
      },
    });

    await runtime.start();
    await runtime.getSuggestion(requestableSnapshotWithAppContext());

    const finalMessage = requestBody?.messages?.at(-1)?.content ?? "";
    expect(finalMessage).toContain("[opencode-local-session/conversation]");
    expect(finalMessage).toContain("Please keep the implementation local-first.");
    expect(finalMessage).toContain("Unfinished text:\nContinue this");
    runtime.stop();
  });

  it("reports a missing model without launching the helper", async () => {
    let spawned = false;
    const runtime = createLocalInferencePrototype({
      executablePath: "llama-server",
      modelPath: "/missing/model.gguf",
      modelExists: () => false,
      spawnHelper: () => {
        spawned = true;
        return { kill: () => true, once: () => {} };
      },
    });

    await runtime.start();

    expect(spawned).toBe(false);
    expect(runtime.getStatus()).toEqual({
      status: "unavailable",
      modelId: "qwen2.5-3b-instruct-q4_k_m",
      reason: "missing_model",
    });
  });

  it("rejects runtime versions that only contain the pinned values as substrings", async () => {
    let spawned = false;
    const runtime = createLocalInferencePrototype({
      executablePath: "llama-server",
      modelPath: "/tmp/model.gguf",
      modelExists: () => true,
      verifyModelArtifact: async () => true,
      getRuntimeVersion: async () => "version: 19910 (af5525f7e70)",
      spawnHelper: () => {
        spawned = true;
        return { kill: () => true, once: () => {} };
      },
    });

    await runtime.start();

    expect(spawned).toBe(false);
    expect(runtime.getStatus()).toEqual({
      status: "unavailable",
      modelId: "qwen2.5-3b-instruct-q4_k_m",
      reason: "runtime_mismatch",
    });
  });

  it("keeps a spawn error as the terminal reason when exit follows", async () => {
    const listeners: Record<string, (...args: never[]) => void> = {};
    const runtime = createLocalInferencePrototype({
      executablePath: "llama-server",
      modelPath: "/tmp/model.gguf",
      modelExists: () => true,
      verifyModelArtifact: async () => true,
      getRuntimeVersion: async () => "version: 9910 (f5525f7e7)",
      spawnHelper: () => ({
        kill: () => true,
        once: (event, callback) => { listeners[event] = callback as (...args: never[]) => void; },
      }),
      fetch: async () => new Response("loading", { status: 503 }),
    });

    const starting = runtime.start();
    await Bun.sleep(0);
    listeners.error?.();
    listeners.exit?.();
    await starting;

    expect(runtime.getStatus()).toEqual({
      status: "unavailable",
      modelId: "qwen2.5-3b-instruct-q4_k_m",
      reason: "helper_start_failed",
    });
    runtime.stop();
  });

  it("cancels artifact verification when stopped during startup", async () => {
    let verificationSignal: AbortSignal | undefined;
    const runtime = createLocalInferencePrototype({
      executablePath: "llama-server",
      modelPath: "/tmp/model.gguf",
      modelExists: () => true,
      verifyModelArtifact: (_path, _sha, signal) => {
        verificationSignal = signal;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
    });

    const starting = runtime.start();
    await Bun.sleep(0);
    runtime.stop();

    expect(verificationSignal?.aborted).toBe(true);
    expect(runtime.getStatus()).toEqual({ status: "stopped" });
    await starting;
  });

  it("withholds contract-invalid model output", async () => {
    const runtime = createLocalInferencePrototype({
      executablePath: "llama-server",
      modelPath: "/tmp/model.gguf",
      modelExists: () => true,
      verifyModelArtifact: async () => true,
      getRuntimeVersion: async () => "version: 9910 (f5525f7e7)",
      spawnHelper: () => ({ kill: () => true, once: () => {} }),
      fetch: async (input) => String(input).endsWith("/health")
        ? new Response("ok")
        : completionStream("Sure, here is the continuation"),
    });
    await runtime.start();

    expect(await runtime.getSuggestion(requestableSnapshot())).toBeNull();
    runtime.stop();
  });

  it("reads streamed OpenAI-compatible chat completion events", async () => {
    const runtime = createLocalInferencePrototype({
      executablePath: "llama-server",
      modelPath: "/tmp/model.gguf",
      modelExists: () => true,
      verifyModelArtifact: async () => true,
      getRuntimeVersion: async () => "version: 9910 (f5525f7e7)",
      spawnHelper: () => ({ kill: () => true, once: () => {} }),
      fetch: async (input) => String(input).endsWith("/health")
        ? new Response("ok")
        : chatCompletionStream("world peace"),
    });
    await runtime.start();

    expect((await runtime.getSuggestion(requestableSnapshot()))?.text).toBe(" world peace");
    runtime.stop();
  });

  it("withholds secret-like context before sending an inference request", async () => {
    let inferenceRequests = 0;
    const runtime = createLocalInferencePrototype({
      executablePath: "llama-server",
      modelPath: "/tmp/model.gguf",
      modelExists: () => true,
      verifyModelArtifact: async () => true,
      getRuntimeVersion: async () => "version: 9910 (f5525f7e7)",
      spawnHelper: () => ({ kill: () => true, once: () => {} }),
      fetch: async (input) => {
        if (String(input).endsWith("/health")) return new Response("ok");
        inferenceRequests += 1;
        return completionStream(" value");
      },
    });
    await runtime.start();

    expect(await runtime.getSuggestion(requestableSnapshot("my password is hunter2"))).toBeNull();
    expect(inferenceRequests).toBe(0);
    runtime.stop();
  });
});
