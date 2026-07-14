# Bonsai Model Selection for Local Suggestions

Research current to July 14, 2026. This report compares the official PrismML Bonsai language models for Tab's latency-sensitive automatic Suggestion workload on consumer Macs. It is a candidate-selection decision, not a production model approval: no Bonsai artifact has yet run Tab's fixed quality, latency, memory, cancellation, battery, or reliability gates.

## Recommendation

Benchmark **Ternary Bonsai 8B Q2_0 GGUF** first, using the exact artifact `Ternary-Bonsai-8B-Q2_0.gguf` (2,182,184,672 bytes).

It is the best first candidate for Tab because quality is the binding risk:

- Its official six-benchmark average is **75.5**, five points above the original **1-bit Bonsai 8B's 70.5** and 4.8 points above Ternary 4B's 70.7.
- Its **2.18 GB** download remains far below Tab's predeclared 6 GB installed-artifact screen and is much smaller than the 5.68 GB Qwen3.5 9B artifact that passed Tab's automated quality gate.
- It still delivers **455 prompt-processing tokens/s and 76 generation tokens/s** on PrismML's Apple M4 Pro 48 GB Metal benchmark. Generation is ample for a Suggestion capped at three words; prompt processing and complete visible latency remain the main risks to measure.
- Its **65,536-token context** is far beyond Tab's current 2,048-token local runtime configuration and bounded Suggestion inputs.

These are PrismML's general benchmark and throughput results, not Tab Suggestion measurements. Tab should not add the model to the supported Local Model Catalog until this exact model, runtime revision, prompt, generation configuration, and artifact pass the repository's existing benchmark protocol. The current strongest measured local configuration, Qwen3.5 9B Q4_K_M, reached 85.8% useful continuations only after tested 0.8B-, 3B-, and 4B-class candidates failed the same 70% quality gate. That Tab-specific evidence favors starting at Bonsai 8B rather than optimizing footprint first. See [`local-suggestion-stronger-candidate.md`](../prototypes/local-suggestion-stronger-candidate.md) and [`local-suggestion-quality-safe-results.md`](../prototypes/local-suggestion-quality-safe-results.md).

Keep **Ternary Bonsai 4B Q2_0** as a predeclared speed/low-memory challenger. It is the best published efficiency balance—**70.7** average, **1.07 GB**, and **826 prompt-processing / 120 generation tokens/s**—but Tab's own quality history makes it the second experiment, not the likely user-facing default. Do not substitute the original 1-bit 8B as the quality choice; Ternary 8B is PrismML's newer, explicitly quality-oriented 8B operating point.

## Decision matrix

All throughput values below are PrismML `llama-bench` results on an Apple M4 Pro with 48 GB memory using Metal. `PP512` is prompt processing over 512 input tokens; `TG128` is generation over 128 output tokens. Artifact sizes are the exact recommended low-bit GGUF file sizes from the official Hugging Face repositories or API. The benchmark averages are not autocomplete scores and are not directly comparable across the 27B and smaller-family suites.

| Candidate | Exact low-bit GGUF | Download | Context | PP512 | TG128 | Official average | Tab assessment |
|---|---|---:|---:|---:|---:|---:|---|
| 1-bit Bonsai 1.7B | `Bonsai-1.7B-Q1_0.gguf` | 248 MB | 32K | 2,305 tok/s | 250 tok/s | 49.60 | Fastest and smallest, but too much quality risk for a user-selectable default |
| Ternary Bonsai 1.7B | `Ternary-Bonsai-1.7B-Q2_0.gguf` | 463 MB | 32K | 2,088 tok/s | 229 tok/s | 58.47 | Better than binary 1.7B, still a constrained-device tier rather than the first Tab candidate |
| 1-bit Bonsai 4B | `Bonsai-4B-Q1_0.gguf` | 572 MB | 32K | 915 tok/s | 136 tok/s | 62.7 | Excellent footprint, but gives up eight benchmark points to Ternary 4B |
| Ternary Bonsai 4B | `Ternary-Bonsai-4B-Q2_0.gguf` | 1.075 GB | 32K | 826 tok/s | 120 tok/s | 70.7 | Speed/low-memory challenger; best published efficiency balance |
| Original 1-bit Bonsai 8B | `Bonsai-8B-Q1_0.gguf` | 1.159 GB | 65K | 498 tok/s | 85 tok/s | 70.5 | Dominated by Ternary 4B on the published size, speed, and average-score dimensions |
| **Ternary Bonsai 8B** | **`Ternary-Bonsai-8B-Q2_0.gguf`** | **2.182 GB** | **65K** | **455 tok/s** | **76 tok/s** | **75.5** | **First benchmark candidate; best fit given Tab's measured quality risk** |
| 1-bit Bonsai 27B | `Bonsai-27B-Q1_0.gguf` | 3.803 GB | 262K | 133 tok/s | 26 tok/s | 76.11 | Separate high-memory/agentic tier; too slow for the default automatic path |
| Ternary Bonsai 27B | `Ternary-Bonsai-27B-Q2_0.gguf` | 7.165 GB | 262K | 125 tok/s | 18 tok/s | 80.49 | Highest published quality, but wrong latency and resource tradeoff for short autocomplete |

