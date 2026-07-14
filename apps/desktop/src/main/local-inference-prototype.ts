import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import type { PersonalMemory, Suggestion } from "@tab/contracts";
import {
  createSuggestionMessages,
  isSuggestionContractValid,
  MAX_SUGGESTION_TOKENS,
  normalizeGeneratedSuggestion,
} from "@tab/suggestion-policy";
import type { SuggestionSource } from "./suggestion-source.ts";

export type LocalModelConfiguration = {
  readonly id: string;
  readonly modelRevision: string;
  readonly artifactSha256: string;
  readonly runtimeVersion: string;
  readonly runtimeCommit: string;
  readonly maxTokens: number;
  readonly temperature: number;
};

export const QWEN_25_3B_Q4_K_M: LocalModelConfiguration = {
  id: "qwen2.5-3b-instruct-q4_k_m",
  modelRevision: "7dabda4d13d513e3e842b20f0d435c732f172cbe",
  artifactSha256: "626b4a6678b86442240e33df819e00132d3ba7dddfe1cdc4fbb18e0a9615c62d",
  runtimeVersion: "9910",
  runtimeCommit: "f5525f7e7",
  maxTokens: MAX_SUGGESTION_TOKENS,
  temperature: 0.3,
} as const;

export type LocalInferenceUnavailableReason =
  | "missing_model"
  | "download_failed"
  | "artifact_mismatch"
  | "runtime_mismatch"
  | "helper_start_failed"
  | "helper_readiness_timeout"
  | "helper_exited"
  | "request_failed";

export type LocalInferenceStatus =
  | { readonly status: "stopped" }
  | { readonly status: "downloading"; readonly modelId: string; readonly progress: number | null }
  | { readonly status: "starting"; readonly modelId: string }
  | { readonly status: "ready"; readonly modelId: string }
  | {
      readonly status: "unavailable";
      readonly modelId: string;
      readonly reason: LocalInferenceUnavailableReason;
    };

export type LocalInferenceTiming = {
  readonly firstTextMs: number | null;
  readonly totalMs: number;
  readonly promptTokens?: number;
  readonly promptMs?: number;
  readonly predictedTokens?: number;
  readonly predictedMs?: number;
  readonly promptCacheHit?: boolean;
};

type HelperProcess = {
  readonly pid?: number;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: "exit", callback: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  once(event: "error", callback: (error: Error) => void): void;
};

type SpawnHelper = (
  executable: string,
  args: string[],
  options: { stdio: "ignore" },
) => HelperProcess;

export type LocalInferencePrototypeOptions = {
  readonly executablePath: string;
  readonly modelPath: string;
  readonly modelUrl?: string;
  readonly port?: number;
  readonly readinessTimeoutMs?: number;
  readonly model?: LocalModelConfiguration;
  readonly onStatusChange?: (status: LocalInferenceStatus) => void;
  readonly onDiagnostic?: (event: string, details: Record<string, unknown>) => void;
  readonly getMemories?: () => readonly PersonalMemory[];
  readonly getCustomWritingInstructions?: () => string | undefined;
  readonly spawnHelper?: SpawnHelper;
  readonly fetch?: typeof globalThis.fetch;
  readonly modelExists?: (path: string) => boolean;
  readonly verifyModelArtifact?: (path: string, expectedSha256: string, signal?: AbortSignal) => Promise<boolean>;
  readonly getRuntimeVersion?: (executablePath: string, signal?: AbortSignal) => Promise<string>;
  readonly apiKey?: string;
};

const execFileAsync = promisify(execFile);

const SECRET_LIKE_CONTEXT_PATTERNS = [
  /\bpassword\s+(?:is|=|:)\s*\S+/iu,
  /\bapi[_ -]?key\s+(?:is|=|:)\s*\S+/iu,
  /\brecovery\s+code\s+(?:is|=|:)\s*\S+/iu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\b(?:card number|security code)\s+(?:is|=|:)\s*[\d -]+/iu,
  /\b(?:one-time|one time|otp)\s+(?:login\s+)?code\s+(?:is|=|:)\s*\d+/iu,
  /\b(?:social security number|ssn)\s+(?:is|=|:)\s*\d{3}[- ]?\d{2}[- ]?\d{4}/iu,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@]+:[^\s@]+@[^\s]+/iu,
  /\b(?:access token|encryption secret)\s+(?:is|=|:)\s*\S+/iu,
];

