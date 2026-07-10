# Apple Silicon Local Inference Runtime Comparison

Research current to July 9, 2026. This report answers [Compare Apple Silicon local inference runtimes](https://github.com/crafter-station/tab/issues/62). It narrows the candidates for a later benchmark on the available M4 Pro Mac with 24 GB memory; it does not select Tab's production runtime or establish support for untested Macs.

## Conclusion

Benchmark three runtime architectures behind the same app-owned native helper boundary:

1. **Pinned `llama.cpp` with Metal and GGUF** as the lowest-risk baseline.
2. **Direct Core ML with a stateful, quantized model** as the strongest Apple-optimized latency challenger.
3. **MLX Swift with `mlx-swift-lm`** as the most flexible Apple-native challenger.

`llama.cpp` has the broadest model support and the most controllable embedded surface. Core ML has the best relevant first-party latency evidence, but requires a per-model conversion and validation pipeline and macOS 15 for the stateful path. MLX Swift provides native generation, cache, streaming, and unusually strong memory instrumentation, but has a smaller model implementation surface than `llama.cpp` and a fast-moving API.

No primary source establishes acceptable Tab Suggestion latency or memory behavior on an 8 GB Mac for any candidate. An 8 GB target is not available and is outside this map's current validated scope. A model file's size, successful loading, prompt-processing throughput, or decode tokens per second is not evidence for an untested hardware tier.

## Evidence Labels

- **Fact** is directly supported by a cited primary source or the current Tab repository.
- **Inference** applies documented behavior to Tab's architecture but has not been measured in Tab.
- **Unknown** requires the benchmark prototype or a later product decision.

## Tab Constraints

The comparison is constrained by the current product rather than by general-purpose chat serving:

- **Fact:** Tab's runtime is an Electron native shell, and its directly distributed macOS artifacts are hardened, signed, and notarized. The build currently targets both `arm64` and `x64` and packages a Swift input helper outside ASAR. See [`docs/adr/0002-electron-native-shell-with-web-business-surface.md`](../adr/0002-electron-native-shell-with-web-business-surface.md), [`docs/adr/0036-direct-signed-notarized-macos-distribution.md`](../adr/0036-direct-signed-notarized-macos-distribution.md), [`apps/desktop/electron-builder.yml`](../../apps/desktop/electron-builder.yml), and [`apps/desktop/scripts/build-native.ts`](../../apps/desktop/scripts/build-native.ts).
- **Fact:** The Electron main process already spawns the native input helper with piped standard I/O. A separate inference helper therefore extends an existing packaging and process-control pattern rather than introducing the first native subprocess. See [`apps/desktop/src/main/index.ts`](../../apps/desktop/src/main/index.ts).
- **Fact:** automatic requests are debounced and stale cloud requests are both aborted and guarded by a request version. The local source currently receives no `AbortSignal`, so a real local runtime will need a cancellation contract. See [`apps/desktop/src/main/suggestion-loop.ts`](../../apps/desktop/src/main/suggestion-loop.ts) and [`docs/adr/0019-debounced-suggestion-requests-with-stale-response-checks.md`](../adr/0019-debounced-suggestion-requests-with-stale-response-checks.md).
- **Fact:** the current overlay waits for one short Suggestion rather than progressively rendering tokens. Runtime token streaming is still useful for reaching the first usable text quickly and stopping early; it does not by itself require streaming UI. See [`docs/adr/0005-non-streaming-suggestions-for-mvp.md`](../adr/0005-non-streaming-suggestions-for-mvp.md).
- **Fact:** Typing Context is bounded and in-memory, and telemetry excludes raw Typing Context and generated text by default. Helper logs, crash diagnostics, and benchmark traces must preserve those boundaries. See [`docs/adr/0018-in-memory-only-local-typing-context.md`](../adr/0018-in-memory-only-local-typing-context.md) and [`docs/adr/0022-metadata-only-suggestion-telemetry.md`](../adr/0022-metadata-only-suggestion-telemetry.md).
- **Inference:** loading a multi-gigabyte native runtime into Electron's main process would couple inference crashes and memory reclamation to input monitoring and overlays. A signed helper with framed IPC gives Tab failure isolation, a hard cancellation fallback, and deterministic reclamation by process termination. Electron itself positions utility processes for CPU-intensive or crash-prone work, although a standalone native helper is a better fit for C++ and Swift runtimes than a Node utility process [E1].

## Evidence Matrix

| Dimension | `llama.cpp` + Metal | Direct Core ML | MLX Swift + `mlx-swift-lm` |
|---|---|---|---|
| Relevant latency evidence | `llama-bench` separates prompt processing from token generation, but no official Tab-like TTFT matrix was found [L1] | Apple reports 51.91 ms TTFT and 33.67 token/s for an optimized Int4 Llama 3.1 8B on M1 Max with a 7-token prompt; not a Tab or base-chip result [C1] | API reports prompt prefill separately and streams generated chunks, but no official Tab-like hardware matrix was found [M2] |
| 8 GB evidence | None found | None; Apple's 4.2 GB weight artifact was tested on M1 Max [C1] | None; memory controls do not establish product feasibility [M3] |
| Model artifact | GGUF required; broad architecture and quantization coverage [L1] | Compiled Core ML model package; conversion and graph optimization are model-specific [C1][C2] | Safetensors plus model/tokenizer configuration, with a Swift model implementation/registry [M1][M2] |
| Native integration | C interface, static build, Metal enabled by default on macOS; official XCFramework also exists [L1][L2][L3] | System framework from a Swift/Objective-C helper; Tab owns tokenization and the generation loop | Swift package and native generation library; final Metal build must use Xcode or `xcodebuild` [M1] |
| Streaming | Direct token loop or streaming server endpoint [L3] | Tab must implement token-by-token prediction and IPC | `AsyncStream<Generation>` is provided [M2] |
| Cancellation | Logical cancellation between decode steps; documented abort callback currently works only on CPU execution [L2] | Straightforward between calls; no reviewed primary source promises interruption of an executing GPU prediction | Stream/task cancellation is modeled, but source warns work can continue briefly after early stream termination [M2] |
| Warm residency | Explicit model/context lifetime, mmap, warmup, context and KV-cache controls [L2][L3] | Keep `MLModel` and `MLState` alive; compiled/specialized cold and warm paths need measurement | Keep model container and KV cache alive; explicit active/cache/peak memory controls [M2][M3] |
| Memory pressure controls | mmap, optional mlock, context size, physical batch size, KV types, explicit free [L2][L3] | Model/state lifecycle, but fewer allocator controls exposed to the app | Active/cache/peak snapshots, cache and total limits, cache clearing, and wired-memory coordination [M3] |
| Signing surface | Helper plus any linked libraries/Metal assets | Smallest third-party runtime surface because Core ML ships with macOS | Helper plus MLX libraries and compiled Metal shaders |
| Runtime license | MIT [L4] | Core ML is an OS framework; conversion tooling uses a BSD 3-Clause license [C3] | MIT [M4] |
| Maintenance risk | Fast-moving API; pin source and validate upgrades | Per-model conversion plus OS/compiler behavior | Fast-moving packages and model implementations; current 3.x line documents breaking changes [M1] |

All three also require separate review of each model's weight license, redistribution terms, tokenizer assets, attribution, and acceptable-use restrictions. A runtime license does not license a model.

## Candidate 1: Pinned `llama.cpp` With Metal

### Documented capabilities

- Apple Silicon is a first-class target using ARM NEON, Accelerate, and Metal. Metal is enabled by default on macOS [L1][L3].
- The project exposes a C-style library API and can be built statically with `BUILD_SHARED_LIBS=OFF` [L2][L3]. An official XCFramework is another packaging option [L1].
- `llama.cpp` requires GGUF and lists broad text-model support and multiple integer quantization widths [L1].
- `llama-bench` reports prompt processing and token generation separately. These measurements are useful runtime diagnostics, but neither is Tab's request-to-visible-Suggestion latency [L1].
- Model loading exposes mmap and mlock. Context configuration exposes logical and physical batch sizes, thread counts, and KV-cache types. The library exposes explicit model/context free operations [L2].
- The server supports warmup, streaming, Unix sockets, prompt-prefix reuse, prompt-progress timings, and configurable cache behavior [L5].
- The C abort callback is documented as currently working only with CPU execution [L2]. Metal prefill must not be treated as promptly interruptible on that basis.

### Tab implications

- **Inference:** GGUF gives the Local Model Catalog the largest practical model pool and lets Tab own conversion and quantization rather than depend on third-party runtime downloads.
- **Inference:** use a pinned source revision and reproducible arm64 build. The project publishes explicit API-change notices, so following `master` would make release behavior non-reproducible [L1].
- **Inference:** start with mmap and do not enable mlock by default. Preventing compression or paging can make a warm model compete more aggressively with Electron and the active application, especially on lower-memory hardware that has not yet been validated.
- **Inference:** a minimal helper linked to `libllama` is preferable for production to the full `llama-server` surface. The server is useful for a benchmark spike because it already exposes streaming, timings, prefix reuse, and Unix sockets.
- **Inference:** new Typing Context should invalidate output immediately, then request computational cancellation. Decode can stop between token steps, but stale Metal prefill may require a grace deadline followed by helper restart.

### Unknowns

- Warm first-usable-text latency for representative Tab prompts and small approved models.
- Whether prompt-prefix reuse survives real app switches, deletions, and mid-text edits often enough to matter.
- Metal prefill drain time under cancellation storms and the cost of smaller physical batches.
- Peak and retained footprint under realistic memory pressure on the validated target.
- Whether a custom helper improves enough over a stripped, socket-bound server to justify immediate custom integration.

**Assessment:** benchmark baseline. It has the best combination of model breadth, embedded control, packaging flexibility, and low runtime licensing friction, but research alone does not prove its latency or 8 GB fit.

## Candidate 2: Direct Core ML

### Documented capabilities

- Apple distinguishes prompt latency/TTFT from extend throughput. Its optimized Core ML Llama 3.1 8B example reports 51.91 ms TTFT for a 7-token prompt, 33.67 token/s decode, and a 4.2 GB Int4 artifact on an M1 Max running macOS 15.2 beta [C1].
- The same article shows why optimization details matter: its static baseline reported 5,374.15 ms TTFT; explicit KV-cache I/O reported 933.89 ms; stateful KV cache reported 128.32 ms before Int4 reduced it to 51.91 ms [C1]. These are variants of one Core ML path, not a cross-runtime comparison.
- Stateful ML Program models are available from macOS 15. State is passed by reference and persists across predictions, which allows a KV cache to avoid explicit round-trip copies [C1][C2].
- The demonstrated path uses flexible prompt shapes, a static maximum KV-cache shape, fused scaled-dot-product attention, stateful cache updates, and block-wise Int4 weights [C1].
- Core ML Tools converts and optimizes source models, but Apple describes model-specific wrapping, tracing/export, state declaration, and numerical validation [C1][C2].

### Tab implications

- **Inference:** this is the strongest performance challenger because it is the only candidate with first-party TTFT evidence close to an interactive workload. The result cannot be generalized to a base M1, an 8 GB machine, a different model, or Tab's prompts.
- **Inference:** the Local Model Catalog would distribute compiled runtime-specific artifacts. Every model family, maximum context, quantization, tokenizer, and conversion-tool version becomes a release input requiring numerical, quality, latency, and OS validation.
- **Inference:** macOS 15 is the practical minimum for the strongest stateful path. Supporting older macOS versions would require a materially different and likely slower architecture or a different runtime.
- **Inference:** Core ML supplies prediction, not an LLM service. Tab must own tokenization, sampling, stop conditions, cache lifecycle, first-usable-text assembly, telemetry, and IPC.
- **Inference:** app updates should not carry multi-gigabyte models by default. Downloaded model data belongs in Application Support, verified against a trusted manifest, because signed app bundles must be treated as read-only [A1].

### Unknowns

- In-flight GPU prediction cancellation behavior, especially during prefill.
- Model load, compilation/specialization, first-run, and post-update cache behavior.
- Memory footprint beyond the model artifact on the validated target: KV state, prefill workspace, helper, Electron, macOS, and the active application.
- Conversion support and quality for the small Suggestion models selected later.
- Stability of downloaded compiled artifacts across supported macOS releases.

**Assessment:** required benchmark challenger if macOS 15 is an acceptable local-inference minimum. Its official latency result is promising, while its artifact pipeline and narrower catalog are the main costs.

## Candidate 3: MLX Swift With `mlx-swift-lm`

### Documented capabilities

- MLX Swift is Apple's Swift API for the MLX array framework on Apple Silicon. `mlx-swift-lm` supplies model loading and implementations for multiple LLM architectures [M1].
- The package currently targets macOS 14 and uses SwiftPM. MLX's command-line SwiftPM build cannot build Metal shaders, so the final build must run through Xcode or `xcodebuild` [M1][M5].
- Generation exposes a configurable prefill step, maximum generation tokens, rotating KV-cache limits, 4- or 8-bit KV quantization, token iteration, and prompt-prefill timing [M2].
- The preferred generation API returns `AsyncStream<Generation>`. Its source warns that terminating a stream early may leave computation running for a few milliseconds and recommends an observable generation task when completion matters [M2].
- MLX exposes active, cached, and peak memory, cache and overall limits, and immediate cache clearing. Its source warns that recycled inference buffers can otherwise grow to several gigabytes and recommends workload-specific measurement [M3].
- The current `mlx-swift-lm` 3.x documentation calls out breaking changes made to decouple tokenizer and downloader packages [M1].

### Tab implications

- **Inference:** Swift-native generation reduces glue compared with assembling the full Core ML generation loop, while still fitting an app-owned helper.
- **Inference:** explicit prefill timing and memory snapshots are valuable for the benchmark and eventual metadata-only diagnostics.
- **Inference:** local-only model loading should bypass arbitrary Hub resolution in production. The Local Model Catalog should pin model, tokenizer, runtime, and conversion revisions.
- **Inference:** lazy and asynchronous GPU execution means logical cancellation and actual compute drain must be measured separately. Helper termination remains the hard-stop fallback.
- **Inference:** release engineering is more involved than today's single-file `swiftc` helper because the build must compile and sign MLX libraries and Metal assets using Xcode tooling.

### Unknowns

- Warm first-usable-text latency relative to `llama.cpp` and Core ML on the same source model.
- Total and retained memory under constrained cache policies on the validated target.
- Model implementation coverage for the eventual Local Model Catalog shortlist.
- Cancellation drain time during prefill and rapid request replacement.
- The maintenance cost of pinning and upgrading MLX, MLX Swift, `mlx-swift-lm`, tokenizer integrations, and model implementations together.

**Assessment:** credible benchmark challenger. It offers the best native memory observability and a higher-level generation API, but its measured product advantage and maintenance envelope remain unknown.

## Eliminated From the Initial Benchmark

### ONNX Runtime GenAI

ONNX Runtime GenAI is packageable on macOS arm64 and provides C/C++ APIs, tokenization, sampling, and KV-cache management. It is not an initial candidate because its official Generate API remains preview, Objective-C is still under development, and its current acceleration matrix does not list Core ML [O1][O2]. Base ONNX Runtime has a Core ML execution provider, but that does not establish that the GenAI path offers a competitive Apple Silicon LLM architecture. Reconsider if the GenAI support matrix adds a documented Core ML path or publishes relevant Apple Silicon TTFT evidence.

### Ollama Or Another User Daemon

Do not make an externally managed daemon Tab's production default. It would weaken Tab's control over runtime and model versions, warm residency, Local Model Catalog policy, lifecycle, IPC exposure, diagnostics, and support. A daemon can remain a disposable development aid, but the benchmark should test architectures Tab can sign, ship, and own.

### Python MLX Or Transformers Helper

Shipping Python and its native dependency graph adds avoidable size, signing, startup, and maintenance costs when credible C/C++ and Swift paths exist. It remains useful for conversion and offline model evaluation, not for the production helper.

### Browser WebGPU/WASM And Server-Oriented Stacks

WebGPU/WASM adds a renderer/browser dependency and lacks primary evidence of an advantage over native Metal paths for this workload. vLLM and TensorRT-oriented stacks optimize server throughput and unsupported hardware rather than a directly distributed Apple Silicon desktop product. Neither belongs in the initial runtime bake-off.

## Common Architecture To Test

The benchmark should put every candidate behind one conceptual helper contract so runtime differences do not become three product integrations:

```text
Electron main process
  -> load(model path, digest, context and runtime options)
  -> complete(request ID, Typing Context, generation limit, deadline)
  -> cancel(request ID)
  -> unload(reason)
  -> status()

Signed arm64 inference helper
  -> one warm model
  -> initially one active generation
  -> bounded context and KV state
  -> token/text events plus phase timings
  -> memory-pressure unload and crash recovery
```

Required invariants:

- Request IDs and an Electron-side stale-result check remain authoritative even when runtime cancellation fails.
- New Typing Context cancels the previous request before new inference is scheduled.
- Cancellation has a grace deadline and a helper-restart fallback.
- Typing Context, Personal Memory content, and generated text never enter logs or persistent benchmark traces.
- The helper accepts only verified catalog artifacts and reports exact runtime/model revisions.
- Model and cache state never enter an Electron renderer.
- Memory pressure can unload the model, and helper failure cannot stop input monitoring, Acceptance, or settings UI.

This is a comparison architecture, not a settled production protocol. Process lifecycle and resource-pressure policy remain map fog until runtime evidence exists.

## What The Benchmark Must Measure

### Hardware and artifacts

- Run the current benchmark on the available M4 Pro Mac with 24 GB memory and treat that exact class as the only validated target.
- Do not generalize those results to base chips, 8 GB or 16 GB configurations, or other untested Macs. Broader hardware validation is a separate future effort.
- Use the same original model revision where technically possible, while recording runtime-specific conversion, quantization, tokenizer, prompt template, context, KV type, runtime revision, and macOS version.
- Treat quantized artifacts as distinct quality candidates; equal nominal bit width does not imply equal output quality.

### End-to-end latency

Measure from the Electron caller through overlay visibility:

1. request dispatch and helper receipt;
2. tokenization;
3. prefill start and completion;
4. first sampled token;
5. first non-empty displayable text;
6. Electron receipt and overlay visibility.

The primary metric is warm request-to-visible-usable-Suggestion latency at P50, P90, P95, and P99. Also measure model load, first inference after load, warm inference, reload after pressure eviction, and decode inter-token latency. Decode tokens per second is supporting evidence only.

### Workload and prefix reuse

- Use representative email, message, note, and document Typing Context at multiple lengths, including no-Suggestion cases and Unicode boundaries.
- Replay append-only typing, backspace, replacement near the end, replacement near the beginning, paste, app/window change, and secure/private context invalidation.
- Record reused prefix tokens, newly processed tokens, TTFT, cache resets, cache memory, and output divergence.

### Cancellation

- Cancel before receipt, during tokenization, early and late prefill, before first text, during decode, and during repeated edits 50-100 ms apart.
- Separate logical cancellation, where Tab discards stale output, from computational cancellation, where the old work stops consuming resources.
- Record cancel-to-idle time, stale output after cancel, time until a new request starts, retained memory, state validity, and hard-restart recovery.

### Memory, pressure, and longevity

- Record helper footprint, runtime active/cache/peak values where available, total Tab process-tree footprint, swap growth, pressure events, KV allocation, peak prefill workspace, post-cancel retention, post-unload retention, and reload latency on the validated target.
- Test with the complete Electron app and realistic foreground applications, not an isolated CLI with otherwise idle memory.
- Run a sustained typing trace to detect thermal, energy, and latency drift.

### Quality and distribution

- Compare Suggestion usefulness, empty/whitespace output, repetition, prompt leakage, unwanted chat framing, stop behavior, length compliance, and cross-runtime/quantization divergence on the same offline corpus.
- Produce and test a signed, hardened, notarized arm64 app for each candidate on a clean Mac without Xcode, Homebrew, or source-tree libraries.
- Test a quarantined downloaded artifact, offline inference, model loading from Application Support, recursive signature verification, Gatekeeper assessment, and update/model-data behavior [A1].

## Decision Gates

A runtime remains credible only if it can:

- run from Tab's signed and notarized app on a clean Mac;
- meet the predeclared warm visible-Suggestion latency threshold;
- survive cancellation storms without stale display or unbounded compute drain;
- unload and recover under memory pressure;
- avoid unacceptable swap and foreground-app interference on the validated target;
- expose enough phase and memory telemetry without logging content;
- support a legally approved, reproducible Local Model Catalog artifact.

Prefer a more specialized Apple-native runtime over `llama.cpp` only if measured latency or resource behavior is materially better enough to offset its narrower artifact pipeline and maintenance cost. The threshold for "materially better" must be set before observing results.

## Open Empirical Questions

1. What is warm request-to-visible-Suggestion P95 for each runtime on the available M4 Pro Mac with 24 GB memory?
2. Which runtime has the lowest prefill and first-usable-text latency at Tab's real prompt distribution?
3. How much does prefix reuse help, and how frequently do real edits invalidate it?
4. Can each runtime stop an in-flight Metal prefill promptly, or is helper restart required?
5. What memory remains after cancellation and unload, and how does that affect foreground applications on the validated target?
6. Which runtime/model/context configuration remains stable under sustained realistic memory pressure?
7. Do Core ML's published TTFT advantages reproduce with Tab's prompt construction and a small approved model?
8. Does MLX's higher-level generation and memory control produce a measurable product advantage?
9. What is the latency and complexity difference between `llama-server` and a minimal linked helper?
10. How do runtime-specific quantizations change Suggestion quality?
11. What cold and warm behavior follows pressure eviction, app restart, and OS/runtime update?
12. Which minimum macOS version is acceptable for the local-inference product tier?

## Primary Sources

All external sources were checked July 9, 2026.

- **[A1] Apple, macOS Code Signing In Depth:** nested code locations, inside-out signing, read-only signed bundles, quarantine and Gatekeeper validation. <https://developer.apple.com/library/archive/technotes/tn2206/_index.html>
- **[E1] Electron process model:** utility processes for CPU-intensive or crash-prone components. <https://www.electronjs.org/docs/latest/tutorial/process-model#the-utility-process>
- **[L1] `llama.cpp` repository:** Apple Silicon/Metal positioning, model support, GGUF requirement, quantization, benchmarks, XCFramework, and API-change notices. <https://github.com/ggml-org/llama.cpp>
- **[L2] `llama.cpp` C API:** mmap/mlock, context and KV controls, abort limitation, explicit model/context lifecycle. <https://github.com/ggml-org/llama.cpp/blob/master/include/llama.h>
- **[L3] `llama.cpp` build documentation:** static builds and default macOS Metal backend. <https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md>
- **[L4] `llama.cpp` license:** MIT. <https://github.com/ggml-org/llama.cpp/blob/master/LICENSE>
- **[L5] `llama-server` documentation:** streaming, Unix sockets, warmup, mmap/mlock, context/KV controls, prompt timings, and prefix caching. <https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md>
- **[C1] Apple Machine Learning Research, On Device Llama 3.1 with Core ML:** TTFT/extend definitions, stateful KV cache, flexible shapes, fused attention, Int4 conversion, artifact size, and M1 Max measurements. <https://machinelearning.apple.com/research/core-ml-on-device-llama>
- **[C2] Core ML Tools stateful-model guide:** macOS 15 deployment requirement, state lifecycle, and KV-cache pattern. <https://apple.github.io/coremltools/docs-guides/source/stateful-models.html>
- **[C3] Core ML Tools license:** BSD 3-Clause. <https://github.com/apple/coremltools/blob/main/LICENSE.txt>
- **[M1] MLX Swift and MLX Swift LM repositories:** Apple Silicon Swift integration, model library, Xcode Metal build requirement, and documented 3.x changes. <https://github.com/ml-explore/mlx-swift> and <https://github.com/ml-explore/mlx-swift-lm>
- **[M2] `mlx-swift-lm` generation source:** prefill timing, generation parameters, KV controls, streaming, and early-termination warning. <https://github.com/ml-explore/mlx-swift-lm/blob/main/Libraries/MLXLMCommon/Evaluate.swift>
- **[M3] MLX Swift memory source:** active/cache/peak measurements, memory limits, cache limits, cache clearing, and buffer-growth warning. <https://github.com/ml-explore/mlx-swift/blob/main/Source/MLX/Memory.swift>
- **[M4] MLX Swift LM license:** MIT. <https://github.com/ml-explore/mlx-swift-lm/blob/main/LICENSE>
- **[M5] MLX Swift LM package manifest:** macOS 14 minimum and package dependencies. <https://github.com/ml-explore/mlx-swift-lm/blob/main/Package.swift>
- **[O1] ONNX Runtime GenAI repository:** platform/API/acceleration support matrix. <https://github.com/microsoft/onnxruntime-genai>
- **[O2] ONNX Runtime Generate API documentation:** preview status and generation responsibilities. <https://onnxruntime.ai/docs/genai/>
