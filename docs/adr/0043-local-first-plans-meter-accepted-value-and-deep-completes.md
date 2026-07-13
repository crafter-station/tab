# Local-First Plans Meter Accepted Value And Deep Completes

Tab is local-first: Automatic Suggestions are Local Suggestions and never silently fall back to cloud inference. Double-tapping Option invokes Deep Complete, a separate explicit cloud-backed action for harder writing moments. This supersedes ADR-0026, ADR-0027, and ADR-0029 and partially supersedes the metering scope in ADR-0025 and ADR-0028.

Tab launches with Free and Pro only. Every new account receives one 30-day Pro trial without a payment card; reinstalling or linking another Mac does not restart it. After the trial, Free includes 100 Accepted Words from Local Suggestions per day, 10 successful Deep Completes per month, and one Mac. Pro costs $10 per month or $96 per year and includes unlimited Accepted Words, 300 successful Deep Completes per month, continuous Memory Extraction, custom writing instructions, the supported model catalog, and up to three personal Macs. Tab does not offer Max until observed heavy-use behavior justifies another package.

Local usage counts only Accepted Words inserted through deliberate Acceptance. Generated, shown, ignored, dismissed, stale, empty, and failed Local Suggestions do not consume the daily allowance. Deep Complete usage counts once only when an explicit request returns a Suggestion; internal retries, empty responses, and failures do not count. Exhausting either allowance preserves the rest of the product and presents an upgrade path rather than making Tab appear broken.

Personal Memory record count is not the primary pricing metric. Pro gates continuous Memory Extraction because that is the recurring cloud service. All users retain the ability to view, edit, export, and delete existing Personal Memory after trial expiration, downgrade, or cancellation. The backend may retain a generous technical ceiling, deduplicate records, and rate-limit extraction for safety and abuse prevention.

Polar owns paid products, checkout, subscription lifecycle, customer portal, and webhook-driven entitlement reconciliation. Tab enforces daily Accepted Word and monthly Deep Complete allowances from desktop/API entitlement state without synchronous Polar checks in a Suggestion or Acceptance hot path. Successful Deep Completes may be ingested for cloud usage and cost reporting; local Accepted Words are product telemetry rather than cloud-cost meter events.

The launch prices and allowances are hypotheses to validate against activated-user retention, paid conversion, and cloud gross margin. Changing them requires an explicit product decision supported by observed usage rather than an attempt to preserve the obsolete cloud-only quota model.

## Implementation Policies

- Accepted Words are counted with `Intl.Segmenter` using word granularity and `isWordLike`. Runtimes without `Intl.Segmenter` use a conservative Unicode letter/number fallback that keeps apostrophe contractions together.
- An Acceptance that crosses the Free daily allowance inserts in full and counts every inserted word. Later Local Suggestion acceptances are blocked until reset; Tab never truncates a Suggestion during insertion.
- The one-device Free allowance follows the Mac's local calendar day. The local ledger persists the last observed day and never moves backward after a clock or timezone rollback.
- The Deep Complete allowance uses an account-authoritative UTC calendar month.
- Existing accounts receive one fresh 30-day Pro trial when the new entitlement state is first initialized because no historical trial state exists.
- Existing over-limit devices remain linked. Tab prevents only new device links until the account is within its current limit.
- Paid benefits remain active through Polar's effective `currentPeriodEnd` after cancellation.
- Account sign-in remains required at launch so trial, device, Deep Complete, and Personal Memory entitlements share one identity boundary.