export function createLocalInferencePrototype(options: LocalInferencePrototypeOptions) {
  const model = options.model ?? QWEN_25_3B_Q4_K_M;
  const port = options.port ?? 39_281;
  const baseUrl = `http://127.0.0.1:${port}`;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const spawnHelper = options.spawnHelper ?? (spawn as unknown as SpawnHelper);
  const modelExists = options.modelExists ?? existsSync;
  const verifyModelArtifact = options.verifyModelArtifact ?? verifySha256;
  const getRuntimeVersion = options.getRuntimeVersion ?? readRuntimeVersion;
  const apiKey = options.apiKey ?? crypto.randomUUID();
  let status: LocalInferenceStatus = { status: "stopped" };
  let helper: HelperProcess | null = null;
  let startup: Promise<void> | null = null;
  let download: Promise<void> | null = null;
  let startupController = new AbortController();
  let stopping = false;
  let lastTiming: LocalInferenceTiming | null = null;

  function contextId(contextHash: string): string {
    return createHash("sha256").update(contextHash).digest("hex").slice(0, 12);
  }

  function publish(next: LocalInferenceStatus): void {
    status = next;
    options.onDiagnostic?.("status_changed", next);
    options.onStatusChange?.(next);
  }

  function markUnavailable(reason: LocalInferenceUnavailableReason): void {
    publish({ status: "unavailable", modelId: model.id, reason });
  }

  async function waitUntilReady(child: HelperProcess, controller: AbortController): Promise<void> {
    const deadline = Date.now() + (options.readinessTimeoutMs ?? 30_000);
    while (Date.now() < deadline) {
      if (stopping) return;
      if (status.status === "unavailable") return;
      try {
        const response = await fetchImpl(`${baseUrl}/health`, {
          headers: { authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(500),
          ]),
        });
        if (response.ok && !stopping && helper === child && status.status === "starting") {
          publish({ status: "ready", modelId: model.id });
          return;
        }
      } catch {
        // The helper is still loading. Readiness timeout owns the durable failure state.
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (stopping) return;
    if (helper === child) {
      child.kill("SIGTERM");
      helper = null;
    }
    markUnavailable("helper_readiness_timeout");
  }

  async function start(): Promise<void> {
    if (startup) return startup;
    if (status.status === "ready" || status.status === "starting") return;

    startup = (async () => {
      if (!modelExists(options.modelPath)) {
        markUnavailable("missing_model");
        return;
      }

      publish({ status: "starting", modelId: model.id });
      stopping = false;
      const controller = new AbortController();
      startupController = controller;
      const artifactMatches = await (
        options.verifyModelArtifact
          ? verifyModelArtifact(options.modelPath, model.artifactSha256, controller.signal)
          : verifyCachedArtifact(options.modelPath, model, verifyModelArtifact, controller.signal)
      ).catch(() => false);
      if (stopping) return;
      if (!artifactMatches) {
        markUnavailable("artifact_mismatch");
        return;
      }
      const runtimeVersion = await getRuntimeVersion(options.executablePath, controller.signal).catch(() => "");
      if (stopping) return;
      if (!hasExactRuntimeIdentity(runtimeVersion, model)) {
        markUnavailable("runtime_mismatch");
        return;
      }
      try {
        const child = spawnHelper(options.executablePath, [
          "--model", options.modelPath,
          "--host", "127.0.0.1",
          "--port", String(port),
          "--ctx-size", "2048",
          "--parallel", "1",
          "--n-predict", String(model.maxTokens),
          "--gpu-layers", "all",
          "--flash-attn", "on",
          "--cache-prompt",
          "--no-webui",
          "--log-disable",
          "--api-key", apiKey,
        ], { stdio: "ignore" });
        helper = child;
        let terminalEventHandled = false;
        const handleTerminalEvent = (reason: "helper_start_failed" | "helper_exited") => {
          if (terminalEventHandled) return;
          terminalEventHandled = true;
          if (helper === child) helper = null;
          if (!stopping) markUnavailable(reason);
        };
        child.once("exit", () => handleTerminalEvent("helper_exited"));
        child.once("error", () => handleTerminalEvent("helper_start_failed"));

        await waitUntilReady(child, controller);
      } catch {
        markUnavailable("helper_start_failed");
      }
    })().finally(() => {
      startup = null;
    });

    return startup;
  }

  async function downloadModel(): Promise<void> {
    if (download) return download;
    const modelUrl = options.modelUrl;
    if (!modelUrl) throw new Error("No model download URL is configured");

    download = (async () => {
      const temporaryPath = `${options.modelPath}.download`;
      publish({ status: "downloading", modelId: model.id, progress: null });
      try {
        await mkdir(dirname(options.modelPath), { recursive: true });
        await rm(temporaryPath, { force: true });
        const response = await fetchImpl(modelUrl);
        if (!response.ok || !response.body) throw new Error(`Model download failed (${response.status})`);

        const totalBytes = Number(response.headers.get("content-length")) || null;
        let downloadedBytes = 0;
        let lastPublishedPercent = -1;
        const progress = new Transform({
          transform(chunk, _encoding, callback) {
            downloadedBytes += chunk.length;
            if (totalBytes) {
              const downloadProgress = Math.min(downloadedBytes / totalBytes, 1);
              const displayPercent = Math.round(downloadProgress * 100);
              if (displayPercent !== lastPublishedPercent) {
                lastPublishedPercent = displayPercent;
                publish({
                  status: "downloading",
                  modelId: model.id,
                  progress: downloadProgress,
                });
              }
            }
            callback(null, chunk);
          },
        });
        await pipeline(Readable.fromWeb(response.body as never), progress, createWriteStream(temporaryPath));
        if (!await verifyModelArtifact(temporaryPath, model.artifactSha256)) {
          throw new Error("Downloaded model failed integrity verification");
        }
        await rename(temporaryPath, options.modelPath);
        await writeVerificationMarker(options.modelPath, model);
        await start();
      } catch (error) {
        await rm(temporaryPath, { force: true });
        markUnavailable("download_failed");
        throw error;
      }
    })().finally(() => {
      download = null;
    });
    return download;
  }

  const getSuggestion: SuggestionSource = async (snapshot, requestOptions) => {
    if (SECRET_LIKE_CONTEXT_PATTERNS.some((pattern) => pattern.test(snapshot.sanitizedContext))) {
      options.onDiagnostic?.("request_skipped", {
        reason: "secret_like_context",
        contextId: contextId(snapshot.contextHash),
        contextLength: snapshot.sanitizedContext.length,
      });
      return null;
    }
    if (status.status !== "ready") {
      options.onDiagnostic?.("request_skipped", {
        reason: "local_inference_not_ready",
        status: status.status,
        contextId: contextId(snapshot.contextHash),
      });
      throw new Error("Local inference is unavailable");
    }

    const promptInput = {
      typingContext: snapshot.sanitizedContext,
      contextSource: snapshot.contextSource,
      activeApplication: snapshot.activeApplication,
      memories: options.getMemories?.() ?? [],
      appContext: snapshot.appContext,
      customWritingInstructions: options.getCustomWritingInstructions?.(),
    };
    const messages = createSuggestionMessages(promptInput);
    options.onDiagnostic?.("request_started", {
      contextId: contextId(snapshot.contextHash),
      contextLength: snapshot.sanitizedContext.length,
      contextSource: snapshot.contextSource,
      activeApplication: snapshot.activeApplication.bundleId,
      messageCount: messages.length,
      memoryCount: promptInput.memories.length,
      appContextFragmentCount: promptInput.appContext?.fragments.length ?? 0,
      customWritingInstructionsLength:
        promptInput.customWritingInstructions?.length ?? 0,
      modelId: model.id,
      maxTokens: model.maxTokens,
      temperature: model.temperature,
      stream: true,
      cachePrompt: true,
    });

    try {
      const startedAt = performance.now();
      const suggestionId = `sg-local-${crypto.randomUUID()}`;
      const response = await fetchImpl(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          messages,
          max_tokens: model.maxTokens,
          temperature: model.temperature,
          stream: true,
          cache_prompt: true,
          chat_template_kwargs: { enable_thinking: false },
        }),
        signal: requestOptions?.signal,
      });
      if (!response.ok) throw new Error("Local inference request failed");

      if (!response.body) throw new Error("Local inference response was not streamable");
      const lastValidPartial: { current: Suggestion | null } = { current: null };
      const streamed = await readCompletionStream(response.body, startedAt, (partialText) => {
        const text = normalizeGeneratedSuggestion(snapshot.sanitizedContext, partialText);
        if (!isSuggestionContractValid(snapshot.sanitizedContext, text)) return;
        lastValidPartial.current = {
          id: suggestionId,
          text,
        };
      });
      const rawText = streamed.text;
      lastTiming = streamed.timing;
      const text = normalizeGeneratedSuggestion(snapshot.sanitizedContext, rawText);
      if (!isSuggestionContractValid(snapshot.sanitizedContext, text)) {
        if (lastValidPartial.current) {
          options.onDiagnostic?.("request_completed", {
            contextId: contextId(snapshot.contextHash),
            suggestionLength: lastValidPartial.current.text.length,
            recoveredFromInvalidFinal: true,
            ...streamed.timing,
          });
          return lastValidPartial.current;
        }
        options.onDiagnostic?.("request_empty", {
          reason: "invalid_suggestion_contract",
          contextId: contextId(snapshot.contextHash),
          rawOutputLength: rawText.length,
          normalizedOutputLength: text.length,
          ...streamed.timing,
        });
        return null;
      }

      options.onDiagnostic?.("request_completed", {
        contextId: contextId(snapshot.contextHash),
        suggestionLength: text.length,
        ...streamed.timing,
      });

      return { id: suggestionId, text } satisfies Suggestion;
    } catch (error) {
      if (requestOptions?.signal?.aborted) {
        options.onDiagnostic?.("request_aborted", { contextId: contextId(snapshot.contextHash) });
        return null;
      }
      options.onDiagnostic?.("request_failed", {
        contextId: contextId(snapshot.contextHash),
        error: error instanceof Error ? error.message : String(error),
      });
      helper?.kill("SIGTERM");
      helper = null;
      markUnavailable("request_failed");
      throw error;
    }
  };

  function stop(): void {
    stopping = true;
    startupController.abort();
    helper?.kill("SIGTERM");
    helper = null;
    publish({ status: "stopped" });
  }

  return {
    start,
    downloadModel,
    stop,
    getSuggestion,
    getStatus: (): LocalInferenceStatus => status,
    getLastTiming: (): LocalInferenceTiming | null => lastTiming,
  };
}

