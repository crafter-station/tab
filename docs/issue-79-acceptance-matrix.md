# Issue 79 Acceptance Matrix

This record distinguishes deterministic contract evidence from observed macOS application evidence. Availability alone is not a successful manual validation. For every inaccessible or uncertain surface, the required safety result is no Rewrite request and no replacement.

## Acceptance

| Criterion | Implementation or validation boundary | Happy-path evidence | Adversarial or unsupported case | Focused check | Non-goal or decision |
| --- | --- | --- | --- | --- | --- |
| Selected text and range agree without clipboard reads | Public Swift helper executable and Accessibility snapshot builder | A non-empty selection emits its exact UTF-16 range and text | Missing, malformed, or inconsistent Accessibility selection remains explicit | Native selection contract and `tests/native-macos-text-session.test.mjs` | The helper never reads the clipboard to discover a selection |
| Uncertain selection is not a caret | Swift fallback snapshot and explicit-action gate | A genuine zero-length range remains an explicit caret | Inaccessible range remains `null`; unreliable or inconsistent snapshots publish no explicit action | Native selection and explicit-action contracts | Do not infer a zero-length range from absent data |
| Representative application compatibility | Actual installed application text surfaces through macOS Accessibility and Tab's public desktop seams | Reliable targets trigger Rewrite and replace exactly once | Unsupported or uncertain targets send no request and perform no replacement | Per-application observations below | Installed does not mean validated |
| Both Acceptance paths | Global Option+Tab and clickable Floating Suggestion Overlay | Each path accepts the same visible Rewrite on a reliable target | Missing/stale target makes either path a no-op before clipboard mutation | Real-app observations plus desktop Acceptance suite | No app-specific click or keyboard adapter |
| Exact replacement and clipboard restoration | Exact-target refresh followed by clipboard paste | Selected passage is replaced once and prior clipboard is restored best-effort | Changed target fails before clipboard mutation; restoration failure does not duplicate insertion | `tests/desktop-acceptance.test.ts` and real-app observations | Clipboard paste remains the sole first-version insertion path |
| Multiline through 2,000 characters | Rewrite request schema, native range capture, and real text surface | Exact 2,000-character multiline selection is not truncated | 2,001 characters sends no request and performs no replacement | Rewrite API/client suites and real-app observations | Oversized input is rejected, never truncated |
| Rich text remains plain text | Accessibility selected text and clipboard paste | Text content is replaced with the generated plain text | Formatting is not reconstructed | Rich-text TextEdit, Notes, or Mail observation | First version is plain text |
| Stale context invalidation | Text Session fingerprint and exact Acceptance refresh | Stable app/window/field/range/text/context permits replacement | App, window, field, selection, surrounding edit, or typing change blocks replacement | Native-loop and desktop Acceptance invalidation matrices | No semantic selected-text replacement |
| Sensitive and unsupported safety | Local explicit-action classifier, redaction, and reliable-target requirement | Ordinary reliable prose may request Rewrite | Secure field, secret-like text, oversized selection, or unsupported AX surface sends no request and performs no replacement | Native-loop, API-client, and real-app observations | No request is the authoritative uncertain-surface result |
| Lifecycle invalidation | Pause, explicit clear, sleep/lock clear path | Current context can produce a visible Rewrite | Pause, sleep/lock, or clear invalidates pending and visible Rewrite | Native-loop invalidation matrix | Late network cancellation is best effort; response-version rejection is authoritative |
| Compatibility scope | Native helper, native loop, and Acceptance boundaries | Evidence-backed generic fixes apply across reliable targets | Unreproduced app differences are recorded, not patched speculatively | Diff review and focused suites | No clipboard reads during generation, simulated typing, formatting reconstruction, semantic replacement, or app-specific insertion adapters |
| Required verification | Focused Rewrite suites, Swift compiler/helper executable, and repository CI sequence | All required commands pass | Any unavailable external app or credential is recorded explicitly | Checks section below | No manual claim without observed evidence |

## Application Matrix

`Pending` means the application was found but no reliable end-to-end observation has been made in this worktree. In that state, the safety expectation remains no request/no replacement whenever target identity is uncertain.

| Application | Version or availability | Reliable or unsupported | Trigger behavior | Keyboard result | Click result | Exact replacement | Multiline | Clipboard | Stale/safety cases | Known limitation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TextEdit | 1.20, installed | Reliable native selection target | Production helper emitted exact selected text and range | Not observed end to end | Not observed end to end | Not observed end to end | Exact 2,000-character selection emitted without truncation | Not observed end to end | First probe switched to another app and safely emitted an unreliable null-range snapshot; stable retry was reliable | Rich-text document selection was exercised, but generated plain-text replacement was not |
| Notes | 4.13, installed | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | No result inferred from availability |
| Mail | 16.0, installed | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | No result inferred from availability |
| Slack | 4.48.100, installed | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Account/workspace state may limit automation |
| Discord | 0.0.399, installed | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Account/server state may limit automation |
| Messages | 26.0, installed | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Sending a message is outside validation |
| VS Code | Not installed | Unavailable | Not observed | Not observed | Not observed | Not observed | Not observed | Not observed | Required safety cannot be observed without the app | Zed 1.11.3 is installed but is not a substitute for this required surface |
| Obsidian | 1.12.7, installed | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Vault/workspace state may limit automation |
| Google Chrome editor | Chrome 150.0.7871.115 installed; Chrome for Testing exercised | Unsupported in exercised Chrome for Testing contenteditable; installed Chrome not observed | Production helper emitted unreliable state with `selectedRange: null` | No request/no replacement by explicit-action contract | No request/no replacement by explicit-action contract | No replacement | Not observed | No clipboard mutation | Uncertain AX surface failed closed | `agent-browser` drove the contenteditable surface; connection to separately launched installed Chrome on port 9333 was unavailable |

## Commit Milestones

1. Establish the acceptance and application evidence boundaries before compatibility changes.
2. Add executable public-native-helper selection proof with its focused tests, keeping uncertain state explicit.
3. Record observed real-application results and required command evidence without promoting unobserved surfaces to passes.

## Checks

Checks and observed evidence are added as they run.

- `node --test tests/native-macos-text-session.test.mjs`: 11 passed.
- `swiftc -typecheck apps/desktop/native/macos-input-tap.swift`: passed.
- Direct compiled helper: reliable selection and explicit-action scenarios emitted the expected snapshot/action; unavailable and inconsistent scenarios emitted no action.
- `bun test tests/desktop-native-loop.test.ts tests/desktop-acceptance.test.ts tests/desktop-api-client.test.ts tests/api-suggestion.test.ts`: 221 passed.
- `bun run typecheck`: passed.
- `bun run worker:types:check`: passed.
- `bun run lint`: passed.
- `bun run test`: 28 Node tests and 670 Bun tests passed. Expected error-path stack traces were printed by passing tests.

## External Evidence Gaps

No authenticated generated Rewrite was available during this automated pass. Therefore Option+Tab, overlay click, exact replacement, clipboard restoration, rich-text replacement, and stale-generation behavior are not claimed as real-app passes for TextEdit, Notes, Mail, Slack, Discord, Messages, Obsidian, or Chrome. VS Code was not installed. The driver or a macOS validation owner with authenticated Tab generation must collect these required end-to-end observations; until then, uncertain surfaces retain the required no-request/no-replacement safety result.
