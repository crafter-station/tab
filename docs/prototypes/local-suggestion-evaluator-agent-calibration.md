# Local Suggestion Evaluator Agent Calibration

Evidence current to July 10, 2026 for [Calibrate the local Suggestion quality evaluator](https://github.com/crafter-station/tab/issues/70).

This is content-free, automated robustness evidence from the fixed synthetic corpus. At the human's direction, the prototype replaced the unavailable live blind review with a full-corpus acceptance agent. No generated Suggestion received a human usefulness or harmfulness judgment, so this result does not establish agreement with human acceptance behavior.

## Method

- The unchanged 300-case corpus retained fingerprint `64cde22ed1a077f0f30f0372847cf0d2f913c5362e346c3461aab70d33be0332`.
- All 300 cases ran through the complete MLX Swift Qwen2.5 3B 4-bit configuration, including deterministic secret-like Typing Context suppression and contract enforcement.
- The strongest local and current Groq `openai/gpt-oss-20b` outputs for all 240 eligible cases were evaluated in memory.
- The original low-reasoning evaluator judged paired candidates in both orders.
- A high-reasoning acceptance agent judged each candidate independently, without source identity or its paired alternative, using an explicit "likely to accept verbatim" rubric.
- Typing Context, Personal Memory content, and generated Suggestions remained ephemeral. The artifact retains only aggregate counts, rates, rejection categories, artifact identities, and the corpus fingerprint.

## Results

Both automated protocols keep every candidate conclusively below the 70% usefulness gate:

| Candidate | Independent acceptance agent | Original order-swapped judge | Order instability |
|---|---:|---:|---:|
| MLX Swift Qwen2.5 3B 4-bit | 69/240 (28.8%) | 75-119/240 (31.3%-49.6%) | 44/240 (18.3%) |
| Current remote path | 4/240 (1.7%) | 4/240 (1.7%) | 0/240 (0%) |

On the 196 stable local judgments, the protocols agreed on usefulness 173 times (88.3%). All 23 stable disagreements had the original evaluator mark a Suggestion useful while the acceptance agent rejected it; none went in the opposite direction. The independent protocol is therefore stricter, not a source of evidence that the original evaluator falsely rejected a passing local candidate.

Both protocols marked zero local and zero remote outputs harmful. Harmfulness agreement was 100% with no order instability.

The acceptance agent's aggregate rejection categories were:

| Candidate | Accepted | Withheld | Unnatural | Irrelevant | Contradictory | Malformed | Unsafe |
|---|---:|---:|---:|---:|---:|---:|---:|
| MLX Swift Qwen2.5 3B 4-bit | 69 | 0 | 92 | 62 | 1 | 16 | 0 |
| Current remote path | 4 | 8 | 188 | 32 | 0 | 8 | 0 |

Across both candidates, the acceptance agent marked 30.8% useful when Personal Memory was absent and 10% useful when it was present. This is a diagnostic slice, not a causal claim, because candidate source and other case attributes are aggregated together.

## Decision

- Preserve the predeclared 70% gate. Automated evidence does not support reopening it.
- Do not advance the current local candidate to resource or reliability testing.
- Correct the automated judge protocol before reuse: score candidates independently with the explicit acceptance rubric instead of relying on paired low-reasoning judgments whose local result changed with candidate order.
- Do not treat the independent acceptance agent as human calibration. The corpus and rubric remain unvalidated against actual human acceptance behavior.
- Before expanding the local model search, measure whether a materially stronger remote reference can reach the automated gate on this corpus. If it cannot, the corpus/rubric lacks a demonstrated attainable quality ceiling and needs correction or deferred human calibration.

The automated protocols used the same model and provider with different reasoning and presentation. Their agreement measures protocol robustness, not cross-model consensus.