type VerificationMarker = {
  readonly sha256: string;
  readonly revision: string;
  readonly size: number;
  readonly mtimeMs: number;
};

function verificationMarkerPath(modelPath: string): string {
  return `${modelPath}.verified.json`;
}

async function writeVerificationMarker(modelPath: string, model: LocalModelConfiguration): Promise<void> {
  const metadata = await stat(modelPath);
  const marker: VerificationMarker = {
    sha256: model.artifactSha256,
    revision: model.modelRevision,
    size: metadata.size,
    mtimeMs: metadata.mtimeMs,
  };
  await writeFile(verificationMarkerPath(modelPath), JSON.stringify(marker), { mode: 0o600 });
}

async function verifyCachedArtifact(
  modelPath: string,
  model: LocalModelConfiguration,
  verify: (path: string, expectedSha256: string, signal?: AbortSignal) => Promise<boolean>,
  signal?: AbortSignal,
): Promise<boolean> {
  const metadata = await stat(modelPath);
  try {
    const marker = JSON.parse(await readFile(verificationMarkerPath(modelPath), "utf8")) as Partial<VerificationMarker>;
    if (
      marker.sha256 === model.artifactSha256
      && marker.revision === model.modelRevision
      && marker.size === metadata.size
      && marker.mtimeMs === metadata.mtimeMs
    ) {
      return true;
    }
  } catch {
    // First launch or changed artifact: perform the full verification once.
  }

  if (!await verify(modelPath, model.artifactSha256, signal)) return false;
  await writeVerificationMarker(modelPath, model);
  return true;
}

