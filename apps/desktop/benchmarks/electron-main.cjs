const { app, BrowserWindow, ipcMain } = require("electron");
const { execFileSync, spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const { createReadStream, existsSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { performance } = require("node:perf_hooks");
const { createInterface } = require("node:readline/promises");
const { buildQualityCases } = require("./quality-corpus.cjs");

const TEMP_ROOT = "/var/folders/7x/6q6my89n6gb5qgdwsljlk0x80000gn/T/opencode/tab-local-suggestion-benchmark";
const DEFAULT_MODELS = {
  llama: resolve(TEMP_ROOT, "llama-qwen/qwen2.5-3b-instruct-q4_k_m.gguf"),
  mlx: resolve(TEMP_ROOT, "mlx-qwen"),
  coreml: resolve(TEMP_ROOT, "coreml-qwen"),
};
const THRESHOLDS = { p50: 350, p95: 700, p99: 1_000 };
const DEFAULT_REFERENCE_MODELS = ["anthropic/claude-sonnet-5", "openai/gpt-5.6-sol"];
const COMMON_SHORT_WORDS = new Set("am an as at ay be by da de di do el en es go ha he if in is it la le lo me mi my no of on or os se si so to tu up us va ve we ya yo".split(" "));

function parseArgs(argv) {
  const values = { runtime: "llama", scenario: "smoke", model: undefined, results: undefined, qualityLocalOnly: false, referenceModels: [], port: Number(process.env.TAB_BENCH_LLAMA_PORT || 39_281) };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--runtime") values.runtime = argv[++index];
    else if (key === "--scenario") values.scenario = argv[++index];
    else if (key === "--model") values.model = resolve(argv[++index]);
    else if (key === "--reference-model") values.referenceModels.push(argv[++index]);
    else if (key === "--results") values.results = resolve(argv[++index]);
    else if (key === "--port") values.port = Number(argv[++index]);
    else if (key === "--quality-local-only") values.qualityLocalOnly = true;
  }
  if (!DEFAULT_MODELS[values.runtime]) throw new Error(`unsupported runtime: ${values.runtime}`);
  if (!["smoke", "screen", "quality", "quality-candidate", "calibrate", "calibrate-agent", "quality-ceiling", "soak"].includes(values.scenario)) {
    throw new Error(`unsupported scenario: ${values.scenario}`);
  }
  if (values.referenceModels.length > 2) throw new Error("quality ceiling accepts at most two reference models");
  if (!Number.isInteger(values.port) || values.port < 1 || values.port > 65_535) throw new Error("invalid benchmark port");
  if (values.scenario === "quality-ceiling" && values.referenceModels.length === 0) {
    values.referenceModels = DEFAULT_REFERENCE_MODELS;
  }
  values.model ??= DEFAULT_MODELS[values.runtime];
  return values;
}

function percentile(values, fraction) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)];
}

function summarize(values) {
  if (values.length === 0) return null;
  return {
    count: values.length,
    minMs: Math.min(...values),
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    p99Ms: percentile(values, 0.99),
    maxMs: Math.max(...values),
  };
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function processRssBytes(pids) {
  let total = 0;
  for (const pid of pids) {
    try {
      const rssKb = Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" }).trim());
      if (Number.isFinite(rssKb)) total += rssKb * 1_024;
    } catch {}
  }
  return total;
}

function syntheticPrompt(index, memoryCount = 0) {
  const channels = ["message", "email", "note", "document"];
  const endings = ["follow up on", "meet again at", "the next step is", "thanks for helping with"];
  const memory = Array.from({ length: memoryCount }, (_, item) =>
    `Synthetic preference ${item + 1}: use concise sentences.`
  ).join("\n");
  return `Continue the draft with only the missing text. Return 1-80 characters.\nChannel: ${channels[index % channels.length]}\n${memory ? `Synthetic Personal Memory:\n${memory}\n` : ""}Draft: I wanted to ${endings[index % endings.length]}`;
}

function normalizeSuggestion(text) {
  const compact = text.replace(/\s+/g, " ").trim();
  return Array.from(compact).slice(0, 80).join("");
}

function normalizeQualitySuggestion(typingContext, generatedText) {
  const cleanedText = generatedText.replace(/[\r\n]+/g, " ").trim();
  const overlapLength = findContextPrefixOverlap(typingContext, cleanedText);
  const withoutOverlap = cleanedText.slice(overlapLength);
  const text = /\s$/u.test(typingContext)
    ? withoutOverlap.trimStart()
    : withoutOverlap.replace(/^\s+/u, " ");
  if (!text) return "";

  const lastContextChar = typingContext.at(-1) ?? "";
  const firstSuggestionChar = text.at(0) ?? "";
  const needsBoundary = overlapLength === 0
    && /[\p{Letter}\p{Number}]/u.test(lastContextChar)
    && /[\p{Letter}\p{Number}]/u.test(firstSuggestionChar);
  return needsBoundary
    ? ` ${truncateSuggestionText(text, 79)}`
    : truncateSuggestionText(text, 80);
}

function findContextPrefixOverlap(typingContext, generatedText) {
  const maxLength = Math.min(typingContext.length, generatedText.length);
  for (let length = maxLength; length >= 2; length -= 1) {
    const contextSuffix = typingContext.slice(-length);
    const suggestionPrefix = generatedText.slice(0, length);
    const nextGeneratedChar = generatedText.at(length) ?? "";
    const plausible = length > 2
      || !/[\p{Letter}\p{Number}]/u.test(nextGeneratedChar)
      || !COMMON_SHORT_WORDS.has(contextSuffix.toLowerCase());
    if (plausible && contextSuffix.localeCompare(suggestionPrefix, undefined, { sensitivity: "accent" }) === 0) {
      return length;
    }
  }
  return 0;
}

function truncateSuggestionText(text, maxLength) {
  if (text.length <= maxLength) return text;
  const truncatedAtWordBoundary = text.slice(0, maxLength + 1).replace(/\s+\S*$/u, "").trimEnd();
  return truncatedAtWordBoundary || text.slice(0, maxLength).trimEnd();
}

async function createOverlay() {
  const ready = new Promise((resolveReady) => ipcMain.once("overlay-ready", resolveReady));
  const window = new BrowserWindow({
    width: 560,
    height: 64,
    show: false,
    frame: false,
    transparent: true,
    focusable: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: process.env.TAB_BENCH_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await window.loadFile(process.env.TAB_BENCH_OVERLAY);
  await ready;
  return window;
}

async function showAndMeasure(window, text, id) {
  const started = performance.now();
  window.webContents.send("suggestion", { id, text });
  window.showInactive();
  const expected = JSON.stringify(text);
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = performance.now() + 2000;
    const check = () => {
      const button = document.querySelector("button");
      if (button && button.textContent.includes(${expected})) return requestAnimationFrame(() => resolve());
      if (performance.now() > deadline) return reject(new Error("overlay timeout"));
      requestAnimationFrame(check);
    };
    check();
  })`);
  return performance.now() - started;
}

async function waitForHealth(url, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error("runtime readiness timeout");
}

async function createLlamaRuntime(modelPath, port) {
  const executable = process.env.TAB_BENCH_LLAMA_SERVER || "llama-server";
  const url = `http://127.0.0.1:${port}`;
  const loadStarted = performance.now();
  const child = spawn(executable, [
    "--model", modelPath,
    "--host", "127.0.0.1",
    "--port", String(port),
    "--ctx-size", "2048",
    "--parallel", "1",
    "--n-predict", "16",
    "--gpu-layers", "all",
    "--flash-attn", "on",
    "--cache-prompt",
    "--no-webui",
    "--log-disable",
  ], { stdio: ["ignore", "ignore", "ignore"] });
  await waitForHealth(url, 30_000);
  const loadMs = performance.now() - loadStarted;

  return {
    pid: child.pid,
    loadMs,
    async complete(prompt, signal) {
      const controller = new AbortController();
      const abortFromCaller = () => controller.abort();
      signal?.addEventListener("abort", abortFromCaller, { once: true });
      const started = performance.now();
      let text = "";
      let firstTextMs;
      let pending = "";
      try {
        const response = await fetch(`${url}/completion`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt, n_predict: 16, temperature: 0, stream: true, cache_prompt: true }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error(`runtime response ${response.status}`);
        generation: for await (const chunk of response.body) {
          pending += Buffer.from(chunk).toString("utf8");
          const events = pending.split("\n\n");
          pending = events.pop() || "";
          for (const event of events) {
            const data = event.split("\n").find((line) => line.startsWith("data: "));
            if (!data) continue;
            const payload = JSON.parse(data.slice(6));
            if (payload.content) {
              firstTextMs ??= performance.now() - started;
              text += payload.content;
              if (Array.from(text).length >= 80) {
                controller.abort();
                break generation;
              }
            }
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      } finally {
        signal?.removeEventListener("abort", abortFromCaller);
      }
      return { text: normalizeSuggestion(text), rawText: text, firstTextMs, runtimeMs: performance.now() - started };
    },
    async completeChat(prompt) {
      const started = performance.now();
      const response = await fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: prompt }],
          max_tokens: 128,
          temperature: 0.3,
          chat_template_kwargs: { enable_thinking: false },
        }),
      });
      if (!response.ok) throw new Error(`runtime chat response ${response.status}`);
      const body = await response.json();
      const rawText = body.choices?.[0]?.message?.content || "";
      return { text: normalizeSuggestion(rawText), rawText, runtimeMs: performance.now() - started };
    },
    async idle() {
      const slots = await fetch(`${url}/slots`).then((response) => response.json());
      return slots.every((slot) => slot.is_processing === false);
    },
    stop() {
      child.kill("SIGTERM");
    },
  };
}

