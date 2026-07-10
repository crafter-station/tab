import path from "node:path";
import { Output, generateText } from "ai";
import { z } from "zod";
import {
  isSuggestionContractValid,
  MAX_SUGGESTION_WORDS,
} from "@tab/suggestion-policy";
import { createLocalInferencePrototype } from "../src/main/local-inference-prototype.ts";
import {
  createSafeTypingContextSnapshot,
  isRequestableTypingContextSnapshot,
} from "../src/main/typing-context.ts";
import { SUGGESTION_EVAL_CASES } from "./suggestion-cases.ts";

const EVALUATOR_MODEL = "meta/muse-spark-1.1";
const EvaluationSchema = z.object({
  pass: z.boolean(),
  reason: z.string(),
});

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const modelPath = argument("--model") ?? process.env.TAB_LOCAL_INFERENCE_MODEL_PATH;
if (!modelPath) throw new Error("Pass --model /absolute/model.gguf or set TAB_LOCAL_INFERENCE_MODEL_PATH");
if (!process.env.AI_GATEWAY_API_KEY) throw new Error("AI_GATEWAY_API_KEY is required");

const runtime = createLocalInferencePrototype({
  executablePath: process.env.TAB_LOCAL_INFERENCE_EXECUTABLE ?? "/opt/homebrew/bin/llama-server",
  modelPath: path.resolve(modelPath),
  port: Number(argument("--port") ?? process.env.TAB_EVAL_LLAMA_PORT ?? 39_283),
});

let failures = 0;
try {
  await runtime.start();
  if (runtime.getStatus().status !== "ready") {
    throw new Error(`Local inference is not ready: ${JSON.stringify(runtime.getStatus())}`);
  }

  for (const testCase of SUGGESTION_EVAL_CASES) {
    const snapshot = createSafeTypingContextSnapshot({
      context: testCase.draft,
      activeApplication: { bundleId: testCase.app },
      secureInput: false,
      paused: false,
      privateContext: false,
      contextSource: "typed_text",
      memoryEligible: true,
    });
    if (!isRequestableTypingContextSnapshot(snapshot)) {
      throw new Error(`Eval case ${testCase.id} is not requestable`);
    }

    const suggestion = await runtime.getSuggestion(snapshot);
    const text = suggestion?.text ?? "";
    const deterministicPass = isSuggestionContractValid(testCase.draft, text)
      && text.trim().split(/\s+/u).filter(Boolean).length <= MAX_SUGGESTION_WORDS;

    let evaluatorPass = false;
    let reason = "deterministic contract failure";
    if (deterministicPass) {
      const { output } = await generateText({
        model: EVALUATOR_MODEL,
        output: Output.object({ schema: EvaluationSchema }),
        system: "You evaluate inline autocomplete. Pass only when the candidate is a natural, immediately useful continuation that a user could accept verbatim. It must continue rather than answer the draft, contain at most three words, preserve language and grammar, avoid invented specifics, and contain no role labels, transcript framing, explanations, or repeated draft text.",
        prompt: `Draft: ${JSON.stringify(testCase.draft)}\nCandidate: ${JSON.stringify(text)}\nIntent: ${testCase.intent}`,
      });
      evaluatorPass = output.pass;
      reason = output.reason;
    }

    const passed = deterministicPass && evaluatorPass;
    if (!passed) failures += 1;
    console.log(`${passed ? "PASS" : "FAIL"} ${testCase.id}: ${JSON.stringify(text)} - ${reason}`);
  }
} finally {
  runtime.stop();
}

console.log(`\n${SUGGESTION_EVAL_CASES.length - failures}/${SUGGESTION_EVAL_CASES.length} evals passed with ${EVALUATOR_MODEL}`);
if (failures > 0) process.exitCode = 1;