Sources: official model cards for [1-bit 1.7B](https://huggingface.co/prism-ml/Bonsai-1.7B-gguf), [Ternary 1.7B](https://huggingface.co/prism-ml/Ternary-Bonsai-1.7B-gguf), [1-bit 4B](https://huggingface.co/prism-ml/Bonsai-4B-gguf), [Ternary 4B](https://huggingface.co/prism-ml/Ternary-Bonsai-4B-gguf), [original 1-bit 8B](https://huggingface.co/prism-ml/Bonsai-8B-gguf), [Ternary 8B](https://huggingface.co/prism-ml/Ternary-Bonsai-8B-gguf), [1-bit 27B](https://huggingface.co/prism-ml/Bonsai-27B-gguf), and [Ternary 27B](https://huggingface.co/prism-ml/Ternary-Bonsai-27B-gguf). Exact file sizes are exposed by the corresponding official Hugging Face model APIs with `?blobs=true`.

## Original 1-bit 8B versus newer Ternary 8B

The March announcement linked in the request describes the **original binary 1-bit Bonsai 8B**. PrismML released the **Ternary Bonsai family** on April 16 as a distinct quality-oriented tradeoff, explicitly saying that 1-bit remains appropriate when minimum footprint is paramount while Ternary spends modestly more memory for higher accuracy. At 8B, Ternary improves PrismML's reported average from **70.5 to 75.5** for roughly **1.02 GB** more parameter storage. It is slower on M4 Pro Metal, at **76 versus 85 generated tokens/s**. See PrismML's [Ternary Bonsai announcement](https://prismml.com/news/ternary-bonsai) and the official [1-bit](https://huggingface.co/prism-ml/Bonsai-8B-gguf) and [Ternary](https://huggingface.co/prism-ml/Ternary-Bonsai-8B-gguf) model cards.

For Tab, that means:

- Choose **Ternary 8B** for the first automatic-Suggestion experiment because Tab's smaller tested candidates failed usefulness.
- Choose **Ternary 4B** as the speed/low-memory challenger if the 8B misses latency or resource gates.
- Choose a **1-bit variant** only for a future footprint-first hardware tier after it independently passes Tab's quality gate.

## Why not 1.7B or 27B

The 1.7B models are compelling engineering demonstrations, but their official averages of **49.60 binary** and **58.47 Ternary** are well below the larger options. Tab's own evaluation already rejected tested 0.8B and 3B-class candidates on usefulness before a 9B candidate passed. That does not prove Bonsai 1.7B will fail, but it makes it a poor first use of validation time.

The 27B release targets multimodal reasoning, tool use, long contexts, and sustained agentic workflows. Those capabilities do not match a non-streaming Suggestion capped at three words. On M4 Pro Metal, 1-bit 27B reaches only **133 PP512 and 26 TG128 tokens/s**; Ternary 27B reaches **125 and 18**. The 1-bit model's 3.8 GB file also measures **5.2 GB peak memory at 4K context**, while Ternary measures **8.4 GB**, because weights are not the whole runtime footprint. See the official [Bonsai 27B announcement](https://prismml.com/news/bonsai-27b) and the [1-bit](https://huggingface.co/prism-ml/Bonsai-27B-gguf) and [Ternary](https://huggingface.co/prism-ml/Ternary-Bonsai-27B-gguf) cards.

The 27B models may later make sense for an explicit, slower local reasoning action on high-memory Macs. They should not be the second automatic Suggestion model.

## Runtime and catalog implications

This is not a model-only change. The Ternary 1.7B, 4B, and 8B cards state that their Q2_0 kernels are not yet in mainline `llama.cpp`; they require PrismML's [`prism` fork](https://github.com/PrismML-Eng/llama.cpp), which adds CPU and Metal support. The 1-bit cards also direct developers to the fork for Q1_0 kernels. Tab's benchmark currently pins upstream `llama.cpp` build 9910, so adopting Bonsai requires a deliberate runtime fork/revision decision and regression testing, not merely adding a download URL. PrismML's [official demo repository](https://github.com/PrismML-Eng/Bonsai-demo) documents macOS, Windows, Linux, iOS, CPU, Metal, CUDA, Vulkan, and ROCm packaging paths. The model cards list Apache 2.0 for all compared weights; the PrismML `llama.cpp` fork retains the runtime's MIT license.

Catalog entries should pin, at minimum:

- the exact Hugging Face repository revision and low-bit filename;
- exact byte size, SHA-256 digest, and Apache 2.0 attribution;
- the compatible PrismML runtime revision and backend;
- supported Mac hardware/memory tiers and measured warm footprint;
- prompt, chat-template, thinking-mode, sampling, context, and maximum-output settings.

Do not rely on Hugging Face's generated `:F16` examples or automatic variant selection. In particular, the generated 27B examples currently select the roughly 54 GB F16 artifact rather than the intended low-bit file. A user-facing downloader must request the exact `Q1_0` or `Q2_0` filename and verify it before activation.

## Required next validation

Run Ternary Bonsai 8B through the unchanged Tab protocol before implementation work broadens the catalog:

1. Pin a PrismML `llama.cpp` fork commit and the exact 2,182,184,672-byte Q2_0 artifact; record its SHA-256.
2. Disable thinking, preserve Tab's deterministic sensitive-context suppression and output-contract withholding, and tune only within a predeclared generation configuration.
3. Run the 300-case fixed corpus and require at least 70% useful continuations, at least 98% emitted contract compliance, at most 1% harmful outputs, and 100% sensitive withholding.
4. Only after quality passes, run complete visible-latency, startup, cancellation, warm-memory, disk, battery, pressure, and soak gates on the supported Mac tiers.
5. If 8B passes quality but misses latency or resource gates, repeat with the exact Ternary 4B Q2_0 artifact. Do not infer either result from PrismML's general benchmark average.

## Decision

**Ternary Bonsai 8B is the best Bonsai model to evaluate for Tab's second downloadable automatic-Suggestion option.** It is not yet approved for users. Ternary Bonsai 4B is the predeclared speed/low-memory challenger; the original 1-bit 8B is a footprint-oriented older operating point, and the 27B family belongs to a different, slower workload tier.
