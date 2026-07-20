# Issue 79 Acceptance Matrix

This record distinguishes deterministic contract evidence from observed macOS application evidence. Availability alone is not a successful manual validation. For every inaccessible or uncertain surface, the required safety result is no Rewrite request and no replacement. Locked decision `79-unattended-manual-validation-disposition` directs unattended completion without further physical input: all safe automation is required, while unautomatable application rows remain explicit maintainer-accepted residual validation gaps rather than blockers or fabricated passes.

## Acceptance

| Criterion | Implementation or validation boundary | Happy-path evidence | Adversarial or unsupported case | Focused check | Non-goal or decision |
| --- | --- | --- | --- | --- | --- |
| Selected text and range agree without clipboard reads | Public Swift helper executable and Accessibility snapshot builder | A non-empty selection emits its exact UTF-16 range and text | Missing, malformed, or inconsistent Accessibility selection remains explicit | Native selection contract and `tests/native-macos-text-session.test.mjs` | The helper never reads the clipboard to discover a selection |
| Uncertain selection is not a caret | Swift fallback snapshot and explicit-action gate | A genuine zero-length range remains an explicit caret | Inaccessible range remains `null`; unreliable or inconsistent snapshots publish no explicit action | Native selection and explicit-action contracts | Do not infer a zero-length range from absent data |
| Representative application compatibility | Actual installed application text surfaces through macOS Accessibility and Tab's public desktop seams | Reliable targets trigger Rewrite and replace exactly once | Unsupported or uncertain targets send no request and perform no replacement | Per-application observations below | Installed does not mean validated |
| Both Acceptance paths | Suppressing native Option+Tab event-tap ingress, Electron shortcut fallback, and clickable Floating Suggestion Overlay | The executable helper proves Option+Tab is consumed by the production `.defaultTap` while ordinary Tab passes through; native ingress and keyboard/click triggers converge on the same public Acceptance function | Duplicate callbacks are rejected in flight; missing/stale targets remain pre-clipboard no-ops | Native executable contract, desktop ingress test, and desktop Acceptance suite | No app-specific click or keyboard adapter; post-fix physical observation is deferred |
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
| TextEdit | 1.20, installed | Reliable native selection target | On isolated candidate `82ea299`, the maintainer selected harmless text and physically double-tapped Option; a Rewrite appeared successfully | Physical Option+Tab on `0bef23b` produced no callback or replacement, reproducing the defect. `95b9948` routes physical Option+Tab through native ingress; post-fix physical result is deferred | Public click trigger is automated; physical overlay click is deferred | Exact one-time replacement is automated through the shared path; physical result is deferred | Exact 2,000-character selection emitted without truncation; recovered two-line fixture emitted exact range `0:48`; generated multiline replacement is deferred | Write, paste, wait, and best-effort restoration stages are automated; physical sentinel restoration is deferred | App/window/field/range/text/surrounding/secure/secret/pause/lock/clear cases are automated | Trigger and selection routing are observed. Post-fix keyboard/click, generated multiline/plain-text, and clipboard observations are maintainer-accepted residual gaps |
| Notes | 4.13, installed | Deferred manual-only | Deferred | Deferred | Deferred | Deferred | Deferred | Deferred | Deterministic stale/safety contracts pass | Maintainer-accepted residual; no result inferred from availability |
| Mail | 16.0, installed | Deferred manual-only | Deferred | Deferred | Deferred | Deferred | Deferred | Deferred | Deterministic stale/safety contracts pass | Maintainer-accepted residual; no draft was sent |
| Slack | 4.48.100, installed | Deferred manual-only | Deferred | Deferred | Deferred | Deferred | Deferred | Deferred | Deterministic stale/safety contracts pass | Maintainer-accepted residual; no post was sent |
| Discord | 0.0.399, installed | Deferred manual-only | Deferred | Deferred | Deferred | Deferred | Deferred | Deferred | Deterministic stale/safety contracts pass | Maintainer-accepted residual; no post was sent |
| Messages | 26.0, installed | Deferred manual-only | Deferred | Deferred | Deferred | Deferred | Deferred | Deferred | Deterministic stale/safety contracts pass | Maintainer-accepted residual; no message was sent |
| VS Code | Portable stable arm64 build downloaded to a temporary directory | Deferred manual-only | Deferred | Deferred | Deferred | Deferred | Deferred | Deferred | Deterministic stale/safety contracts pass | Maintainer-accepted residual; isolated launch only |
| Obsidian | 1.12.7, installed | Deferred manual-only | Deferred | Deferred | Deferred | Deferred | Deferred | Deferred | Deterministic stale/safety contracts pass | Maintainer-accepted residual; no vault content inspected |
| Google Chrome editor | Chrome 150.0.7871.115 installed; Chrome for Testing exercised | Unsupported in exercised Chrome for Testing contenteditable; installed Chrome not observed | Production helper emitted unreliable state with `selectedRange: null` | No request/no replacement by explicit-action contract | No request/no replacement by explicit-action contract | No replacement | Not observed | No clipboard mutation | Uncertain AX surface failed closed | `agent-browser` drove the contenteditable surface; connection to separately launched installed Chrome on port 9333 was unavailable |

