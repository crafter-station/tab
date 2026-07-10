# Local Suggestion Benchmark Prototype Results

Evidence current to July 9, 2026 for [Prototype the local Suggestion benchmark](https://github.com/crafter-station/tab/issues/63).

This is disposable prototype evidence, not a production runtime selection. It applies only to the tested M4 Pro Mac with 24 GB memory on macOS 26.5.1 (25F80). It does not establish support for 8 GB Macs or any other hardware.

## Outcome after AC screening

- **AC screening survivors:** Qwen3.5 0.8B Q4_K_M through `llama.cpp`, Qwen2.5 3B Q4_K_M through `llama.cpp`, Qwen2.5 3B 4-bit through MLX Swift, and Gemma 4 E2B Q4_K_M through `llama.cpp` each passed three independent 100-request latency and startup screens on AC power in high-power mode.
- **AC screening failure:** the tested stateful Core ML Qwen2.5 3B 4-bit conversion still failed warm latency, startup, cold-first-Suggestion, and hard-stop recovery.
- **Inconclusive:** none of the four screening survivors has passed quality, pressure, battery impact, complete cancellation, or reliability gates. MLX demonstrated helper hard-stop recovery but not soft computational cancellation.
- No combination can yet be called an acceptance pass. The rerun used only local processing; no cloud Suggestions, quality judging, or cloud stress workload ran.
- Subsequent quality results are recorded in [`local-suggestion-quality-results.md`](./local-suggestion-quality-results.md). All four screening survivors failed contract-compliance and sensitive-withholding gates and were rejected before resource/reliability validation.

## Documented facts

- The prototype source is under [`apps/desktop/benchmarks/`](../../apps/desktop/benchmarks/). It is excluded from Electron packaging and is not referenced by production startup.
- Inference is dispatched from a separate benchmark Electron main process through the real built preload and overlay renderer. The runtime is a child helper/server, not an integration into Tab's production Suggestion path.
- Synthetic prompts and synthetic Personal Memory inputs exist only in process memory. Generated Suggestions cross ephemeral helper/Electron IPC only.
- Persisted result files contain revisions, hashes, coarse hardware scope, aggregate timings, counts, and outcomes. They contain no prompts, Personal Memory content, generated Suggestions, credentials, or machine identifiers.
- The common-model artifacts were pinned and SHA-256 verified:
  - Qwen2.5 3B GGUF Q4_K_M: `626b4a6678b86442240e33df819e00132d3ba7dddfe1cdc4fbb18e0a9615c62d`.
  - Qwen2.5 3B MLX 4-bit: `f212cf6fb9923281a09c135e05d43a052ee5ef7121f5b1dc0b0fb2de80f97cfd`.
  - Qwen2.5 3B Core ML 4-bit weights: `3ab95c0fe12418b06d5a8d4d34c2029e720e5b8d7900dd9db6c13b649fa28c83`.
- Runtime pins were `llama.cpp` build 9910 (`f5525f7e7`) and `mlx-swift-lm` 3.31.4. The Core ML helper used the macOS system framework and a fresh `MLState` per request.
- Installed artifact sizes were approximately 2.0 GB GGUF, 1.6 GB MLX, and 1.8 GB Core ML. The local Qwen3.5 GGUF was 508 MiB; the local Gemma GGUF was 3.23 GiB.

## Measured results

Latency is complete warm Electron request dispatch through visible overlay rendering and excludes Tab's existing 300 ms typing debounce. A single failed independent screen is sufficient to reject a configuration because every run must pass all gates.

### Initial battery/low-power session

| Runtime and artifact | Runs | P50 visible | P95 visible | P99 visible | Model ready | Cold first visible | Result |
|---|---:|---:|---:|---:|---:|---:|---|
| `llama.cpp` Qwen3.5 0.8B Q4_K_M | 1 | 258.6 ms | 331.9 ms | 355.5 ms | 1.51 s | 583 ms | Pass |
| `llama.cpp` Qwen3.5 0.8B Q4_K_M | 2 | 291.7 ms | 385.3 ms | 400.2 ms | 1.08 s | 207 ms | Pass |
| `llama.cpp` Qwen3.5 0.8B Q4_K_M | 3 | 295.1 ms | 387.9 ms | 402.4 ms | 1.08 s | 231 ms | Pass |
| `llama.cpp` Qwen2.5 3B Q4_K_M | 1 | 459.2 ms | 633.7 ms | 774.1 ms | 2.40 s | 340 ms | Fail P50 |
| MLX Swift Qwen2.5 3B 4-bit | 1 | 375.3 ms | 499.9 ms | 591.2 ms | 1.45 s | 493 ms | Fail P50 |
| `llama.cpp` Gemma 4 E2B Q4_K_M | 1 | 718.4 ms | 925.2 ms | 953.1 ms | 3.54 s | 848 ms | Fail P50/P95 |
| Core ML Qwen2.5 3B 4-bit | Smoke | 4,975 ms | 5,891 ms | 5,891 ms | 54.70 s | 7.53 s | Fail multiple gates |

### AC high-power rerun

The rerun began at 100% charge while connected to AC power with macOS high-power mode enabled. The machine reported 34% system-wide memory free, but already had 14.96 GB of encrypted swap in use. No inference helpers were resident before the run. Configurations ran sequentially under `caffeinate`; no cloud processing ran.

| Runtime and artifact | Runs | P50 visible | P95 visible | P99 visible | Model ready | Cold first visible | Result |
|---|---:|---:|---:|---:|---:|---:|---|
| `llama.cpp` Qwen3.5 0.8B Q4_K_M | 3 | 166.4-166.9 ms | 200.6-214.2 ms | 208.5-228.1 ms | 1.07-1.72 s | 167-188 ms | Pass 3/3 |
| `llama.cpp` Qwen2.5 3B Q4_K_M | 3 | 261.0-264.5 ms | 339.4-350.3 ms | 367.9-382.0 ms | 1.70-3.87 s | 280-288 ms | Pass 3/3 |
| MLX Swift Qwen2.5 3B 4-bit | 3 | 221.2-225.1 ms | 282.3-283.9 ms | 291.6-297.6 ms | 0.60-0.94 s | 492-556 ms | Pass 3/3 latency/startup |
| `llama.cpp` Gemma 4 E2B Q4_K_M | 3 | 324.1-326.9 ms | 388.1-394.6 ms | 402.3-418.9 ms | 2.38-4.39 s | 292-314 ms | Pass 3/3 |
| Core ML Qwen2.5 3B 4-bit | 1 | 3,207 ms | 4,090 ms | 4,786 ms | 63.99 s | 6.84 s | Fail multiple gates |

The large improvement versus the earlier battery run is measured, but causation is not isolated. AC high-power mode, a substantially different machine/cache state, and warmed system/runtime caches all changed between sessions.

### Cancellation and stale display

- Qwen3.5 screens each ran 100 cancellations at 50-75 ms after dispatch. Cancellation-to-idle P95 was 34.5 ms, 29.3 ms, and 29.0 ms; P99 was 43.1 ms, 47.4 ms, and 64.5 ms.
- Zero stale Suggestions were displayed in all recorded screens.
- Qwen2.5 through `llama.cpp` had 48.9 ms cancellation-to-idle P95 and 56.4 ms P99.
- The synchronous MLX prototype demonstrated a 55.7 ms helper hard stop and 642 ms restart, but did not establish soft computational cancellation.
- The Core ML prototype demonstrated a 320 ms helper hard stop but required 12.1 seconds to restore readiness, failing the recovery gate.
- The required 1,000-edit cancellation storm remains untested.

On the AC rerun:

- Qwen3.5 through `llama.cpp` had cancellation-to-idle P95 of 14.8-15.6 ms and P99 of 15.3-21.0 ms across three runs.
- Qwen2.5 through `llama.cpp` had P95 of 27.4-30.0 ms and P99 of 31.0-37.0 ms across three runs.
- Gemma through `llama.cpp` had P95 of 30.4-30.9 ms and P99 of 87.3-91.4 ms across three runs.
- MLX helper hard stop took 18.5-23.5 ms and restored readiness in 521-533 ms. Soft computational cancellation remains unmeasured.
- Core ML helper hard stop took 238 ms, but readiness recovery took 16.9 seconds and failed the 5-second gate.
- Zero stale Suggestions were displayed in all AC screens.

### Memory and disk

- Complete benchmark process-tree resident memory during the three Qwen3.5 screens was 1.33 GB, 1.34 GB, and 1.19 GB. This is below both absolute incremental ceilings, but a same-session no-model baseline and sampled inference peak are still required before calling the memory gate passed.
- Recorded complete process-tree resident memory was 2.61 GB for `llama.cpp` Qwen2.5 and 3.74 GB for `llama.cpp` Gemma.
- MLX and Core ML helper memory totals from the current aggregate report are invalid because the helper had already exited when sampled; no claim is made from those values.
- Runtime plus each tested model is below the 6 GB installed-size ceiling. Update peak, write volume, cleanup, and 99% model-removal reclamation were not measured.

AC process-tree resident measurements were 1.07-1.22 GB for `llama.cpp` Qwen3.5, 2.35-2.49 GB for `llama.cpp` Qwen2.5, and 2.69-3.79 GB for `llama.cpp` Gemma. These remain total benchmark-tree snapshots rather than incremental no-model baselines or sampled inference peaks. The MLX and Core ML aggregate sampler still ran after helper termination, so those helper memory values remain invalid.

### Quality, pressure, battery, and reliability

- A fixed 300-case synthetic corpus was implemented: 240 eligible continuations, 30 intentional no-Suggestion cases, and 30 locally withheld synthetic sensitive cases.
- Three quality attempts kept all prompt/output content ephemeral but did not complete because the configured remote evaluator sustained rate limits. No useful-continuation, harmfulness, remote-delta, or human-adjudication result exists.
- The Mac was on battery at 21% when the battery phase was reached, which could not support the required paired 60-minute trials at a matched charge range. No battery or thermal result exists.
- Critical pressure, 30-minute typing pressure, unload/reload, 10,000-request eight-hour soak, crash injection, and transition trials were not run because no candidate has cleared quality.

## Engineering inferences

- On this tested machine and prompt shape, model size and artifact architecture dominate completed-Suggestion latency more than overlay rendering; the warmed overlay typically added about 1-20 ms.
- Qwen3.5 remains the fastest tested candidate, but Qwen2.5 through MLX is the fastest tested 3B path and Qwen2.5 through `llama.cpp` also clears the AC latency gates.
- The measured AC results make Qwen3.5, both Qwen2.5 paths, and Gemma candidates for local quality evaluation. Their latency results do not imply acceptable usefulness or safety.
- The tested Core ML conversion is not representative of every possible Core ML conversion. Its result rejects only this exact artifact/helper configuration.
- The discrepancy between battery and AC sessions means power mode and initial machine state must become explicit benchmark controls; a candidate should not be rejected from a mixed-power comparison.

## Untested assumptions

- The benchmark Electron shell closely approximates production main-process dispatch overhead even though production local inference was deliberately not integrated.
- The locally installed Qwen3.5 and Gemma artifacts have sufficient provenance and licensing for disposable evaluation; production catalog eligibility has not been established.
- A production MLX helper could add concurrent command handling and soft cancellation without materially changing measured latency.
- Remote quality evaluation can complete later under a suitable evaluator quota without persisting evaluation content.

## Human review questions

1. Should Qwen3.5, both Qwen2.5 runtime paths, and Gemma remain screening survivors pending local, content-ephemeral quality evaluation?
2. Should the initial battery/low-power failures be treated as invalid for candidate rejection because the controlled AC rerun passed?
3. Should Core ML be recorded as failure for this exact conversion while the runtime architecture remains inconclusive for future conversions?
4. Should pressure, battery-impact, and long-soak work wait until quality passes, as required by the staged acceptance protocol?
