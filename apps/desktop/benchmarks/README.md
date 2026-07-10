# Local Suggestion Benchmark Prototype

Throwaway prototype for [Prototype the local Suggestion benchmark](https://github.com/crafter-station/tab/issues/63).

## Question

Which pinned runtime, model, and quantization combinations can satisfy Tab's predeclared automatic Suggestion gates on this M4 Pro Mac with 24 GB memory? This prototype gathers evidence only. It does not select or integrate a production inference path, and its results do not apply to any other hardware.

## Privacy

The benchmark uses synthetic in-memory prompts. It never writes prompts, synthetic Personal Memory, generated text, credentials, or machine identifiers. Persisted reports contain only artifact revisions, coarse hardware facts, aggregate measurements, and pass/fail/inconclusive outcomes.

## Run

```sh
bun apps/desktop/benchmarks/run.ts --runtime llama --scenario smoke
```

Quality evaluation uses the exact current remote Suggestion model as its baseline and
requires `GROQ_API_KEY`. Candidate text remains in memory. If the order-swapped blind
judge disagrees, the command pauses for a human to adjudicate Candidate A and B in the
terminal; candidate identity stays hidden. Only aggregate rates and counts may be
written with `--results`.

Run quality evaluation from an interactive terminal so adjudication remains ephemeral:

```sh
bun --env-file=.dev.vars apps/desktop/benchmarks/run.ts --runtime llama --scenario quality --results /tmp/tab-quality-qwen25.json
```

Evaluator calibration uses the strongest measured local candidate and current remote
path on 24 balanced eligible cases. It presents 48 independently shuffled Suggestions
for blind human usefulness and harmfulness review, then prints only aggregate agreement,
order-sensitivity, and disagreement slices. Run it interactively; do not redirect the
review session or inspect the implementation while judging candidate identity:

```sh
bun --env-file=.dev.vars apps/desktop/benchmarks/run.ts --runtime mlx --scenario calibrate --results /tmp/tab-evaluator-calibration.json
```

When live human review is unavailable, `calibrate-agent` runs the full fixed corpus and
compares the current order-swapped judge with a high-reasoning agent that evaluates each
candidate independently. This is automated robustness evidence only, not human acceptance
calibration, and cannot justify changing the 70% gate:

```sh
bun --env-file=.dev.vars apps/desktop/benchmarks/run.ts --runtime mlx --scenario calibrate-agent --results /tmp/tab-evaluator-agent-calibration.json
```

`quality-ceiling` checks whether one or two materially stronger remote references can
reach the unchanged 70% gate under the corrected independent acceptance protocol. It
reruns the current remote path for comparison and does not load a local runtime. The
default references are the current catalog models `anthropic/claude-sonnet-5` and
`openai/gpt-5.6-sol`; override either by repeating `--reference-model` at most twice:

```sh
bun --env-file=.dev.vars apps/desktop/benchmarks/run.ts --scenario quality-ceiling --results /tmp/tab-quality-ceiling.json
```

`quality-candidate` runs a stronger local `llama.cpp` candidate over the unchanged
corpus, applies the deterministic safety and contract boundaries, and evaluates every
eligible Suggestion independently with the corrected acceptance agent. It retains only
aggregate evidence and intentionally does not run resource or reliability gates:

```sh
bun --env-file=.dev.vars apps/desktop/benchmarks/run.ts --runtime llama --scenario quality-candidate --model /absolute/model.gguf --results /tmp/tab-local-quality-candidate.json
```

Model paths default to the disposable cache under `$TMPDIR/opencode/tab-local-suggestion-benchmark`. Override them with `--model` or the runtime-specific environment variables documented by `--help`.

Delete this directory after its findings have been captured in the issue and map.
