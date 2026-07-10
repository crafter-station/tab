# Local Suggestion Automated Quality Ceiling

Evidence current to July 10, 2026 for [Measure the attainable automated quality ceiling of the fixed Suggestion corpus](https://github.com/crafter-station/tab/issues/71).

This is content-free automated attainability evidence. It is not human acceptance calibration, a local candidate result, or a production provider decision.

## Method

- The unchanged 300-case corpus retained fingerprint `64cde22ed1a077f0f30f0372847cf0d2f913c5362e346c3461aab70d33be0332`; all 240 eligible cases were scored.
- The current remote path and two materially stronger references used the exact production Suggestion prompt and normalization contract.
- The references were the current Vercel AI Gateway catalog models `anthropic/claude-sonnet-5` and `openai/gpt-5.6-sol`. They were reference controls only, not local candidates or production recommendations.
- The corrected Groq `openai/gpt-oss-20b` acceptance evaluator judged each candidate independently, without source identity or a paired alternative, at high reasoning effort.
- Typing Context, Personal Memory content, and generated Suggestions remained ephemeral. The artifact retains only aggregate counts, rates, rejection categories, artifact identities, and the corpus fingerprint.

## Results

Both stronger references exceeded the unchanged 70% usefulness gate:

| Candidate | Useful | Emitted contract | Harmful | Result |
|---|---:|---:|---:|---|
| Current remote path, Groq `openai/gpt-oss-20b` | 3/240 (1.3%) | 3/3 (100%) | 0/240 | Below gate |
| Vercel AI Gateway `anthropic/claude-sonnet-5` | 230/240 (95.8%) | 240/240 (100%) | 0/240 | Pass |
| Vercel AI Gateway `openai/gpt-5.6-sol` | 230/240 (95.8%) | 240/240 (100%) | 0/240 | Pass |
| Prior strongest local, MLX Swift Qwen2.5 3B 4-bit | 69/240 (28.8%) | 100% | 0/240 | Below gate |

Aggregate acceptance-agent reasons were:

| Candidate | Accepted | Withheld | Unnatural | Irrelevant | Contradictory | Malformed | Unsafe |
|---|---:|---:|---:|---:|---:|---:|---:|
| Current remote path | 3 | 0 | 183 | 24 | 0 | 30 | 0 |
| `anthropic/claude-sonnet-5` | 230 | 0 | 10 | 0 | 0 | 0 | 0 |
| `openai/gpt-5.6-sol` | 230 | 0 | 5 | 1 | 0 | 4 | 0 |
| Prior strongest local | 69 | 0 | 92 | 62 | 1 | 16 | 0 |

The current remote configuration emitted only three normalized Suggestions in this run. That result remains a property of the current model and generation configuration, not evidence against corpus attainability, because both independent stronger references emitted contract-valid Suggestions for every eligible case and exceeded the gate by 25.8 percentage points.

## Decision

- The fixed corpus and corrected automated evaluator have a demonstrated attainable quality ceiling above the predeclared 70% gate.
- Preserve the 70% gate and the independent-candidate, explicit-acceptance evaluator protocol.
- Do not advance any current local candidate. The strongest measured local result remains 28.8% useful.
- Search for a materially stronger local candidate before resource or reliability validation. The remote references do not broaden the local model search by themselves and are not production provider decisions.
- Human acceptance calibration remains unresolved; this automated ceiling result does not substitute for it.

## Limitations

- No human judged generated Suggestions.
- The acceptance evaluator is a single model/provider protocol, so the result demonstrates automated attainability rather than cross-evaluator consensus.
- Reference generation used 256 completion tokens while the current remote path retained its existing 128-token setting. All outputs still passed through the same 80-character normalization contract.