async function readCompletionStream(
  body: ReadableStream<Uint8Array>,
  startedAt: number,
  onFirstUsableText: (text: string) => void,
): Promise<{ text: string; timing: LocalInferenceTiming }> {
  let pending = "";
  let text = "";
  let firstTextMs: number | null = null;
  let terminalPayload: Record<string, unknown> | null = null;
  let emittedPartial = false;

  const reader = body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += Buffer.from(value).toString("utf8");
    const events = pending.split("\n\n");
    pending = events.pop() ?? "";
    for (const event of events) {
      const data = event.split("\n").find((line) => line.startsWith("data: "));
      if (!data) continue;
      const serialized = data.slice(6);
      if (serialized === "[DONE]") continue;
      const payload = JSON.parse(serialized) as Record<string, unknown>;
      const content = completionEventContent(payload);
      if (content.length > 0) {
        firstTextMs ??= performance.now() - startedAt;
        text += content;
        if (!emittedPartial) {
          const firstWord = firstCompleteWord(text);
          if (firstWord) {
            emittedPartial = true;
            onFirstUsableText(firstWord);
          }
        }
      }
      if (payload.stop === true || completionEventFinished(payload)) terminalPayload = payload;
    }
  }

  const timings = terminalPayload?.timings;
  const timingRecord = timings && typeof timings === "object" ? timings as Record<string, unknown> : null;
  return {
    text,
    timing: {
      firstTextMs: firstTextMs === null ? null : Math.round(firstTextMs),
      totalMs: Math.round(performance.now() - startedAt),
      ...(typeof timingRecord?.prompt_n === "number" ? { promptTokens: timingRecord.prompt_n } : {}),
      ...(typeof timingRecord?.prompt_ms === "number" ? { promptMs: Math.round(timingRecord.prompt_ms) } : {}),
      ...(typeof timingRecord?.predicted_n === "number" ? { predictedTokens: timingRecord.predicted_n } : {}),
      ...(typeof timingRecord?.predicted_ms === "number" ? { predictedMs: Math.round(timingRecord.predicted_ms) } : {}),
      ...(typeof terminalPayload?.tokens_cached === "number" ? { promptCacheHit: terminalPayload.tokens_cached > 0 } : {}),
    },
  };
}

