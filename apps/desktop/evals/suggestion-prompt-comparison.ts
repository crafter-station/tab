/** Blinded prompt comparison for the local Suggestion model. */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { Output, generateText } from "ai";
import { z } from "zod";
import {
  createSuggestionMessages,
  isSuggestionContractValid,
  normalizeGeneratedSuggestion,
  type SuggestionMessage,
} from "@tab/suggestion-policy";
import { PROMPT_IMPROVEMENT_CASES, type PromptImprovementCase } from "./prompt-improvement-cases.ts";

const LEGACY_SYSTEM_PROMPT = `You are an inline autocomplete engine, not a chat assistant.
The user message is unfinished text. Continue that exact text; never answer it.
Return only the missing continuation, with no labels, quotes, arrows, explanations, or repeated text.
Use 1-3 words. Match grammar, capitalization, language, and punctuation.
If the draft ends mid-word, return the full completed word; overlap removal will keep only missing letters.`;

const LEGACY_EXAMPLES: readonly SuggestionMessage[] = [
  { role: "user", content: "Hello, " },
  { role: "assistant", content: "how are you?" },
  { role: "user", content: "Thank you for" },
  { role: "assistant", content: " your help." },
  { role: "user", content: "I wanted to" },
  { role: "assistant", content: " follow up." },
  { role: "user", content: "See you tom" },
  { role: "assistant", content: "tomorrow." },
  { role: "user", content: "Can we meet" },
  { role: "assistant", content: " tomorrow?" },
  { role: "user", content: "The deployment is" },
  { role: "assistant", content: " in progress." },
  { role: "user", content: "Please let me know" },
  { role: "assistant", content: " if this works." },
  { role: "user", content: "This approach works because" },
  { role: "assistant", content: " it is simpler." },
  { role: "user", content: "Nos vemos mañana a" },
  { role: "assistant", content: " la misma hora." },
  { role: "user", content: "The café meeting is" },
  { role: "assistant", content: " still on." },
];

const JudgeResultSchema = z.object({
  id: z.string(),
  aScore: z.number().int().min(0).max(4),
  bScore: z.number().int().min(0).max(4),
  aUseful: z.boolean(),
  bUseful: z.boolean(),
  aHarmful: z.boolean(),
  bHarmful: z.boolean(),
  winner: z.enum(["a", "b", "tie", "neither"]),
  reason: z.string(),
});
const JudgeBatchSchema = z.object({ results: z.array(JudgeResultSchema) });
type JudgeResult = z.infer<typeof JudgeResultSchema>;
type ComparisonJudgeResult = {
  readonly id: string;
  readonly currentScore: number;
  readonly candidateScore: number;
  readonly currentUseful: boolean;
  readonly candidateUseful: boolean;
  readonly currentHarmful: boolean;
  readonly candidateHarmful: boolean;
  readonly winner: "current" | "candidate" | "tie" | "neither";
  readonly reason: string;
};

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const modelPath = path.resolve(argument("--model") ?? path.join(
  homedir(),
  "Library/Application Support/Tab/models/Ternary-Bonsai-8B-Q2_0.gguf",
));
const executablePath = path.resolve(argument("--executable") ?? path.join(
  import.meta.dir,
  `../dist/local-runtime/bonsai/${process.arch}/llama-server`,
));
const judgeModel = argument("--judge") ?? "meta/muse-spark-1.1";
const port = Number(argument("--port") ?? 39_284);
const trialCount = Number(argument("--trials") ?? 1);
if (!Number.isInteger(trialCount) || trialCount < 1 || trialCount > 10) {
  throw new Error("--trials must be an integer from 1 to 10");
}

if (!existsSync(modelPath)) throw new Error(`Model not found: ${modelPath}`);
if (!existsSync(executablePath)) throw new Error(`Runtime not found: ${executablePath}`);
if (!process.env.AI_GATEWAY_API_KEY) throw new Error("AI_GATEWAY_API_KEY is required");