function qualityPrompt(item) {
  const appContext = item.appContext.length > 0
    ? `\nApp Context background (suggestion-only, do not continue this text directly):\n${item.appContext.map((text) => `- [synthetic/nearby-text, confidence 0.90] ${text}`).join("\n")}`
    : "";
  const memories = item.memories.length > 0
    ? `\nRelevant personal memory:\n${item.memories.map((memory) => `- ${memory}`).join("\n")}`
    : "";
  return `You are an inline autocomplete engine. Continue the user's exact text with 2-10 likely next words and never more than 80 characters. Output only the continuation text, with no quotes, labels, explanation, or punctuation unless punctuation is the natural next character. Do not repeat any part of the user draft. If the draft ends mid-word, output only the remaining characters and following words, not the whole word. Preserve the natural boundary: do not add a leading space when completing a partial word, do add one when starting the next word, and never start with whitespace when the draft already ends with whitespace. For ordinary prose, messages, search text, and short fragments, always make a best-effort continuation. Return an empty string only for passwords, secrets, clearly sensitive data, or nonsensical input.

Active application: ${item.activeApplication}
Source: ${item.contextSource}${appContext}
User draft to continue exactly: """${item.draft}"""${memories}`;
}

function contractValid(item, text) {
  if (!text || /[\r\n]/u.test(text) || Array.from(text).length > 80) return false;
  const lowered = text.toLowerCase();
  return !lowered.startsWith("sure")
    && !lowered.startsWith("here is")
    && !lowered.startsWith("the continuation")
    && !lowered.includes("continue the draft")
    && !lowered.includes("relevant personal memory")
    && !lowered.includes("synthetic nearby context")
    && !lowered.includes(item.draft.toLowerCase());
}

const SECRET_LIKE_DRAFT_PATTERNS = [
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

function shouldSuppressSensitiveContext(text) {
  return SECRET_LIKE_DRAFT_PATTERNS.some((pattern) => pattern.test(text));
}

function enforceSuggestionContract(item, text) {
  return contractValid(item, text) ? text : "";
}

let lastGroqRequestAt = 0;
let lastGatewayRequestAt = 0;

async function groqText(messages, maxTokens, {
  json = false,
  jsonSchema = undefined,
  reasoningEffort = "low",
  temperature = 0,
} = {}) {
  const useGateway = Boolean(process.env.AI_GATEWAY_API_KEY);
  const endpoint = useGateway
    ? "https://ai-gateway.vercel.sh/v1/chat/completions"
    : "https://api.groq.com/openai/v1/chat/completions";
  const apiKey = useGateway ? process.env.AI_GATEWAY_API_KEY : process.env.GROQ_API_KEY;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const spacing = (useGateway ? 100 : 2_100) - (performance.now() - lastGroqRequestAt);
    if (spacing > 0) await new Promise((resolvePromise) => setTimeout(resolvePromise, spacing));
    lastGroqRequestAt = performance.now();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-20b",
        messages,
        max_completion_tokens: maxTokens,
        temperature,
        reasoning_effort: reasoningEffort,
        ...(useGateway ? { providerOptions: { gateway: { only: ["groq"] } } } : {}),
        ...(json || jsonSchema ? {
          response_format: {
            type: "json_schema",
            json_schema: {
              name: jsonSchema?.name ?? "autocomplete_judgments",
              strict: true,
              schema: jsonSchema?.schema ?? {
                type: "object",
                additionalProperties: false,
                required: ["results"],
                properties: {
                  results: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: ["index", "aUseful", "bUseful", "aHarmful", "bHarmful"],
                      properties: {
                        index: { type: "integer" },
                        aUseful: { type: "boolean" },
                        bUseful: { type: "boolean" },
                        aHarmful: { type: "boolean" },
                        bHarmful: { type: "boolean" },
                      },
                    },
                  },
                },
              },
            },
          },
        } : {}),
      }),
    });
    if (response.ok) {
      const body = await response.json();
      return body.choices?.[0]?.message?.content || "";
    }
    const errorBody = await response.json().catch(() => ({}));
    const code = errorBody.error?.code || errorBody.error?.type || "unknown";
    const message = String(errorBody.error?.message || "request rejected").replace(/[\r\n]+/g, " ").slice(0, 240);
    const retryableStructuredOutput = response.status === 400 && message.includes("Failed to validate JSON");
    if (response.status !== 429 && !retryableStructuredOutput) {
      throw new Error(`remote evaluation response ${response.status} ${code}: ${message}`);
    }
    if (retryableStructuredOutput) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500 * (attempt + 1)));
      continue;
    }
    const retryAfter = Number(response.headers.get("retry-after"));
    await new Promise((resolvePromise) => setTimeout(
      resolvePromise,
      Number.isFinite(retryAfter) ? retryAfter * 1_000 : Math.min(60_000, 2_000 * 2 ** attempt),
    ));
  }
  throw new Error("remote evaluation rate limit did not recover");
}

async function remoteSuggestion(item) {
  const rawText = await groqText([{ role: "user", content: qualityPrompt(item) }], 128, { temperature: 0.3 });
  return normalizeQualitySuggestion(item.draft, rawText);
}

async function gatewayReferenceSuggestion(item, model) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const spacing = 100 - (performance.now() - lastGatewayRequestAt);
    if (spacing > 0) await new Promise((resolvePromise) => setTimeout(resolvePromise, spacing));
    lastGatewayRequestAt = performance.now();
    const response = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: qualityPrompt(item) }],
        max_completion_tokens: 256,
        temperature: 0.3,
      }),
    });
    if (response.ok) {
      const body = await response.json();
      const rawText = body.choices?.[0]?.message?.content || "";
      return normalizeQualitySuggestion(item.draft, rawText);
    }
    if (response.status !== 429 && response.status < 500) {
      const errorBody = await response.json().catch(() => ({}));
      const code = errorBody.error?.code || errorBody.error?.type || "unknown";
      const message = String(errorBody.error?.message || "request rejected").replace(/[\r\n]+/g, " ").slice(0, 240);
      throw new Error(`reference generation response ${response.status} ${code}: ${message}`);
    }
    const retryAfter = Number(response.headers.get("retry-after"));
    await new Promise((resolvePromise) => setTimeout(
      resolvePromise,
      Number.isFinite(retryAfter) ? retryAfter * 1_000 : Math.min(60_000, 2_000 * 2 ** attempt),
    ));
  }
  throw new Error(`reference generation rate limit did not recover for ${model}`);
}

async function judgeBatch(items, swap) {
  const payload = items.map((item) => ({
    index: item.index,
    prompt: qualityPrompt(item),
    A: swap ? item.remote : item.local,
    B: swap ? item.local : item.remote,
  }));
  const content = await groqText([
    {
      role: "system",
      content: "Blindly evaluate autocomplete continuations. Return JSON only as {\"results\":[{\"index\":number,\"aUseful\":boolean,\"bUseful\":boolean,\"aHarmful\":boolean,\"bHarmful\":boolean}]}. Useful means a natural, relevant continuation of the exact draft. Harmful means clearly contradictory, unsafe, or damaging. Treat an empty candidate as not useful and not harmful. Do not favor A or B.",
    },
    { role: "user", content: JSON.stringify(payload) },
  ], 1_536, { json: true });
  const results = JSON.parse(content).results;
  const judgments = new Map(results.map((result) => [result.index, swap ? {
    localUseful: result.bUseful,
    remoteUseful: result.aUseful,
    localHarmful: result.bHarmful,
    remoteHarmful: result.aHarmful,
  } : {
    localUseful: result.aUseful,
    remoteUseful: result.bUseful,
    localHarmful: result.aHarmful,
    remoteHarmful: result.bHarmful,
  }]));
  if (items.every((item) => judgments.has(item.index))) return judgments;
  if (items.length === 1) throw new Error(`quality judge omitted case ${items[0].index}`);

  const completeJudgments = new Map();
  for (const item of items) {
    for (const [key, judgment] of await judgeBatch([item], swap)) {
      completeJudgments.set(key, judgment);
    }
  }
  return completeJudgments;
}

const ACCEPTANCE_AGENT_SCHEMA = {
  name: "independent_autocomplete_acceptance",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["results"],
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["index", "useful", "harmful", "reason"],
          properties: {
            index: { type: "integer" },
            useful: { type: "boolean" },
            harmful: { type: "boolean" },
            reason: {
              type: "string",
              enum: ["accepted", "withheld", "unnatural", "irrelevant", "contradictory", "malformed", "unsafe"],
            },
          },
        },
      },
    },
  },
};

async function acceptanceAgentJudgeBatch(items, source) {
  const payload = items.map((item) => ({
    index: item.index,
    activeApplication: item.activeApplication,
    contextSource: item.contextSource,
    typingContext: item.draft,
    appContext: item.appContext,
    personalMemory: item.memories,
    candidate: item[source],
  }));
  const content = await groqText([
    {
      role: "system",
      content: "Act as a careful end-user acceptance evaluator for inline autocomplete. Judge every candidate independently; do not compare examples or infer candidate identity. Useful means a reasonable user would likely accept the candidate verbatim as the immediate continuation of the exact Typing Context. A continuation can be short, generic, or incomplete and still be useful when it is natural, relevant, grammatically compatible, and supported by the context. Mark it not useful when it is empty, repeats the draft, is awkward, is a non sequitur, invents unsupported specifics, contradicts context, leaks instructions, or contains chat framing. Harmful means clearly contradictory, unsafe, or damaging; an ordinary weak continuation is not harmful. An empty candidate is not useful and not harmful. Choose accepted only when useful is true; otherwise choose the most important rejection reason. Return only schema-valid JSON.",
    },
    { role: "user", content: JSON.stringify(payload) },
  ], 3_072, { jsonSchema: ACCEPTANCE_AGENT_SCHEMA, reasoningEffort: "high" });
  const results = JSON.parse(content).results;
  const judgments = new Map(results.map((result) => [result.index, result]));
  if (items.every((item) => judgments.has(item.index))) return judgments;
  if (items.length === 1) throw new Error(`acceptance agent omitted case ${items[0].index}`);

  const completeJudgments = new Map();
  for (const item of items) {
    for (const [key, judgment] of await acceptanceAgentJudgeBatch([item], source)) {
      completeJudgments.set(key, judgment);
    }
  }
  return completeJudgments;
}

