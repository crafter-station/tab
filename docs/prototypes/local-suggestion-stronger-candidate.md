# Stronger Local Suggestion Quality Candidate

Evidence current to July 10, 2026 for [Prototype a stronger local Suggestion quality candidate](https://github.com/crafter-station/tab/issues/72).

This is content-free automated quality evidence from the tested M4 Pro Mac with 24 GB memory on macOS 26.5.1 (25F80). It is not human acceptance calibration, a production runtime selection, or a resource, reliability, or broader hardware support claim.

## Exact configuration

- Runtime: `llama.cpp`/Metal build 9910 (`f5525f7e7`).
- Model: upstream Apache-2.0 Qwen3.5 9B, Q4_K_M GGUF from `unsloth/Qwen3.5-9B-GGUF` revision `3885219b6810b007914f3a7950a8d1b469d598a5`.
- Artifact: 5,680,522,464 bytes; SHA-256 `03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8`.
- Generation: local chat-completions endpoint, model chat template, thinking disabled, temperature 0.3, and 128 maximum completion tokens.
- Boundaries: exact production Suggestion prompt and normalization, deterministic secret-like Typing Context suppression before inference, and contract-invalid output withholding after inference.

The artifact size and quantization make this configuration plausible for the predeclared 6 GB installed-artifact and 7 GB warm-memory screens. This ticket did not measure or pass either resource gate.

## Method

- The unchanged 300-case corpus retained fingerprint `64cde22ed1a077f0f30f0372847cf0d2f913c5362e346c3461aab70d33be0332`.
- All 240 eligible cases were scored by the corrected Groq `openai/gpt-oss-20b` evaluator independently, without source identity or a paired alternative, at high reasoning effort.
- The unchanged current-remote control from the automated-ceiling run supplied the same-corpus remote-delta comparison.
- Typing Context, Personal Memory content, and generated Suggestions remained ephemeral. The retained artifact contains only aggregates, rejection categories, artifact identities, and the corpus fingerprint.

## Results

The exact configuration passed every preserved quality gate:

| Gate | Result | Threshold |
|---|---:|---:|
| Useful continuation | 206/240 (85.8%) | At least 70% |
| Delta from current remote control | +84.6 percentage points | No worse than -10 points |
| Emitted contract compliance | 240/240 (100%) | At least 98% |
| Harmful | 0/240 (0%) | At most 1% |
| Sensitive withholding | 30/30 (100%) | 100% |

All 240 eligible outputs already passed the contract before post-generation enforcement, so contract withholding did not inflate usefulness. The evaluator rejected 27 outputs as unnatural, five as irrelevant, and two as contradictory. It marked no output malformed or unsafe. Withholding on the 30 intentional no-Suggestion cases was 56.7%; this remains informational under the predeclared gates.

## Decision

- Advance this exact Qwen3.5 9B Q4_K_M configuration to resource and reliability validation.
- Do not generalize the result to another quantization, model revision, generation configuration, runtime revision, Mac, or evaluator protocol.
- Preserve the 70% usefulness threshold and the corrected independent-candidate evaluator.
- Human acceptance calibration remains unresolved. An automated quality pass does not substitute for it.
- Do not select or integrate this configuration for production unless it also passes every predeclared resource, battery, latency, cancellation, startup, disk, and reliability gate.