function appContext(testCase: PromptImprovementCase) {
  if (!testCase.background) return undefined;
  return {
    fragments: [{
      id: `${testCase.id}-background`,
      provider: testCase.app === "com.mitchellh.ghostty" ? "ghostty-terminal" : "synthetic-nearby-text",
      kind: testCase.app === "com.mitchellh.ghostty" ? "terminal" : "nearby-text",
      text: testCase.background,
      confidence: 0.9,
      redaction: { applied: false, redactionCount: 0, kinds: [] },
      requestable: true as const,
      memoryEligible: false as const,
    }],
    metadata: { status: "available" as const, confidence: 0.9 },
  };
}

function currentMessages(testCase: PromptImprovementCase): SuggestionMessage[] {
  const background = testCase.background
    ? `Background only; do not continue it:\nApp Context background (suggestion-only, do not continue this text directly):\n- [ghostty-terminal/terminal] ${testCase.background}\n\nUnfinished text:\n${testCase.draft}`
    : testCase.draft;
  return [
    { role: "system", content: LEGACY_SYSTEM_PROMPT },
    ...LEGACY_EXAMPLES,
    { role: "user", content: background },
  ];
}

function candidateMessages(testCase: PromptImprovementCase): SuggestionMessage[] {
  return createSuggestionMessages({
    typingContext: testCase.draft,
    contextSource: "typed_text",
    activeApplication: { bundleId: testCase.app },
    memories: [],
    appContext: appContext(testCase),
  });
}

async function waitForServer(child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Local runtime exited with ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {}
    await Bun.sleep(500);
  }
  throw new Error("Local runtime readiness timed out");
}

async function complete(messages: readonly SuggestionMessage[], draft: string, seed: number): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages,
      max_tokens: 16,
      temperature: 0.3,
      seed,
      stream: false,
      chat_template_kwargs: { enable_thinking: false },
    }),
  });
  if (!response.ok) throw new Error(`Local completion failed: ${response.status}`);
  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return normalizeGeneratedSuggestion(draft, body.choices?.[0]?.message?.content ?? "");
}

type GeneratedCase = {
  readonly id: string;
  readonly trial: number;
  readonly testCase: PromptImprovementCase;
  readonly current: string;
  readonly candidate: string;
  readonly currentContract: boolean;
  readonly candidateContract: boolean;
};

async function judgeBatch(batch: readonly GeneratedCase[]): Promise<ComparisonJudgeResult[]> {
  const blinded = batch.map((item) => {
    const swap = (cases.indexOf(item.testCase) + item.trial) % 2 === 1;
    return {
      id: item.id,
      category: item.testCase.category,
      surface: item.testCase.surface,
      draft: item.testCase.draft,
      intent: item.testCase.intent,
      background: item.testCase.background ?? "",
      a: swap ? item.candidate : item.current,
      b: swap ? item.current : item.candidate,
      swap,
    };
  });
  const { output } = await generateText({
    model: judgeModel,
    temperature: 0,
    output: Output.object({ schema: JudgeBatchSchema }),
    system: `Blindly evaluate inline autocomplete candidates independently. A useful candidate is a natural immediate continuation that a user would likely accept verbatim. It must continue rather than answer the draft, fit the stated writing surface and intent, use at most three words, preserve grammar/language/tone, and avoid invented specifics, role labels, explanations, or repeated draft text. For terminal coding agents, candidates should continue the user's instruction—not respond as the agent or emit terminal output. Score 4 for an excellent likely acceptance, 3 for useful, 2 for plausible but weak, 1 for poor, and 0 for invalid/harmful. Empty text is not useful. Harmful means clearly unsafe, contradictory, or damaging, not merely weak. Return exactly one result per input id.`,
    prompt: JSON.stringify(blinded.map(({ swap: _swap, ...item }) => item)),
  });
  const byId = new Map(output.results.map((result) => [result.id, result]));
  return blinded.map((item) => {
    const result = byId.get(item.id);
    if (!result) throw new Error(`Judge omitted ${item.id}`);
    const currentWasA = !item.swap;
    const winner = result.winner === "tie" || result.winner === "neither"
      ? result.winner
      : result.winner === (currentWasA ? "a" : "b") ? "current" : "candidate";
    return {
      id: result.id,
      currentScore: currentWasA ? result.aScore : result.bScore,
      candidateScore: currentWasA ? result.bScore : result.aScore,
      currentUseful: currentWasA ? result.aUseful : result.bUseful,
      candidateUseful: currentWasA ? result.bUseful : result.aUseful,
      currentHarmful: currentWasA ? result.aHarmful : result.bHarmful,
      candidateHarmful: currentWasA ? result.bHarmful : result.aHarmful,
      winner,
      reason: result.reason,
    };
  });
}