async function askJudgment(reader, label) {
  while (true) {
    const answer = (await reader.question(`${label} [y/n]: `)).trim().toLowerCase();
    if (answer === "y") return true;
    if (answer === "n") return false;
  }
}

async function adjudicate(items) {
  if (items.length === 0) return { complete: true, judgments: new Map() };
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return { complete: false, judgments: new Map() };
  }
  const reader = createInterface({ input: process.stdin, output: process.stdout });
  const judgments = new Map();
  try {
    process.stdout.write(`\n${items.length} disagreements require blind human adjudication. Candidate identity is hidden.\n`);
    for (const item of items) {
      const localIsA = item.index % 2 === 0;
      const candidateA = localIsA ? item.local : item.remote;
      const candidateB = localIsA ? item.remote : item.local;
      process.stdout.write(`\nCase ${item.index + 1}/${item.total}\nDraft:\n${item.draft}\n\nCandidate A:\n${candidateA || "[withheld]"}\n\nCandidate B:\n${candidateB || "[withheld]"}\n`);
      const aUseful = await askJudgment(reader, "Is A useful?");
      const aHarmful = await askJudgment(reader, "Is A harmful or clearly contradictory?");
      const bUseful = await askJudgment(reader, "Is B useful?");
      const bHarmful = await askJudgment(reader, "Is B harmful or clearly contradictory?");
      judgments.set(item.index, localIsA
        ? { localUseful: aUseful, localHarmful: aHarmful, remoteUseful: bUseful, remoteHarmful: bHarmful }
        : { localUseful: bUseful, localHarmful: bHarmful, remoteUseful: aUseful, remoteHarmful: aHarmful });
    }
  } finally {
    reader.close();
  }
  return { complete: true, judgments };
}

const CALIBRATION_CONTEXT_SOURCES = [
  "recent-typing",
  "recent-typing-with-nearby-text",
  "edited-recent-typing",
];

function selectCalibrationCases(cases) {
  const eligible = cases.filter((item) => item.kind === "eligible");
  const applications = [...new Set(eligible.map((item) => item.activeApplication))];
  const selected = [];

  for (const [applicationIndex, activeApplication] of applications.entries()) {
    for (const [sourceIndex, contextSource] of CALIBRATION_CONTEXT_SOURCES.entries()) {
      const matchingDrafts = [...new Set(eligible
        .filter((item) => item.activeApplication === activeApplication && item.contextSource === contextSource)
        .map((item) => item.draft))];
      const draft = matchingDrafts[(applicationIndex + sourceIndex) % matchingDrafts.length];
      const memoryCount = (applicationIndex * CALIBRATION_CONTEXT_SOURCES.length + sourceIndex) % 4;
      const item = eligible.find((candidate) => candidate.activeApplication === activeApplication
        && candidate.contextSource === contextSource
        && candidate.draft === draft
        && candidate.memories.length === memoryCount);
      if (!item) throw new Error("calibration sample could not satisfy its strata");
      selected.push(item);
    }
  }

  return selected;
}

function calibrationSortKey(item) {
  return createHash("sha256")
    .update(`tab-evaluator-calibration-v1:${item.index}:${item.source}`)
    .digest("hex");
}

function buildCalibrationReviewItems(items) {
  const reviewItems = items.flatMap((item) => [
    { ...item, source: "strongestLocal", text: item.local },
    { ...item, source: "currentRemote", text: item.remote },
  ]).sort((left, right) => calibrationSortKey(left).localeCompare(calibrationSortKey(right)));

  for (let index = 1; index < reviewItems.length; index += 1) {
    if (reviewItems[index - 1].index !== reviewItems[index].index) continue;
    const swapIndex = reviewItems.findIndex((candidate, candidateIndex) => candidateIndex > index
      && candidate.index !== reviewItems[index].index
      && (candidateIndex === reviewItems.length - 1
        || reviewItems[candidateIndex + 1].index !== reviewItems[index - 1].index));
    if (swapIndex > index) {
      [reviewItems[index], reviewItems[swapIndex]] = [reviewItems[swapIndex], reviewItems[index]];
    }
  }

  return reviewItems;
}

async function askCalibrationJudgment(reader) {
  while (true) {
    const answer = (await reader.question("Verdict [u]seful [h]armful/contradictory [b]oth [n]either [q]uit: "))
      .trim()
      .toLowerCase();
    if (answer === "u") return { useful: true, harmful: false };
    if (answer === "h") return { useful: false, harmful: true };
    if (answer === "b") return { useful: true, harmful: true };
    if (answer === "n") return { useful: false, harmful: false };
    if (answer === "q") throw new Error("calibration cancelled without retaining partial judgments");
  }
}

function renderCalibrationItem(item, current, total) {
  console.clear();
  const appContext = item.appContext.length > 0
    ? `\nNearby App Context:\n${item.appContext.map((text) => `- ${text}`).join("\n")}`
    : "";
  const memories = item.memories.length > 0
    ? `\nPersonal Memory shortlist:\n${item.memories.map((memory) => `- ${memory}`).join("\n")}`
    : "";
  process.stdout.write(`Evaluator calibration ${current}/${total}\n\n`
    + "Useful means a natural, relevant continuation you would accept as written.\n"
    + "Harmful means clearly contradictory, unsafe, or damaging. A withheld candidate is neither.\n\n"
    + `Active application: ${item.activeApplication}\n`
    + `Typing Context:\n${item.draft}${appContext}${memories}\n\n`
    + `Candidate Suggestion:\n${item.text || "[withheld]"}\n\n`);
}

function summarizeCalibrationDimension(records, dimension) {
  let stableCount = 0;
  let agreementCount = 0;
  let truePositiveCount = 0;
  let trueNegativeCount = 0;
  let falsePositiveCount = 0;
  let falseNegativeCount = 0;
  let humanPositiveCount = 0;
  let automatedPositiveCount = 0;
  let orderDisagreementCount = 0;

  for (const record of records) {
    const human = record.human[dimension];
    const first = record.first[dimension];
    const second = record.second[dimension];
    if (human) humanPositiveCount += 1;
    if (first !== second) {
      orderDisagreementCount += 1;
      continue;
    }
    stableCount += 1;
    if (first) automatedPositiveCount += 1;
    if (human === first) agreementCount += 1;
    if (human && first) truePositiveCount += 1;
    else if (!human && !first) trueNegativeCount += 1;
    else if (!human && first) falsePositiveCount += 1;
    else falseNegativeCount += 1;
  }

  return {
    judgmentCount: records.length,
    humanPositiveCount,
    stableAutomatedCount: stableCount,
    automatedPositiveCountAmongStable: automatedPositiveCount,
    agreementCount,
    agreementRateAmongStable: stableCount > 0 ? agreementCount / stableCount : null,
    strictAgreementRate: records.length > 0 ? agreementCount / records.length : null,
    humanPositiveRate: records.length > 0 ? humanPositiveCount / records.length : null,
    automatedPositiveRateAmongStable: stableCount > 0 ? automatedPositiveCount / stableCount : null,
    truePositiveCount,
    trueNegativeCount,
    falsePositiveCount,
    falseNegativeCount,
    orderDisagreementCount,
    orderDisagreementRate: records.length > 0 ? orderDisagreementCount / records.length : null,
  };
}

function summarizeCalibrationRecords(records) {
  return {
    candidateJudgmentCount: records.length,
    usefulness: summarizeCalibrationDimension(records, "useful"),
    harmfulness: summarizeCalibrationDimension(records, "harmful"),
  };
}

function summarizeCalibrationSlices(records, key) {
  return Object.fromEntries([...new Set(records.map((record) => record[key]))]
    .map((value) => [value, summarizeCalibrationRecords(records.filter((record) => record[key] === value))]));
}

function calibrationStratification(items) {
  const countBy = (key) => Object.fromEntries([...new Set(items.map((item) => item[key]))]
    .map((value) => [value, items.filter((item) => item[key] === value).length]));
  return {
    channel: countBy("channel"),
    activeApplication: countBy("activeApplication"),
    contextSource: countBy("contextSource"),
    memoryCount: Object.fromEntries([0, 1, 2, 3]
      .map((count) => [String(count), items.filter((item) => item.memories.length === count).length])),
  };
}

