# Issue 77 Acceptance Matrix

| Criterion | Implementation boundary | Happy-path evidence | Adversarial or malformed case | Focused check | Non-goal or decision |
| --- | --- | --- | --- | --- | --- |
| Explicit routing | Native session explicit-action classifier | Reliable zero-length range keeps Deep Complete; reliable exact non-empty range selects Rewrite | Missing/unreliable/inconsistent range or selected text selects neither | `desktop-native-loop.test.ts` routing cases | Automatic Suggestion ownership is unchanged |
| Secure and secret-like suppression | Classifier plus Rewrite client redaction guard | Ordinary selected prose reaches Rewrite | Secure target, private app, or redaction match sends no explicit request | Native-loop and API-client suppression cases | Secrets are suppressed, not partially rewritten |
| Selection bounds | Classifier and Rewrite contract | Lengths 1 and 2,000 are sent without truncation | Empty is not Rewrite; 2,001 shows bounded guidance and sends nothing | API-client boundary cases and native-loop guidance case | Oversized text is never truncated |
| Protected request | Desktop API suggestion client | Selected text, bounded before/after context, app/target identity, redaction, eligible personalization, and client metadata only | Clipboard, full field/tree, key events, titles, URLs, screenshots, and documents are absent | Exact request-key assertion; clipboard spy remains untouched | Rewrite excludes App Context because it can contain document-like text |
| Rewrite presentation | Native session, main IPC, overlay UI | Successful replacement is floating, labeled Rewrite, and has Rewrite provenance | Empty/invalid API result presents nothing | Native-loop provenance and renderer checks | Rewrite uses the existing bottom overlay, never caret-inline presentation |
| Oversized guidance | Main IPC and overlay UI | Brief `Select up to 2,000 characters` message | Guidance has no Acceptance click or shortcut | Native-loop output and renderer checks | Guidance is not a Suggestion and has no telemetry text |
| Pending and visible invalidation | Text Session context hash and session invalidation | Stable source context permits presentation | App/window, focus, text element, range, selected text, before/after context, secure input, pause, sleep/lock via clear, secret-like state, and explicit clear invalidate | Table-driven native-loop stale-dimension test | Window identity is part of Active Application identity |
| Late responses | Existing Deep Complete request version and abort boundary | Current response may present | Invalidated/aborted response cannot reappear | Deferred-response native-loop case | Network cancellation is best effort; version rejection is authoritative |
| Metadata-only telemetry | Existing interaction telemetry builder | Rewrite records mode/length metadata | Selected, surrounding, and replacement text are absent | Serialized telemetry assertion | Raw text is never persisted for diagnostics |
| Existing ownership | Automatic Suggestion and Deep Complete modules | Automatic remains local; caret explicit remains Deep Complete | Rewrite never becomes automatic fallback | Existing native-loop suite plus routing cases | No API recreation and no Automatic Suggestion behavior change |

## Commit Milestones

1. Route reliable selections and construct the protected Rewrite request with exact boundaries.
2. Present Rewrite provenance and non-acceptable oversized guidance while enforcing stale-context invalidation.
3. Add exhaustive native-loop, client, renderer, and telemetry regressions and finalize matrix evidence.