## Commit Milestones

1. Establish the acceptance and application evidence boundaries before compatibility changes.
2. Add executable public-native-helper selection proof with its focused tests, keeping uncertain state explicit.
3. Record observed real-application results and required command evidence without promoting unobserved surfaces to passes.
4. Record the recovered unlocked-session application matrix, including both Acceptance paths for reliable targets and fail-closed evidence for unsupported targets.
5. Diagnose the production event path with bounded metadata-only stages after physical evidence disproved the timing-only correction.
6. Distinguish explicit classification, cloud request start/outcome, and overlay presentation/suppression at the public native-app and Deep Complete boundaries.
7. Relaunch a provenance-confirmed current-worktree candidate and complete the reliable-surface keyboard/click, exact replacement, multiline/plain-text, clipboard, stale, safety, and lifecycle observations.
8. Complete implementer self-review, the required CI sequence, and the final evidence handoff.
9. Route physical Option+Tab through the native helper after the isolated candidate proved Electron's global shortcut callback did not fire; retain Electron registration as fallback and add metadata-only Acceptance-stage diagnostics.

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
- Historical checkpoint: Swift typecheck and 12 native tests passed for the temporary system-interval implementation; final behavior restores ADR-0003's fixed 400 ms contract below.
- Focused explicit/Option/selection desktop routing tests: 13 passed.
- `swiftc -typecheck apps/desktop/native/macos-input-tap.swift`: passed with bounded production-path diagnostics.
- `node --test tests/native-macos-text-session.test.mjs`: 13 passed, including the metadata-only diagnostic contract.
- `bun test tests/desktop-event-ingress.test.ts tests/desktop-macos-input-tap.test.ts`: 6 passed.
- `bun run typecheck`: passed after adding the diagnostic ingress boundary.
- `bun test tests/desktop-native-loop.test.ts tests/desktop-acceptance.test.ts tests/desktop-api-client.test.ts tests/api-suggestion.test.ts`: 221 passed after the diagnostic change.
- `bun test tests/desktop-suggestion-modules.test.ts tests/desktop-native-loop.test.ts`: 159 passed with fixed-enum downstream Rewrite diagnostics.
- `bun run typecheck`: passed after the downstream Rewrite diagnostic milestone.
- `bun test tests/desktop-event-ingress.test.ts tests/desktop-native-loop.test.ts tests/desktop-acceptance.test.ts`: 177 passed after native Option+Tab routing and Acceptance diagnostics.
- `node --test tests/native-macos-text-session.test.mjs`: 13 passed after native Option+Tab routing.
- `swiftc -typecheck apps/desktop/native/macos-input-tap.swift`: passed after native Option+Tab routing.
- Focused native ingress and Rewrite Acceptance diagnostic tests: passed.
- `bun run typecheck`: passed after native Option+Tab routing.
- Final `bun run typecheck`: passed.
- Final `bun run worker:types:check`: passed; generated Worker types are current.
- Final `bun run lint`: passed.
- Final `bun run test`: 30 Node tests and 673 Bun tests passed; printed stacks are expected exercised error paths.
- Final remediation `swiftc -typecheck apps/desktop/native/macos-input-tap.swift`: passed.
- Final remediation `node --test tests/native-macos-text-session.test.mjs`: 13 passed, proving the fixed 400 ms boundary, metadata-only Option+Tab events, suppressing production tap capability, Acceptance emission, and ordinary Tab passthrough through the executable helper.
- Final remediation focused desktop ingress/Acceptance suites: 177 passed.