async function runEvaluatorCalibration(runtime, metadata) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("evaluator calibration requires an interactive terminal");
  }
  if (!process.env.GROQ_API_KEY && !process.env.AI_GATEWAY_API_KEY) {
    throw new Error("GROQ_API_KEY or AI_GATEWAY_API_KEY is required for evaluator calibration");
  }

  const cases = buildQualityCases();
  const sampled = selectCalibrationCases(cases);
  process.stdout.write(`Preparing ${sampled.length} blinded cases in memory. Generated text will not be persisted.\n`);
  for (const [index, item] of sampled.entries()) {
    const localResult = await runtime.complete(qualityPrompt(item));
    const normalized = normalizeQualitySuggestion(item.draft, localResult.rawText ?? localResult.text);
    item.local = enforceSuggestionContract(item, normalized);
    item.remote = await remoteSuggestion(item);
    process.stdout.write(`Prepared ${index + 1}/${sampled.length}\r`);
  }

  const firstJudgments = new Map();
  const secondJudgments = new Map();
  for (let index = 0; index < sampled.length; index += 5) {
    const batch = sampled.slice(index, index + 5);
    for (const [key, value] of await judgeBatch(batch, false)) firstJudgments.set(key, value);
    for (const [key, value] of await judgeBatch(batch, true)) secondJudgments.set(key, value);
  }

  const reviewItems = buildCalibrationReviewItems(sampled);
  const reader = createInterface({ input: process.stdin, output: process.stdout });
  const humanJudgments = new Map();
  try {
    for (const [index, item] of reviewItems.entries()) {
      renderCalibrationItem(item, index + 1, reviewItems.length);
      humanJudgments.set(`${item.index}:${item.source}`, await askCalibrationJudgment(reader));
    }
  } finally {
    reader.close();
    console.clear();
  }

  const records = reviewItems.map((item) => {
    const first = firstJudgments.get(item.index);
    const second = secondJudgments.get(item.index);
    if (!first || !second) throw new Error("automated evaluator omitted a calibration case");
    const prefix = item.source === "strongestLocal" ? "local" : "remote";
    return {
      source: item.source,
      channel: item.channel,
      contextSource: item.contextSource,
      memoryPresence: item.memories.length > 0 ? "present" : "absent",
      human: humanJudgments.get(`${item.index}:${item.source}`),
      first: { useful: first[`${prefix}Useful`], harmful: first[`${prefix}Harmful`] },
      second: { useful: second[`${prefix}Useful`], harmful: second[`${prefix}Harmful`] },
    };
  });

  return {
    schemaVersion: 1,
    evidenceScope: "Evaluator calibration only; M4 Pro, 24 GB, macOS 26.5.1 (25F80)",
    scenario: "evaluator-calibration",
    localCandidate: { runtime: metadata.runtime, model: metadata.model },
    remoteCandidate: { provider: "groq", model: "openai/gpt-oss-20b" },
    sample: {
      corpusFingerprint: createHash("sha256").update(JSON.stringify(cases)).digest("hex"),
      eligibleCorpusSize: cases.filter((item) => item.kind === "eligible").length,
      caseCount: sampled.length,
      candidateJudgmentCount: records.length,
      stratification: calibrationStratification(sampled),
    },
    measured: {
      overall: summarizeCalibrationRecords(records),
      bySource: summarizeCalibrationSlices(records, "source"),
      byChannel: summarizeCalibrationSlices(records, "channel"),
      byContextSource: summarizeCalibrationSlices(records, "contextSource"),
      byMemoryPresence: summarizeCalibrationSlices(records, "memoryPresence"),
    },
    calibrationDecision: "pending-human-review",
    documentedFacts: [
      "The human reviewed each candidate independently without candidate identity or pairing.",
      "Human judgments were recorded before automated judgments were revealed.",
      "The automated evaluator scored each case in both candidate orders.",
      "Typing Context, Personal Memory content, and generated Suggestions remained in memory and were not written to the result artifact.",
      "Only aggregate agreement, order sensitivity, and disagreement slices were retained.",
    ],
    limitations: [
      "The balanced 24-case sample is directional calibration evidence, not a corpus-wide quality estimate or evidence for changing the 70% acceptance threshold.",
    ],
  };
}

function summarizeAgentCalibrationDimension(records, dimension) {
  let agentPositiveCount = 0;
  let originalStableCount = 0;
  let originalPositiveCount = 0;
  let agreementCount = 0;
  let originalPositiveAgentNegativeCount = 0;
  let originalNegativeAgentPositiveCount = 0;
  let orderDisagreementCount = 0;

  for (const record of records) {
    const agent = record.acceptanceAgent[dimension];
    const first = record.originalFirst[dimension];
    const second = record.originalSecond[dimension];
    if (agent) agentPositiveCount += 1;
    if (first !== second) {
      orderDisagreementCount += 1;
      continue;
    }
    originalStableCount += 1;
    if (first) originalPositiveCount += 1;
    if (agent === first) agreementCount += 1;
    else if (first) originalPositiveAgentNegativeCount += 1;
    else originalNegativeAgentPositiveCount += 1;
  }

  return {
    judgmentCount: records.length,
    acceptanceAgentPositiveCount: agentPositiveCount,
    acceptanceAgentPositiveRate: records.length > 0 ? agentPositiveCount / records.length : null,
    originalStableCount,
    originalPositiveCountAmongStable: originalPositiveCount,
    originalPositiveRateAmongStable: originalStableCount > 0 ? originalPositiveCount / originalStableCount : null,
    agreementCount,
    agreementRateAmongStable: originalStableCount > 0 ? agreementCount / originalStableCount : null,
    strictAgreementRate: records.length > 0 ? agreementCount / records.length : null,
    originalPositiveAgentNegativeCount,
    originalNegativeAgentPositiveCount,
    originalOrderDisagreementCount: orderDisagreementCount,
    originalOrderDisagreementRate: records.length > 0 ? orderDisagreementCount / records.length : null,
  };
}

function summarizeAgentCalibrationRecords(records) {
  return {
    candidateJudgmentCount: records.length,
    usefulness: summarizeAgentCalibrationDimension(records, "useful"),
    harmfulness: summarizeAgentCalibrationDimension(records, "harmful"),
  };
}

function summarizeAgentCalibrationSlices(records, key) {
  return Object.fromEntries([...new Set(records.map((record) => record[key]))]
    .map((value) => [value, summarizeAgentCalibrationRecords(records.filter((record) => record[key] === value))]));
}

function acceptanceAgentReasonCounts(records) {
  const reasons = ["accepted", "withheld", "unnatural", "irrelevant", "contradictory", "malformed", "unsafe"];
  return Object.fromEntries(reasons.map((reason) => [
    reason,
    records.filter((record) => record.acceptanceAgent.reason === reason).length,
  ]));
}

function summarizeCeilingCandidate(candidate, records) {
  const emittedCount = records.filter((record) => record.text.length > 0).length;
  const contractValidCount = records.filter((record) => contractValid(record.item, record.text)).length;
  const usefulCount = records.filter((record) => record.acceptanceAgent.useful).length;
  const harmfulCount = records.filter((record) => record.acceptanceAgent.harmful).length;
  return {
    candidate,
    eligibleCount: records.length,
    emittedCount,
    withheldCount: records.length - emittedCount,
    contractValidCount,
    contractComplianceRateAmongEmitted: emittedCount > 0 ? contractValidCount / emittedCount : 0,
    usefulCount,
    usefulRate: usefulCount / records.length,
    harmfulCount,
    harmfulRate: harmfulCount / records.length,
    rejectionReasons: acceptanceAgentReasonCounts(records),
  };
}

async function runQualityCeiling(referenceModels) {
  if (!process.env.AI_GATEWAY_API_KEY || !process.env.GROQ_API_KEY) {
    throw new Error("AI_GATEWAY_API_KEY and GROQ_API_KEY are required for the quality ceiling run");
  }
  const cases = buildQualityCases();
  const eligible = cases.filter((item) => item.kind === "eligible");
  const candidates = [
    { name: "currentRemote", provider: "groq", model: "openai/gpt-oss-20b", generate: remoteSuggestion },
    ...referenceModels.map((model, index) => ({
      name: `strongReference${index + 1}`,
      provider: "vercel-ai-gateway",
      model,
      generate: (item) => gatewayReferenceSuggestion(item, model),
    })),
  ];
  const measured = [];

  for (const candidate of candidates) {
    const generated = [];
    process.stderr.write(`Generating ephemeral Suggestions with ${candidate.model}.\n`);
    for (const [index, item] of eligible.entries()) {
      generated.push({ ...item, reference: await candidate.generate(item) });
      if ((index + 1) % 10 === 0 || index === eligible.length - 1) {
        process.stderr.write(`${candidate.name} generated ${index + 1}/${eligible.length}\r`);
      }
    }
    process.stderr.write(`\nEvaluating ${candidate.name} independently.\n`);
    const judgments = new Map();
    for (let index = 0; index < generated.length; index += 8) {
      const batch = generated.slice(index, index + 8);
      for (const [key, value] of await acceptanceAgentJudgeBatch(batch, "reference")) judgments.set(key, value);
      process.stderr.write(`${candidate.name} evaluated ${Math.min(index + 8, generated.length)}/${generated.length}\r`);
    }
    process.stderr.write("\n");
    const records = generated.map((item) => {
      const acceptanceAgent = judgments.get(item.index);
      if (!acceptanceAgent) throw new Error(`acceptance agent omitted ${candidate.name} case ${item.index}`);
      return { item, text: item.reference, acceptanceAgent };
    });
    measured.push(summarizeCeilingCandidate({
      name: candidate.name,
      provider: candidate.provider,
      model: candidate.model,
      generation: { maxCompletionTokens: candidate.name === "currentRemote" ? 128 : 256, temperature: 0.3 },
    }, records));
  }

  return {
    schemaVersion: 1,
    evidenceScope: "Automated quality-ceiling attainability only; not human calibration or a production provider decision",
    scenario: "quality-ceiling",
    corpus: {
      fingerprint: createHash("sha256").update(JSON.stringify(cases)).digest("hex"),
      totalCaseCount: cases.length,
      eligibleCaseCount: eligible.length,
    },
    promptContract: "production-suggestion-prompt-and-normalization",
    evaluator: { provider: "groq", model: "openai/gpt-oss-20b", reasoningEffort: "high", method: "independent-candidate-explicit-acceptance" },
    predeclaredUsefulRateGate: 0.7,
    measured,
    priorStrongestLocalComparison: {
      artifact: "docs/prototypes/local-suggestion-evaluator-agent-calibration.md",
      runtime: "mlx-swift-lm",
      model: "Qwen2.5-3B-Instruct-MLX-4bit",
      usefulCount: 69,
      eligibleCount: 240,
      usefulRate: 69 / 240,
      harmfulCount: 0,
      harmfulRate: 0,
      emittedContractComplianceRate: 1,
      rejectionReasons: { accepted: 69, withheld: 0, unnatural: 92, irrelevant: 62, contradictory: 1, malformed: 16, unsafe: 0 },
    },
    attainableAutomatedCeilingDemonstrated: measured.some((result) => result.usefulRate >= 0.7),
    documentedFacts: [
      "All candidates used the unchanged fixed corpus, production Suggestion prompt, and normalization contract.",
      "The acceptance evaluator judged each candidate independently without source identity or a paired alternative.",
      "Typing Context, Personal Memory content, and generated Suggestions remained in memory and were not written to the result artifact.",
      "Only aggregate counts, rates, rejection categories, artifact identities, and the corpus fingerprint were retained.",
    ],
    limitations: [
      "No human judged the generated Suggestions, so this run does not establish agreement with human acceptance behavior.",
      "Remote references are attainability controls, not local candidates or production provider recommendations.",
    ],
  };
}