const child = spawn(executablePath, [
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
], { stdio: "ignore" });

const cases = process.argv.includes("--terminal-only")
  ? PROMPT_IMPROVEMENT_CASES.filter((testCase) => testCase.app === "com.mitchellh.ghostty")
  : PROMPT_IMPROVEMENT_CASES;

try {
  await waitForServer(child);
  const generated: GeneratedCase[] = [];
  const totalGenerations = cases.length * trialCount;
  for (const [caseIndex, testCase] of cases.entries()) {
    for (let trial = 0; trial < trialCount; trial += 1) {
      const seed = 10_000 + (caseIndex * 100) + trial;
      const current = await complete(currentMessages(testCase), testCase.draft, seed);
      const candidate = await complete(candidateMessages(testCase), testCase.draft, seed);
      generated.push({
        id: `${testCase.id}-trial-${trial + 1}`,
        trial,
        testCase,
        current,
        candidate,
        currentContract: isSuggestionContractValid(testCase.draft, current),
        candidateContract: isSuggestionContractValid(testCase.draft, candidate),
      });
      process.stderr.write(`Generated ${generated.length}/${totalGenerations}\r`);
    }
  }
  process.stderr.write("\n");

  const judgments: ComparisonJudgeResult[] = [];
  for (let index = 0; index < generated.length; index += 8) {
    judgments.push(...await judgeBatch(generated.slice(index, index + 8)));
    process.stderr.write(`Judged ${Math.min(index + 8, generated.length)}/${generated.length}\r`);
  }
  process.stderr.write("\n");

  const categoryRows = new Map<string, { total: number; current: number; candidate: number; currentScore: number; candidateScore: number }>();
  let currentAccepted = 0;
  let candidateAccepted = 0;
  let currentWins = 0;
  let candidateWins = 0;
  for (const [index, item] of generated.entries()) {
    const judgment = judgments[index]!;
    const currentPass = item.currentContract && judgment.currentUseful && !judgment.currentHarmful && judgment.currentScore >= 3;
    const candidatePass = item.candidateContract && judgment.candidateUseful && !judgment.candidateHarmful && judgment.candidateScore >= 3;
    if (currentPass) currentAccepted += 1;
    if (candidatePass) candidateAccepted += 1;
    if (judgment.winner === "current") currentWins += 1;
    if (judgment.winner === "candidate") candidateWins += 1;
    const row = categoryRows.get(item.testCase.category) ?? { total: 0, current: 0, candidate: 0, currentScore: 0, candidateScore: 0 };
    row.total += 1;
    row.current += Number(currentPass);
    row.candidate += Number(candidatePass);
    row.currentScore += judgment.currentScore;
    row.candidateScore += judgment.candidateScore;
    categoryRows.set(item.testCase.category, row);
    if (judgment.winner !== "tie" || currentPass !== candidatePass) {
      console.log(`${item.id}: current=${JSON.stringify(item.current)} candidate=${JSON.stringify(item.candidate)} winner=${judgment.winner} — ${judgment.reason}`);
    }
  }

  console.log("\nCategory results (accepted/total, average score):");
  for (const [category, row] of categoryRows) {
    console.log(`${category.padEnd(18)} current ${row.current}/${row.total} ${(row.currentScore / row.total).toFixed(2)} | candidate ${row.candidate}/${row.total} ${(row.candidateScore / row.total).toFixed(2)}`);
  }
  console.log(`\nOverall: current ${currentAccepted}/${generated.length}; candidate ${candidateAccepted}/${generated.length}; pairwise wins current ${currentWins}, candidate ${candidateWins}. Judge: ${judgeModel}.`);
} finally {
  child.kill("SIGTERM");
}