function completionEventContent(payload: Record<string, unknown>): string {
  if (typeof payload.content === "string") return payload.content;
  const choices = payload.choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return "";
  const delta = Reflect.get(choices[0], "delta");
  if (!delta || typeof delta !== "object") return "";
  const content = Reflect.get(delta, "content");
  return typeof content === "string" ? content : "";
}

function completionEventFinished(payload: Record<string, unknown>): boolean {
  const choices = payload.choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return false;
  return Reflect.get(choices[0], "finish_reason") != null;
}

function firstCompleteWord(text: string): string | null {
  const beforeAnotherWord = text.match(/^(\s*\S+)(?=\s+\S)/u)?.[1];
  if (beforeAnotherWord) return beforeAnotherWord;
  return /[.!?,;:]$/u.test(text.trim()) ? text : null;
}

async function verifySha256(path: string, expectedSha256: string, signal?: AbortSignal): Promise<boolean> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk);
  return hash.digest("hex") === expectedSha256;
}

async function readRuntimeVersion(executablePath: string, signal?: AbortSignal): Promise<string> {
  const { stdout, stderr } = await execFileAsync(executablePath, ["--version"], { signal });
  return `${stdout}\n${stderr}`;
}

function hasExactRuntimeIdentity(output: string, model: LocalModelConfiguration): boolean {
  const version = escapeRegExp(model.runtimeVersion);
  const commit = escapeRegExp(model.runtimeCommit);
  return new RegExp(`(?<!\\d)${version}(?!\\d)`, "u").test(output)
    && new RegExp(`(?<![0-9a-f])${commit}(?![0-9a-f])`, "iu").test(output);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