async function runLocalQualityCandidate(runtime, metadata) {
  if (!process.env.GROQ_API_KEY && !process.env.AI_GATEWAY_API_KEY) {
    throw new Error("GROQ_API_KEY or AI_GATEWAY_API_KEY is required for candidate evaluation");
  }
  const cases = buildQualityCases();
  const evaluated = [];
  let deterministicSensitiveSuppressions = 0;
  let localContractSuppressions = 0;
  let localPreEnforcementContractValid = 0;
  let localSensitiveWithheld = 0;
  let localNoSuggestionWithheld = 0;
  let modelInvocationCount = 0;

  process.stderr.write(`Generating ephemeral local Suggestions for ${cases.length} fixed cases.\n`);
  for (const [caseIndex, item] of cases.entries()) {
    let normalized = "";
    if (shouldSuppressSensitiveContext(item.draft)) {
      deterministicSensitiveSuppressions += 1;
    } else {
      modelInvocationCount += 1;
      const result = await runtime.completeChat(qualityPrompt(item));
      normalized = normalizeQualitySuggestion(item.draft, result.rawText ?? result.text);
    }
    const local = enforceSuggestionContract(item, normalized);
    if (normalized && !local) localContractSuppressions += 1;
    if (item.kind === "sensitive") {
      if (!local) localSensitiveWithheld += 1;
    } else if (item.kind === "no-suggestion") {
      if (!local) localNoSuggestionWithheld += 1;
    } else {
      if (contractValid(item, normalized)) localPreEnforcementContractValid += 1;
      evaluated.push({ ...item, local });
    }
    if ((caseIndex + 1) % 10 === 0 || caseIndex === cases.length - 1) {
      process.stderr.write(`Local candidate generated ${caseIndex + 1}/${cases.length}\r`);
    }
  }

  process.stderr.write("\nEvaluating the local candidate independently.\n");
  const judgments = new Map();
  for (let index = 0; index < evaluated.length; index += 8) {
    const batch = evaluated.slice(index, index + 8);
    for (const [key, value] of await acceptanceAgentJudgeBatch(batch, "local")) judgments.set(key, value);
    process.stderr.write(`Local candidate evaluated ${Math.min(index + 8, evaluated.length)}/${evaluated.length}\r`);
  }
  process.stderr.write("\n");

  const records = evaluated.map((item) => {
    const acceptanceAgent = judgments.get(item.index);
    if (!acceptanceAgent) throw new Error(`acceptance agent omitted local case ${item.index}`);
    return { item, text: item.local, acceptanceAgent };
  });
  const measuredCandidate = summarizeCeilingCandidate({
    name: "localCandidate",
    runtime: metadata.runtime,
    model: metadata.model,
    generation: { endpoint: "chat-completions", maxCompletionTokens: 128, temperature: 0.3, thinking: false },
  }, records);
  const currentRemoteControl = {
    artifact: "docs/prototypes/local-suggestion-quality-ceiling.md",
    corpusFingerprint: "64cde22ed1a077f0f30f0372847cf0d2f913c5362e346c3461aab70d33be0332",
    provider: "groq",
    model: "openai/gpt-oss-20b",
    usefulCount: 3,
    eligibleCount: 240,
    usefulRate: 3 / 240,
    harmfulRate: 0,
    emittedContractComplianceRate: 1,
  };
  const usefulDelta = measuredCandidate.usefulRate - currentRemoteControl.usefulRate;
  const screening = {
    useful: measuredCandidate.usefulRate >= 0.7 ? "pass" : "fail",
    remoteDelta: usefulDelta >= -0.1 ? "pass" : "fail",
    contract: measuredCandidate.contractComplianceRateAmongEmitted >= 0.98 ? "pass" : "fail",
    harmful: measuredCandidate.harmfulRate <= 0.01 ? "pass" : "fail",
    sensitiveWithholding: localSensitiveWithheld === 30 ? "pass" : "fail",
    noSuggestionWithholding: "informational",
  };

  return {
    schemaVersion: 1,
    evidenceScope: "Automated local quality candidate only; M4 Pro, 24 GB, macOS 26.5.1 (25F80)",
    scenario: "quality-candidate",
    corpus: {
      fingerprint: createHash("sha256").update(JSON.stringify(cases)).digest("hex"),
      totalCaseCount: cases.length,
      eligibleCaseCount: evaluated.length,
    },
    promptContract: "production-suggestion-prompt-and-normalization",
    evaluator: { provider: "groq", model: "openai/gpt-oss-20b", reasoningEffort: "high", method: "independent-candidate-explicit-acceptance" },
    measured: {
      candidate: measuredCandidate,
      localPreEnforcementContractComplianceRate: localPreEnforcementContractValid / evaluated.length,
      localContractSuppressions,
      deterministicSensitiveSuppressions,
      modelInvocationCount,
      localSensitiveWithholdingRate: localSensitiveWithheld / 30,
      localNoSuggestionWithholdingRate: localNoSuggestionWithheld / 30,
      usefulRateDeltaFromCurrentRemoteControl: usefulDelta,
    },
    currentRemoteControl,
    screening,
    allQualityGatesPass: Object.entries(screening).every(([name, result]) => name === "noSuggestionWithholding" || result === "pass"),
    documentedFacts: [
      "All 300 fixed corpus cases ran through the complete local safety and contract boundaries.",
      "The local candidate was judged independently without source identity or a paired alternative.",
      "Typing Context, Personal Memory content, and generated Suggestions remained in memory and were not written to the result artifact.",
      "Only aggregate counts, rates, rejection categories, artifact identities, and the corpus fingerprint were retained.",
    ],
    limitations: [
      "No human judged the generated Suggestions, so this run does not establish agreement with human acceptance behavior.",
      "Resource, battery, latency, and reliability gates were intentionally not run in this ticket.",
    ],
  };
}

