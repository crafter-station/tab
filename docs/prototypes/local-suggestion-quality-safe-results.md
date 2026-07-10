# Quality-Safe Local Suggestion Prototype Results

Evidence current to July 9, 2026 for [Prototype a quality-safe local Suggestion configuration](https://github.com/crafter-station/tab/issues/69).

This is disposable prototype evidence for the tested M4 Pro Mac with 24 GB memory on macOS 26.5.1 (25F80). It is not a production implementation, runtime selection, or support claim for any other hardware.

## Complete configuration

The prototype evaluated each AC screening survivor behind two deterministic boundaries already implied by Tab's architecture:

- Secret-like Typing Context is withheld before model invocation.
- Generated text that violates the Suggestion contract is withheld, not rewritten.

The safety detector matched all 30 synthetic-sensitive cases and none of the other 270 cases. Contract enforcement produced 100% compliance among emitted Suggestions for every candidate. Withheld eligible outputs remained not useful during scoring, so enforcement could not conceal low usefulness.

## Results

All candidates passed the deterministic safety and contract gates but failed the 70% useful-continuation gate conclusively:

| Runtime and artifact | Pre-enforcement contract | Emitted contract | Sensitive withholding | Useful-rate bounds | Result |
|---|---:|---:|---:|---:|---|
| `llama.cpp`/Metal + Qwen3.5 0.8B Q4_K_M | 80.8% | 100% | 100% | 0% | Reject |
| `llama.cpp`/Metal + Qwen2.5 3B Q4_K_M | 76.7% | 100% | 100% | 7.1%-12.1% | Reject |
| MLX Swift + Qwen2.5 3B 4-bit | 97.5% | 100% | 100% | 30.8%-49.6% | Reject |
| `llama.cpp`/Metal + Gemma 4 E2B Q4_K_M | 83.3% | 100% | 100% | 0.4%-1.25% | Reject |

Bounds conservatively treat every unresolved judge disagreement as useful for the upper bound. Because every upper bound remains below 70%, human adjudication cannot reverse any failure and was not required.

## Evaluator concern

The exact current remote model and Groq provider also received unexpectedly low usefulness judgments across repeated runs. This does not rescue any local candidate from the absolute 70% gate, but it weakens confidence that the synthetic corpus and automated usefulness judge represent human acceptance behavior.

The human review chose to calibrate the evaluator before expanding the model search or revisiting the threshold. Calibration should compare blinded human judgments with automated judgments on a stratified ephemeral sample, then preserve or revise the corpus and rubric based on measured agreement.

## Privacy

- Corpus fingerprint remained `64cde22ed1a077f0f30f0372847cf0d2f913c5362e346c3461aab70d33be0332`.
- Typing Context, Personal Memory content, and generated Suggestions remained ephemeral.
- Persisted reports contain only aggregate counts, rates, bounds, artifact identities, and the corpus fingerprint.
- The remote baseline used `openai/gpt-oss-20b` through the Groq provider; Vercel AI Gateway supplied quota-isolated transport and was restricted to Groq.