## Option+Tab Defect And Fix

- Reproduced on the provenance-confirmed isolated candidate at `0bef23b`: Rewrite generation and presentation completed, but physical Option+Tab produced only Option transition evidence, no Electron shortcut callback, no Acceptance entry, and no replacement.
- Root cause: the native event tap received Option and Tab but reserved Option+Tab by returning the event unchanged; the actual Acceptance path depended solely on Electron's `Alt+Tab` global shortcut, whose callback did not run in the reproduced environment.
- Fixes `95b9948` and `3bfa078`: the production helper detects Option+Tab, emits fixed-enum observation/emission diagnostics, sends `accept-suggestion` through validated desktop ingress, and consumes the key event from a suppressing `.defaultTap`. Ordinary Tab passes through unchanged. The Electron global shortcut remains a fallback.
- Both native and Electron callbacks use the same keyboard Acceptance trigger. The existing synchronous `acceptanceInFlight` guard prevents duplicate insertion if two callbacks overlap, and a later callback finds no visible Suggestion after successful Acceptance.
- Metadata-only diagnostics now cover callback source, Acceptance entry/provenance, replacing/in-flight guards, exact Rewrite target revalidation, clipboard write, paste dispatch, paste wait, clipboard restoration, final insertion result, and errors. They contain no selected text, replacement text, clipboard contents, credentials, identifiers, hashes, or payloads.

## Recovery Probes

- `security find-generic-password -s tab -a device-token` initially reported no candidate desktop credential. The unrelated legacy `tabb` service was not read.
- `/Applications/Tab.app` 0.1.10 opened its settings renderer at `#sign-in`; `agent-browser` observed `Continue in browser` and the explicit "Connect this Mac" state.
- Continuing in the browser reused the existing web session, returned to the loopback callback, and created the candidate `tab` / `device-token` Keychain entry. No credential value was printed or persisted.
- The installed app was dated before this issue branch and therefore was not used to claim a Rewrite journey pass. The current worktree desktop still needs to be launched against the configured API.
- A current arm64 VS Code stable archive was downloaded and unpacked under `/tmp`, then launched with isolated temporary user-data and extensions directories. `agent-browser` connected on its temporary CDP port and observed the editor surface.
- Local development variable names include the API base URL and configured provider credentials. Values were neither printed nor copied into the repository.

## Candidate Launch Probe

- The older `/Applications/Tab.app` process was quit before candidate startup so its helper and renderer could not be mistaken for branch evidence.
- The candidate was launched from this worktree with `bun --env-file=/Users/cuevaio/projects/tabbb/.dev.vars apps/desktop/scripts/dev.ts`; no variable values were printed.
- Process inspection resolved Electron, its renderers, the native helper, and the local inference runtime to this issue-79 worktree. The candidate log reported `macOS input tap ready.`
- The `tab` / `device-token` Keychain item remained present. Opening the candidate's own status menu through macOS Accessibility directly exposed `Tab: Signed in`, a disabled status label, and an enabled `Sign Out` item. No credential value was read.
- A subsequent TextEdit attempt found the macOS session at the lock/login boundary: the production helper reported `com.apple.loginwindow`, an unreliable Accessibility target, and `selectedRange: null` even after AppleScript created and attempted to focus a TextEdit document. TextEdit exposed no accessible window and remained non-frontmost.
- Synthetic Option+Tab against that loginwindow state produced no candidate request log, no overlay window, and no replacement. A boolean clipboard check confirmed the sentinel remained unchanged. This is lock-state fail-closed evidence, not a TextEdit journey pass.