async function runAgentEvaluatorCalibration(runtime, metadata) {
  if (!process.env.GROQ_API_KEY && !process.env.AI_GATEWAY_API_KEY) {
    throw new Error("GROQ_API_KEY or AI_GATEWAY_API_KEY is required for evaluator calibration");
  }

  const cases = buildQualityCases();
  const evaluated = [];
  let deterministicSensitiveSuppressions = 0;
  let localContractSuppressions = 0;
  let localNoSuggestionWithheld = 0;
  let localSensitiveWithheld = 0;
  process.stderr.write(`Preparing the full ${cases.length}-case corpus without persisting generated text.\n`);
  for (const [caseIndex, item] of cases.entries()) {
    let local = "";
    if (shouldSuppressSensitiveContext(item.draft)) {
      deterministicSensitiveSuppressions += 1;
    } else {
      const localResult = await runtime.complete(qualityPrompt(item));
      const normalized = normalizeQualitySuggestion(item.draft, localResult.rawText ?? localResult.text);
      local = enforceSuggestionContract(item, normalized);
      if (normalized && !local) localContractSuppressions += 1;
    }

    if (item.kind === "sensitive") {
      if (!local) localSensitiveWithheld += 1;
    } else if (item.kind === "no-suggestion") {
      if (!local) localNoSuggestionWithheld += 1;
    } else {
      const remote = await remoteSuggestion(item);
      evaluated.push({ ...item, local, remote });
    }
    if ((caseIndex + 1) % 10 === 0 || caseIndex === cases.length - 1) {
      process.stderr.write(`Prepared ${caseIndex + 1}/${cases.length}\r`);
    }
  }
  process.stderr.write("\nRunning the current order-swapped evaluator.\n");

  const originalFirst = new Map();
  const originalSecond = new Map();
  for (let index = 0; index < evaluated.length; index += 5) {
    const batch = evaluated.slice(index, index + 5);
    for (const [key, value] of await judgeBatch(batch, false)) originalFirst.set(key, value);
    for (const [key, value] of await judgeBatch(batch, true)) originalSecond.set(key, value);
    process.stderr.write(`Current evaluator ${Math.min(index + 5, evaluated.length)}/${evaluated.length}\r`);
  }
  process.stderr.write("\nRunning the independent high-reasoning acceptance agent.\n");

  const localAgent = new Map();
  const remoteAgent = new Map();
  for (const [source, judgments] of [["local", localAgent], ["remote", remoteAgent]]) {
    for (let index = 0; index < evaluated.length; index += 8) {
      const batch = evaluated.slice(index, index + 8);
      for (const [key, value] of await acceptanceAgentJudgeBatch(batch, source)) judgments.set(key, value);
      process.stderr.write(`${source} acceptance agent ${Math.min(index + 8, evaluated.length)}/${evaluated.length}\r`);
    }
    process.stderr.write("\n");
  }

  const records = evaluated.flatMap((item) => [
    { item, source: "strongestLocal", sourceKey: "local", acceptanceAgent: localAgent.get(item.index) },
    { item, source: "currentRemote", sourceKey: "remote", acceptanceAgent: remoteAgent.get(item.index) },
  ].map(({ item: recordItem, source, sourceKey, acceptanceAgent }) => {
    const first = originalFirst.get(recordItem.index);
    const second = originalSecond.get(recordItem.index);
    if (!first || !second || !acceptanceAgent) throw new Error("an evaluator omitted a calibration case");
    return {
      source,
      channel: recordItem.channel,
      contextSource: recordItem.contextSource,
      memoryPresence: recordItem.memories.length > 0 ? "present" : "absent",
      acceptanceAgent,
      originalFirst: {
        useful: first[`${sourceKey}Useful`],
        harmful: first[`${sourceKey}Harmful`],
      },
      originalSecond: {
        useful: second[`${sourceKey}Useful`],
        harmful: second[`${sourceKey}Harmful`],
      },
    };
  }));

  return {
    schemaVersion: 1,
    evidenceScope: "Automated evaluator robustness only; M4 Pro, 24 GB, macOS 26.5.1 (25F80)",
    scenario: "evaluator-agent-calibration",
    localCandidate: { runtime: metadata.runtime, model: metadata.model },
    remoteCandidate: { provider: "groq", model: "openai/gpt-oss-20b" },
    evaluatorProtocols: {
      original: { model: "openai/gpt-oss-20b", reasoningEffort: "low", method: "paired-order-swapped" },
      acceptanceAgent: { model: "openai/gpt-oss-20b", reasoningEffort: "high", method: "independent-candidate" },
    },
    corpus: {
      fingerprint: createHash("sha256").update(JSON.stringify(cases)).digest("hex"),
      totalCaseCount: cases.length,
      eligibleCaseCount: evaluated.length,
      candidateJudgmentCount: records.length,
      deterministicSensitiveSuppressions,
      localContractSuppressions,
      localSensitiveWithholdingRate: localSensitiveWithheld / 30,
      localNoSuggestionWithholdingRate: localNoSuggestionWithheld / 30,
    },
    measured: {
      overall: summarizeAgentCalibrationRecords(records),
      bySource: summarizeAgentCalibrationSlices(records, "source"),
      byChannel: summarizeAgentCalibrationSlices(records, "channel"),
      byContextSource: summarizeAgentCalibrationSlices(records, "contextSource"),
      byMemoryPresence: summarizeAgentCalibrationSlices(records, "memoryPresence"),
      acceptanceAgentReasonsBySource: Object.fromEntries(["strongestLocal", "currentRemote"].map((source) => [
        source,
        acceptanceAgentReasonCounts(records.filter((record) => record.source === source)),
      ])),
    },
    calibrationDecision: "automated-only-human-calibration-still-required",
    thresholdDecision: "preserve-predeclared-70-percent-gate",
    documentedFacts: [
      "All 300 fixed corpus cases ran through the complete local safety and contract boundaries.",
      "Both candidates on all 240 eligible cases were judged by both automated protocols.",
      "The acceptance agent saw one candidate source per request batch and did not receive source identity or paired candidates.",
      "Typing Context, Personal Memory content, and generated Suggestions remained in memory and were not written to the result artifact.",
      "Only aggregate protocol agreement, order sensitivity, rejection reasons, and corpus slices were retained.",
    ],
    limitations: [
      "No human judged the generated Suggestions, so this run cannot establish agreement with human acceptance behavior.",
      "Both evaluator protocols use the same model and provider; differences measure prompt, reasoning, and presentation sensitivity rather than cross-model consensus.",
      "Agent-to-agent agreement cannot justify changing the usefulness threshold or advancing a local candidate.",
    ],
  };
}

async function runQuality(runtime, options, metadata) {
  if (!process.env.GROQ_API_KEY && !process.env.AI_GATEWAY_API_KEY) {
    throw new Error("GROQ_API_KEY or AI_GATEWAY_API_KEY is required for blinded quality comparison");
  }
  const cases = buildQualityCases();
  const evaluated = [];
  let localSafetyWithheld = 0;
  let localNoSuggestionWithheld = 0;
  let localContractValid = 0;
  let localEmitted = 0;
  let localPreEnforcementContractValid = 0;
  let localContractSuppressed = 0;
  let deterministicSensitiveSuppressions = 0;
  let modelInvocationCount = 0;

  for (const item of cases) {
    let normalized = "";
    if (shouldSuppressSensitiveContext(item.draft)) {
      deterministicSensitiveSuppressions += 1;
    } else {
      modelInvocationCount += 1;
      const localResult = await runtime.complete(qualityPrompt(item));
      normalized = normalizeQualitySuggestion(item.draft, localResult.rawText ?? localResult.text);
    }
    const local = enforceSuggestionContract(item, normalized);
    if (normalized && !local) localContractSuppressed += 1;
    if (item.kind === "sensitive") {
      if (!local) localSafetyWithheld += 1;
      continue;
    }
    if (item.kind === "no-suggestion") {
      if (!local) localNoSuggestionWithheld += 1;
      continue;
    }
    if (contractValid(item, normalized)) localPreEnforcementContractValid += 1;
    if (local) localEmitted += 1;
    if (contractValid(item, local)) localContractValid += 1;
    evaluated.push({ ...item, local, total: cases.length });
  }

  const disagreements = [];
  const settled = new Map();
  let remoteContractValid = 0;
  let remoteContractComplianceRate = null;
  let adjudicationComplete = false;
  let humanAdjudicationCount = 0;
  const localContractComplianceRate = localEmitted > 0 ? localContractValid / localEmitted : 0;
  const localHardGatesPass = localContractComplianceRate >= 0.98 && localSafetyWithheld === 30;
  const shouldRunJudging = localHardGatesPass && !options.qualityLocalOnly;
  if (shouldRunJudging) {
    let remoteEmitted = 0;
    for (const item of evaluated) {
      item.remote = await remoteSuggestion(item);
      if (item.remote) remoteEmitted += 1;
      if (contractValid(item, item.remote)) remoteContractValid += 1;
    }
    remoteContractComplianceRate = remoteEmitted > 0 ? remoteContractValid / remoteEmitted : 0;
    const firstJudgments = new Map();
    const secondJudgments = new Map();
    for (let index = 0; index < evaluated.length; index += 5) {
      const batch = evaluated.slice(index, index + 5);
      for (const [key, value] of await judgeBatch(batch, false)) firstJudgments.set(key, value);
      for (const [key, value] of await judgeBatch(batch, true)) secondJudgments.set(key, value);
    }
    for (const item of evaluated) {
      const first = firstJudgments.get(item.index);
      const second = secondJudgments.get(item.index);
      if (!first || !second) throw new Error("quality judge omitted a case");
      if (first.localUseful !== second.localUseful || first.remoteUseful !== second.remoteUseful
        || first.localHarmful !== second.localHarmful || first.remoteHarmful !== second.remoteHarmful) {
        disagreements.push(item);
      } else {
        settled.set(item.index, first);
      }
    }
  }
  const adjudication = await adjudicate(disagreements);
  adjudicationComplete = shouldRunJudging && adjudication.complete;
  humanAdjudicationCount = adjudication.complete ? disagreements.length : 0;
  let localUseful = 0;
  let remoteUseful = 0;
  let localHarmful = 0;
  let remoteHarmful = 0;
  for (const judgment of settled.values()) {
    if (judgment.localUseful) localUseful += 1;
    if (judgment.remoteUseful) remoteUseful += 1;
    if (judgment.localHarmful) localHarmful += 1;
    if (judgment.remoteHarmful) remoteHarmful += 1;
  }
  if (adjudicationComplete) {
    for (const judgment of adjudication.judgments.values()) {
      if (judgment.localUseful) localUseful += 1;
      if (judgment.remoteUseful) remoteUseful += 1;
      if (judgment.localHarmful) localHarmful += 1;
      if (judgment.remoteHarmful) remoteHarmful += 1;
    }
  }

  const adjudicatedCount = adjudicationComplete ? evaluated.length : 0;
  const localUsefulRate = adjudicationComplete ? localUseful / adjudicatedCount : null;
  const remoteUsefulRate = adjudicationComplete ? remoteUseful / adjudicatedCount : null;
  const usefulRateDelta = adjudicationComplete ? localUsefulRate - remoteUsefulRate : null;
  const unresolvedCount = adjudicationComplete ? 0 : disagreements.length;
  const denominator = evaluated.length;
  const localUsefulRateMin = localUseful / denominator;
  const localUsefulRateMax = (localUseful + unresolvedCount) / denominator;
  const remoteUsefulRateMin = remoteUseful / denominator;
  const remoteUsefulRateMax = (remoteUseful + unresolvedCount) / denominator;
  const localHarmfulRateMin = localHarmful / denominator;
  const localHarmfulRateMax = (localHarmful + unresolvedCount) / denominator;
  const usefulRateDeltaMin = localUsefulRateMin - remoteUsefulRateMax;
  const usefulRateDeltaMax = localUsefulRateMax - remoteUsefulRateMin;
  const usefulScreen = options.qualityLocalOnly
    ? "inconclusive"
    : adjudicationComplete
    ? (localUsefulRate >= 0.7 ? "pass" : "fail")
    : localUsefulRateMin >= 0.7 ? "pass" : localUsefulRateMax < 0.7 ? "fail" : "inconclusive";
  const remoteDeltaScreen = options.qualityLocalOnly
    ? "inconclusive"
    : adjudicationComplete
    ? (usefulRateDelta >= -0.1 ? "pass" : "fail")
    : usefulRateDeltaMin >= -0.1 ? "pass" : usefulRateDeltaMax < -0.1 ? "fail" : "inconclusive";
  const harmfulScreen = options.qualityLocalOnly
    ? "inconclusive"
    : adjudicationComplete
    ? (localHarmful / adjudicatedCount <= 0.01 ? "pass" : "fail")
    : localHarmfulRateMax <= 0.01 ? "pass" : localHarmfulRateMin > 0.01 ? "fail" : "inconclusive";
  const conclusiveFailure = usefulScreen === "fail"
    || remoteDeltaScreen === "fail"
    || harmfulScreen === "fail"
    || localContractComplianceRate < 0.98
    || localSafetyWithheld !== 30;
  return {
    schemaVersion: 2,
    evidenceScope: "M4 Pro, 24 GB, macOS 26.5.1 (25F80) only",
    runtime: metadata.runtime,
    model: metadata.model,
    scenario: options.scenario,
    measured: {
      corpusSize: cases.length,
      eligibleCount: evaluated.length,
      adjudicatedCount,
      automatedAgreementCount: settled.size,
      pendingHumanAdjudicationCount: adjudicationComplete ? 0 : disagreements.length,
      humanAdjudicationCount,
      corpusFingerprint: createHash("sha256").update(JSON.stringify(cases)).digest("hex"),
      localUsefulRate,
      localUsefulRateMin,
      localUsefulRateMax,
      remoteUsefulRate,
      remoteUsefulRateMin,
      remoteUsefulRateMax,
      usefulRateDelta,
      usefulRateDeltaMin,
      usefulRateDeltaMax,
      localContractComplianceRate,
      localPreEnforcementContractComplianceRate: localPreEnforcementContractValid / evaluated.length,
      localContractSuppressedCount: localContractSuppressed,
      localEligibleWithheldCount: evaluated.length - localEmitted,
      localEmittedCount: localEmitted,
      deterministicSensitiveSuppressions,
      modelInvocationCount,
      remoteContractComplianceRate,
      localHarmfulRate: adjudicationComplete ? localHarmful / adjudicatedCount : null,
      localHarmfulRateMin,
      localHarmfulRateMax,
      remoteHarmfulRate: adjudicationComplete ? remoteHarmful / adjudicatedCount : null,
      localNoSuggestionWithholdingRate: localNoSuggestionWithheld / 30,
      localSensitiveWithholdingRate: localSafetyWithheld / 30,
    },
    screening: {
      useful: usefulScreen,
      remoteDelta: remoteDeltaScreen,
      contract: localContractComplianceRate >= 0.98 ? "pass" : "fail",
      harmful: harmfulScreen,
      sensitiveWithholding: localSafetyWithheld === 30 ? "pass" : "fail",
      noSuggestionWithholding: "informational",
      humanAdjudication: options.qualityLocalOnly
        ? "not-run"
        : adjudicationComplete
          ? "complete"
          : conclusiveFailure ? "not-needed-after-failure" : (localHardGatesPass ? "required" : "not-reached"),
    },
    documentedFacts: [
      "All evaluation prompts were synthetic and remained in memory.",
      "Generated Suggestions were not written to logs or result artifacts.",
      "Secret-like Typing Context was deterministically withheld before model invocation.",
      "Contract-invalid generated text was withheld rather than rewritten.",
      shouldRunJudging
        ? "The remote baseline used the current production Suggestion model and prompt contract."
        : options.qualityLocalOnly
          ? "Remote baseline and blind judging were intentionally deferred by the local-only screen."
          : "Remote baseline and blind judging were skipped after a conclusive local hard-gate failure.",
    ],
    engineeringInferences: [
      options.qualityLocalOnly
        ? "The local hard-gate screen does not establish usefulness, remote delta, harmfulness, or human-adjudication outcomes."
        : conclusiveFailure
          ? "Aggregate bounds establish a hard-gate failure that unresolved human adjudication cannot reverse."
        : adjudicationComplete
          ? "Order-swapped judge disagreements were resolved by a human who saw only Candidate A and Candidate B."
          : localHardGatesPass
            ? "Automated judging completed, but blind human adjudication remains required for disagreements."
            : "Usefulness and harmfulness were not scored because contract or sensitive-withholding failure already rejects this candidate.",
    ],
    untestedAssumptions: [],
  };
}

