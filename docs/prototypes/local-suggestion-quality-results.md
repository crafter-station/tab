# Local Suggestion Quality Prototype Results

Evidence current to July 9, 2026 for [Compare local Suggestion quality of AC screening survivors](https://github.com/crafter-station/tab/issues/66).

This is disposable prototype evidence, not a production runtime selection. It applies only to the tested M4 Pro Mac with 24 GB memory on macOS 26.5.1 (25F80). It does not establish support for any other hardware.

## Outcome

None of the four AC screening survivors passed the predeclared quality gates. Every exact configuration failed both the 98% Suggestion contract-compliance gate and the 100% sensitive-withholding gate:

| Runtime and artifact | Contract compliance | Sensitive withholding | Result |
|---|---:|---:|---|
| `llama.cpp`/Metal + Qwen3.5 0.8B Q4_K_M | 80.8% | 10% | Reject |
| `llama.cpp`/Metal + Qwen2.5 3B Q4_K_M | 76.7% | 0% | Reject |
| MLX Swift + Qwen2.5 3B 4-bit | 97.5% | 10% | Reject |
| `llama.cpp`/Metal + Gemma 4 E2B Q4_K_M | 83.3% | 0% | Reject |

Because the gates are conjunctive, these failures reject every candidate regardless of its unmeasured usefulness, remote delta, or harmfulness. Remote baseline generation and blind judging were therefore skipped. No human adjudication was needed, and no candidate advances to resource, battery, cancellation-storm, or reliability testing.

## Method

- Corpus fingerprint: `64cde22ed1a077f0f30f0372847cf0d2f913c5362e346c3461aab70d33be0332`.
- Fixed corpus: 240 eligible continuations, 30 intentional no-Suggestion cases, and 30 synthetic sensitive cases.
- Eligible cases cover messages, email, notes, documents, edited context, multiline context, Unicode, Personal Memory shortlist sizes from zero to three, and nearby App Context depths from zero to eight.
- Every candidate used the production Suggestion prompt and normalization contract with its pinned artifact and runtime from the AC screen.
- Candidate text remained in memory. Persisted reports contain only aggregate counts, rates, artifact identities, and the corpus fingerprint.
- Content-free result inspection found no Typing Context, Personal Memory content, generated Suggestions, credentials, or machine identifiers.

## Decision

Do not stress-test or select any current screening survivor. The next prototype should test a complete local Suggestion configuration that adds deterministic sensitive-context withholding before inference and bounded contract enforcement after inference. It must rerun all quality gates; preprocessing cannot be used to conceal harmful or low-usefulness outputs.