## Unlocked-Session Recovery Probe

- The current-worktree candidate was relaunched after the console session was unlocked; Electron and the production helper paths resolved under this issue-79 worktree.
- The production helper directly emitted an exact reliable TextEdit selection for a harmless two-line fixture: range `0:48`, matching selected text, stable field/window identity, and `secureLike: false`.
- AppleScript and injected CoreGraphics modifier events did not produce a trustworthy double-Option Rewrite observation. A separate public-helper capture contained interleaved active input across Chrome and TextEdit, so further focus and keyboard automation stopped rather than interfere with an active graphical user session.
- No Acceptance occurred in that attempt. A boolean clipboard check showed the harmless sentinel remained unchanged; this is not clipboard-restoration evidence.

## External Evidence Gaps

The unlocked session permits reliable TextEdit focus and selection. Earlier failed physical attempts were contaminated by an obsolete main-checkout binary and do not describe the isolated candidate. In issue comment `5018637740`, the maintainer confirmed that only isolated candidate `82ea299` was running, selected harmless TextEdit text, physically double-tapped Option, and observed a Rewrite appear successfully. This resolves the physical-trigger and selected-text routing uncertainty for that candidate. It does not establish Option+Tab Acceptance, overlay-click Acceptance, exact one-time replacement, clipboard restoration, multiline generated replacement, rich-text-to-plain-text behavior, stale or safety behavior, lifecycle invalidation, or any other named application. Those observations remain unclaimed. The earlier loginwindow and Chrome for Testing observations retain their required no-request/no-replacement results.

## Diagnostic Candidate

- Commit `9bfc700` adds fixed-enum metadata stages at the native Option transition, recognizer, explicit refresh, helper emission, and validated desktop ingress boundaries.
- The candidate was rebuilt and launched through the approved external environment-file mechanism. Its helper executable and working directory both resolved to this issue-79 worktree, and a sanitized bounded log reported `macOS input tap ready.`
- A separately path-verified stale helper under `/Users/cuevaio/projects/tabbb` was terminated so the observation was not ambiguous.
- The diagnostic candidate observed complete left-Option sequences through `explicit-refresh: ready` and `suggest-now-emitted`, then exited with its helper receiving `SIGTERM`. It is not currently running and must be relaunched after adding bounded downstream request/presentation stages.

## Downstream Diagnostic Milestone

- The public Native Autocomplete App boundary now reports explicit-action classification as one of `deep-complete`, `rewrite`, `oversized`, or `none`.
- The public Deep Complete boundary reports cloud request start, request outcome as `suggestion`, `empty`, or `failed`, and overlay disposition as `presented` or `suppressed`.
- Diagnostics contain fixed enums only. They contain no selected or surrounding text, clipboard data, credentials, environment values, context hashes, request/response bodies, or raw payloads.
- Focused executable tests prove suggestion, empty, and failed cloud outcomes plus presented/suppressed overlay disposition. The existing native-loop routing test proves Rewrite classification at the public app boundary.
- The maintainer subsequently stopped the obsolete main-checkout runtime, launched only isolated candidate `82ea299`, and supplied the successful physical TextEdit Rewrite observation in issue comment `5018637740`.
- At the start of the following rollover, a `/Users/cuevaio/projects/tabbb` tree was reported active and was treated as user-owned. A bounded executable/cwd recheck found no matching Tab runtime by the time validation resumed, so no process was terminated and no concurrent candidate observation was claimed.

## Locked Deferred Residuals

Decision `79-unattended-manual-validation-disposition` forbids further interactive requests and accepts unautomatable real-application rows as deferred residual validation. No post-fix physical keyboard, click, exact replacement, multiline/plain-text, or clipboard-restoration result is claimed. The executable helper contract instead proves that Option+Tab emits only fixed-enum diagnostics plus `accept-suggestion`, reports the event consumed, and runs through the same `.defaultTap` configuration used by production so ordinary target Tab delivery cannot race Acceptance. Any later hands-on incompatibility should be filed as a focused follow-up issue.