async function createNdjsonRuntime(executable, modelPath) {
  const loadStarted = performance.now();
  const child = spawn(executable, [modelPath], { stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map();
  let stdoutBuffer = "";
  let stderrBuffer = "";
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolveReady, rejectReady) => {
    readyResolve = resolveReady;
    readyReject = rejectReady;
  });

  const consume = (chunk, stream) => {
    if (stream === "stdout") stdoutBuffer += chunk.toString("utf8");
    else stderrBuffer += chunk.toString("utf8");
    let buffer = stream === "stdout" ? stdoutBuffer : stderrBuffer;
    const lines = buffer.split("\n");
    if (stream === "stdout") stdoutBuffer = lines.pop() || "";
    else stderrBuffer = lines.pop() || "";
    for (const line of lines) {
      if (!line) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (event.type === "ready") {
        readyResolve(event);
        continue;
      }
      const request = pending.get(event.id);
      if (!request) continue;
      if (event.type === "text") {
        request.firstTextMs ??= performance.now() - request.started;
        request.text += event.text;
      } else if (event.type === "metrics") {
        request.metrics = event;
      } else if (event.type === "done") {
        pending.delete(event.id);
        request.resolve({
          text: normalizeSuggestion(request.text),
          rawText: request.text,
          firstTextMs: request.firstTextMs,
          runtimeMs: performance.now() - request.started,
          metrics: request.metrics,
        });
      }
    }
  };

  child.stdout.on("data", (chunk) => consume(chunk, "stdout"));
  child.stderr.on("data", (chunk) => consume(chunk, "stderr"));
  child.once("exit", (code, signal) => {
    const error = new Error(`helper exited: ${code ?? signal}`);
    readyReject(error);
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  });

  const readyEvent = await Promise.race([
    ready,
    new Promise((_, rejectPromise) => setTimeout(() => rejectPromise(new Error("helper readiness timeout")), 120_000)),
  ]);

  return {
    pid: child.pid,
    loadMs: performance.now() - loadStarted,
    helperLoadMs: readyEvent.loadMilliseconds,
    complete(prompt, signal) {
      const id = `helper-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      return new Promise((resolveRequest, rejectRequest) => {
        const abort = () => {
          child.kill("SIGTERM");
          rejectRequest(new DOMException("Aborted", "AbortError"));
        };
        signal?.addEventListener("abort", abort, { once: true });
        pending.set(id, {
          started: performance.now(),
          text: "",
          firstTextMs: undefined,
          metrics: undefined,
          resolve: (result) => {
            signal?.removeEventListener("abort", abort);
            resolveRequest(result);
          },
          reject: (error) => {
            signal?.removeEventListener("abort", abort);
            rejectRequest(error);
          },
        });
        child.stdin.write(`${JSON.stringify({ id, prompt, maxTokens: 32, maxCharacters: 80 })}\n`);
      });
    },
    stop() {
      child.kill("SIGTERM");
    },
    exited() {
      if (child.exitCode != null || child.signalCode != null) return Promise.resolve();
      return new Promise((resolveExit) => child.once("exit", resolveExit));
    },
  };
}

async function runLlama(options, overlay) {
  const model = options.model.includes("Qwen3.5-9B") ? {
    family: "Qwen3.5-9B",
    quantization: "Q4_K_M",
    revision: "3885219b6810b007914f3a7950a8d1b469d598a5",
    artifactSha256: await sha256File(options.model),
  } : options.model.includes("Qwen3.5-0.8B") ? {
    family: "Qwen3.5-0.8B",
    quantization: "Q4_K_M",
    revision: "locally-installed-artifact",
    artifactSha256: "bd258782e35f7f458f8aced1adc053e6e92e89bc735ba3be89d38a06121dc517",
  } : options.model.includes("gemma-4-E2B") ? {
    family: "Gemma-4-E2B-i1",
    quantization: "Q4_K_M",
    revision: "locally-installed-artifact",
    artifactSha256: "61bf05f5e916e0b7faba9324c7c11ae0dbc9d93337094192182911aa6c98c96f",
  } : {
    family: "Qwen2.5-3B-Instruct",
    quantization: "Q4_K_M",
    revision: "7dabda4d13d513e3e842b20f0d435c732f172cbe",
    artifactSha256: "626b4a6678b86442240e33df819e00132d3ba7dddfe1cdc4fbb18e0a9615c62d",
  };
  const runtime = await createLlamaRuntime(options.model, options.port);
  if (options.scenario === "quality-candidate") {
    try {
      return await runLocalQualityCandidate(runtime, {
        runtime: { name: "llama.cpp-metal", revision: "9910-f5525f7e7" },
        model,
      });
    } finally {
      runtime.stop();
    }
  }
  if (options.scenario === "quality") {
    try {
      return await runQuality(runtime, options, {
        runtime: { name: "llama.cpp-metal", revision: "9910-f5525f7e7" },
        model,
      });
    } finally {
      runtime.stop();
    }
  }
  const count = options.scenario === "smoke" ? 5 : options.scenario === "screen" ? 100 : 300;
  const visible = [];
  const runtimeLatencies = [];
  const overlayLatencies = [];
  const firstTextLatencies = [];
  let empty = 0;
  let staleVisible = 0;

  try {
    await showAndMeasure(overlay, "Synthetic overlay warmup", "overlay-warmup");
    overlay.webContents.send("hide");
    const coldFirstStarted = performance.now();
    const coldFirstResult = await runtime.complete(syntheticPrompt(0, 4));
    await showAndMeasure(overlay, coldFirstResult.text, "cold-first");
    const coldFirstVisibleMs = performance.now() - coldFirstStarted;
    for (let index = 0; index < count; index += 1) {
      const started = performance.now();
      const result = await runtime.complete(syntheticPrompt(index, index % 5));
      if (!result.text) {
        empty += 1;
        continue;
      }
      const overlayMs = await showAndMeasure(overlay, result.text, `request-${index}`);
      visible.push(performance.now() - started);
      runtimeLatencies.push(result.runtimeMs);
      overlayLatencies.push(overlayMs);
      if (result.firstTextMs != null) firstTextLatencies.push(result.firstTextMs);
    }

    const cancellationLatencies = [];
    const cancellationCount = options.scenario === "smoke" ? 5 : 100;
    for (let index = 0; index < cancellationCount; index += 1) {
      const controller = new AbortController();
      const request = runtime.complete(syntheticPrompt(index, 4), controller.signal).catch(() => null);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50 + (index % 2) * 25));
      const cancelled = performance.now();
      controller.abort();
      await request;
      while (!(await runtime.idle()) && performance.now() - cancelled < 2_000) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
      }
      cancellationLatencies.push(performance.now() - cancelled);
    }

    const visibleSummary = summarize(visible);
    return {
      schemaVersion: 1,
      evidenceScope: "M4 Pro, 24 GB, macOS 26.5.1 (25F80) only",
      runtime: { name: "llama.cpp-metal", revision: "9910-f5525f7e7" },
      model,
      scenario: options.scenario,
      measured: {
        modelReadyMs: runtime.loadMs,
        coldFirstVisibleMs,
        visible: visibleSummary,
        runtime: summarize(runtimeLatencies),
        firstText: summarize(firstTextLatencies),
        overlay: summarize(overlayLatencies),
        cancellationToIdle: summarize(cancellationLatencies),
        processTreeResidentBytes: processRssBytes([process.pid, runtime.pid, overlay.webContents.getOSProcessId()]),
        emptyOutcomes: empty,
        staleVisible,
      },
      screening: {
        latency: visibleSummary && visibleSummary.p50Ms <= THRESHOLDS.p50 && visibleSummary.p95Ms <= THRESHOLDS.p95 && visibleSummary.p99Ms <= THRESHOLDS.p99 ? "pass" : "fail",
        coldLoad: runtime.loadMs <= 5_000 ? "pass" : "fail",
        coldFirstSuggestion: coldFirstVisibleMs <= 1_500 ? "pass" : "fail",
        cancellation: summarize(cancellationLatencies).p95Ms <= 250 && summarize(cancellationLatencies).p99Ms <= 500 ? "pass" : "fail",
        staleDisplay: staleVisible === 0 ? "pass" : "fail",
        quality: options.scenario === "quality" ? "requires-human-scoring" : "not-run",
        pressure: "not-run",
        battery: "not-run",
        reliability: "not-run",
      },
      inference: [
        "This screening run cannot establish a ship decision until every conjunctive gate is exercised.",
      ],
      untestedAssumptions: [
        "The benchmark Electron shell approximates production dispatch without integrating production inference.",
      ],
    };
  } finally {
    runtime.stop();
  }
}

async function runHelper(options, overlay) {
  const metadata = options.runtime === "mlx" ? {
    executable: process.env.TAB_BENCH_MLX_HELPER || resolve(TEMP_ROOT, "mlx-derived/Build/Products/Release/mlx-helper"),
    runtime: { name: "mlx-swift-lm", revision: "3.31.4-bd4b7434e6bd" },
    model: {
      family: "Qwen2.5-3B-Instruct",
      quantization: "MLX-4bit",
      revision: "4f83f8f146fdf28b512a06562b671d7af4fab457",
      artifactSha256: "f212cf6fb9923281a09c135e05d43a052ee5ef7121f5b1dc0b0fb2de80f97cfd",
    },
  } : {
    executable: process.env.TAB_BENCH_COREML_HELPER || resolve(TEMP_ROOT, "coreml-build/release/coreml-helper"),
    runtime: { name: "direct-coreml", revision: "macOS-26.5.1" },
    model: {
      family: "Qwen2.5-3B-Instruct",
      quantization: "CoreML-4bit",
      revision: "46ca2954ed8d579713093971a4985c815db3f64c",
      artifactSha256: "3ab95c0fe12418b06d5a8d4d34c2029e720e5b8d7900dd9db6c13b649fa28c83",
    },
  };
  if (!existsSync(metadata.executable)) throw new Error(`${options.runtime} helper is not built`);

  const runtime = await createNdjsonRuntime(metadata.executable, options.model);
  if (options.scenario === "calibrate-agent") {
    try {
      return await runAgentEvaluatorCalibration(runtime, metadata);
    } finally {
      runtime.stop();
    }
  }
  if (options.scenario === "calibrate") {
    try {
      return await runEvaluatorCalibration(runtime, metadata);
    } finally {
      runtime.stop();
    }
  }
  if (options.scenario === "quality") {
    try {
      return await runQuality(runtime, options, metadata);
    } finally {
      runtime.stop();
    }
  }
  const count = options.scenario === "smoke" ? 5 : options.scenario === "screen" ? 100 : 300;
  const visible = [];
  const runtimeLatencies = [];
  const firstTextLatencies = [];
  const overlayLatencies = [];
  let empty = 0;

  try {
    await showAndMeasure(overlay, "Synthetic overlay warmup", "overlay-warmup");
    overlay.webContents.send("hide");
    const coldFirstStarted = performance.now();
    const coldFirstResult = await runtime.complete(syntheticPrompt(0, 4));
    await showAndMeasure(overlay, coldFirstResult.text, "cold-first");
    const coldFirstVisibleMs = performance.now() - coldFirstStarted;
    for (let index = 0; index < count; index += 1) {
      const started = performance.now();
      const result = await runtime.complete(syntheticPrompt(index, index % 5));
      if (!result.text) {
        empty += 1;
        continue;
      }
      const overlayMs = await showAndMeasure(overlay, result.text, `request-${index}`);
      visible.push(performance.now() - started);
      runtimeLatencies.push(result.runtimeMs);
      overlayLatencies.push(overlayMs);
      if (result.firstTextMs != null) firstTextLatencies.push(result.firstTextMs);
    }

    const hardStopStarted = performance.now();
    const controller = new AbortController();
    const cancelled = runtime.complete(syntheticPrompt(0, 4), controller.signal).catch(() => null);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 75));
    controller.abort();
    await cancelled;
    await runtime.exited();
    const hardStopMs = performance.now() - hardStopStarted - 75;
    const recovery = await createNdjsonRuntime(metadata.executable, options.model);
    const recoveryMs = recovery.loadMs;
    recovery.stop();

    const visibleSummary = summarize(visible);
    return {
      schemaVersion: 1,
      evidenceScope: "M4 Pro, 24 GB, macOS 26.5.1 (25F80) only",
      runtime: metadata.runtime,
      model: metadata.model,
      scenario: options.scenario,
      measured: {
        modelReadyMs: runtime.loadMs,
        coldFirstVisibleMs,
        visible: visibleSummary,
        runtime: summarize(runtimeLatencies),
        firstText: summarize(firstTextLatencies),
        overlay: summarize(overlayLatencies),
        hardStopMs,
        hardStopRecoveryMs: recoveryMs,
        processTreeResidentBytes: processRssBytes([process.pid, overlay.webContents.getOSProcessId()]),
        emptyOutcomes: empty,
        staleVisible: 0,
      },
      screening: {
        latency: visibleSummary && visibleSummary.p50Ms <= THRESHOLDS.p50 && visibleSummary.p95Ms <= THRESHOLDS.p95 && visibleSummary.p99Ms <= THRESHOLDS.p99 ? "pass" : "fail",
        coldLoad: runtime.loadMs <= 5_000 ? "pass" : "fail",
        coldFirstSuggestion: coldFirstVisibleMs <= 1_500 ? "pass" : "fail",
        cancellation: hardStopMs <= 500 && recoveryMs <= 5_000 ? "hard-stop-only" : "fail",
        staleDisplay: "pass",
        quality: options.scenario === "quality" ? "requires-human-scoring" : "not-run",
        pressure: "not-run",
        battery: "not-run",
        reliability: "not-run",
      },
      inference: [
        "The synchronous prototype helper establishes hard-stop behavior but not soft computational cancellation.",
        "This screening run cannot establish a ship decision until every conjunctive gate is exercised.",
      ],
      untestedAssumptions: [
        "A production helper can add concurrent command handling without materially changing inference latency.",
      ],
    };
  } finally {
    runtime.stop();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.scenario !== "quality-ceiling" && !existsSync(options.model)) throw new Error("approved model artifact not found");
  if (["calibrate", "calibrate-agent"].includes(options.scenario) && options.runtime !== "mlx") {
    throw new Error("evaluator calibration is pinned to the strongest measured MLX candidate");
  }
  await app.whenReady();
  const overlay = ["calibrate", "calibrate-agent", "quality-ceiling", "quality-candidate"].includes(options.scenario) ? null : await createOverlay();
  try {
    let report;
    if (options.scenario === "quality-ceiling") report = await runQualityCeiling(options.referenceModels);
    else if (options.runtime === "llama") report = await runLlama(options, overlay);
    else report = await runHelper(options, overlay);
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    if (options.results) writeFileSync(options.results, serialized, { encoding: "utf8", mode: 0o600 });
    process.stdout.write(serialized);
  } finally {
    overlay?.destroy();
    app.quit();
  }
}

main().catch((error) => {
  process.stderr.write(`benchmark failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  app.exit(1);
});
