# Ghostty Coding-Agent Suggestion Prompt Improvement

Evidence current to July 14, 2026. This evaluation asked whether Ternary Bonsai 8B needs a different inline-autocomplete prompt when the user is writing natural-language instructions to Claude Code, Codex, or OpenCode in Ghostty.

## Decision

Use a coding-agent prompt and examples when Ghostty context identifies Codex or OpenCode. Keep the existing production prompt for Claude Code, ordinary shells, and every other writing surface.

The specialized prompt tells the model to continue the user's instruction rather than answer it, emit terminal output, or claim that work is complete. It also labels the writing surface and keeps terminal/session context background-only. Claude Code remains on the general prompt because the specialized variant held acceptance at 5/6 but reduced its average evaluator score from 3.50 to 3.17.

## Method

- Exact model: `Ternary-Bonsai-8B-Q2_0.gguf`.
- Exact pinned Prism runtime shipped by the desktop app.
- Production generation settings: 16 maximum tokens, temperature 0.3, thinking disabled, and production normalization/three-word contract enforcement.
- Synthetic corpus: 62 cases spanning email, Claude Code, Codex, OpenCode, team chat, personal messages, documents, notes, support/sales, and multilingual writing.
- Final decision slice: all 18 Ghostty coding-agent cases, six per agent workflow, repeated with three matched deterministic generation seeds for 54 comparisons.
- Evaluator: `meta/muse-spark-1.1` through Vercel AI Gateway, with blinded and order-swapped candidates and temperature zero.
- A candidate counted as accepted only when it passed the deterministic production contract and the evaluator rated it useful, non-harmful, and at least 3/4.
- Prompts and generated Suggestions remained ephemeral. This document retains aggregate results only.

## Results

An exploratory full-corpus rewrite improved coding-agent cases but regressed documents, notes, and team chat. That ruled out replacing the general writing prompt. A single production-policy run then varied materially from the prior run, so it was not used as decision evidence. The final exact-production comparison used three matched generation seeds per case and a deterministic, order-swapped evaluator:

| Surface | Legacy prompt | Selected prompt |
| --- | ---: | ---: |
| Claude Code | 15/18 | 15/18 (general prompt retained) |
| Codex | 10/18 | 14/18 |
| OpenCode | 5/18 | 10/18 |
| **Overall** | **30/54 (55.6%)** | **39/54 (72.2%)** |

Average evaluator scores remained 3.50 for Claude Code, improved from 2.56 to 3.22 for Codex, and improved from 1.94 to 2.44 for OpenCode. Pairwise wins favored the selected policy 16 to 6.

## Scope and limitations

This is a synthetic prompt comparison on one model and machine. The six-scenario slices and three deterministic samples per scenario are directional, not population estimates, and the same evaluator model handled every judgment. The result is strong enough for the narrow Codex/OpenCode branch because matched samples improved both agent slices and the general prompt remains untouched elsewhere. Future model or prompt changes should rerun `bun run eval:suggestions:improve -- --terminal-only --trials 3` and the full 62-case suite.
