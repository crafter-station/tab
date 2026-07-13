# Local-First Product And Monetization Strategy

## Product Promise

Tab is autocomplete everywhere on the Mac: private by default and smarter when the user asks.

- Automatic Suggestions are fast Local Suggestions for routine writing.
- Deep Complete is an explicit cloud-backed action for harder writing moments.
- Personal Memory makes Suggestions personal while remaining visible and controllable.
- Local inference never silently falls back to the cloud.

Deep Complete is a different user job, not merely the same Suggestion from a larger model. Product copy and onboarding should teach when to use it and disclose that bounded, redacted context is sent only after the explicit action.

## Initial Audience

The initial ideal customer is a Mac-based developer or technical founder who writes across Slack, email, Linear, GitHub, terminals, and AI coding tools. The working audience-specific promise is:

> Copilot handles the code. Tab handles everything around it.

This audience already pays for productivity tools, understands local models and privacy, writes across many applications, and is reachable through founder-led distribution. Sales and support teams are a later opportunity after Tab has administration, deployment, shared vocabulary, and compliance controls.

## Launch Plans

| Entitlement | Free | Pro | Max |
| --- | --- | --- | --- |
| Price | $0 | $10/month | $20/month |
| Trial | One 30-day account-level Pro trial, no card | Not applicable | Not applicable |
| Local Suggestions | 100 Accepted Words/day | Unlimited Accepted Words | Unlimited Accepted Words |
| Deep Complete | 10/month | 300/month | 1,000/month |
| Personal Memory | Manage existing memories; basic personalization | Continuous Memory Extraction and personalization | Same as Pro |
| Writing controls | Defaults | Custom writing instructions | Same as Pro |
| Local models | Recommended supported model | Supported model catalog | Same as Pro |
| Personal Macs | 1 | Up to 3 | Up to 3 |

Pro and Max are monthly-only subscriptions. Tab has no annual plan and no annual customers. Max differs from Pro only in its monthly Deep Complete allowance. Additional cloud packs, teams, a lifetime local license, and a separate local-only purchase are deferred until usage demonstrates demand.

## Metering Principles

- Meter value received, not model activity.
- A Local Suggestion consumes allowance only for Accepted Words inserted by the user.
- A Deep Complete consumes one allowance only when an explicit request returns a Suggestion.
- Internal retries never create multiple charges.
- Empty responses, failures, ignored Suggestions, dismissals, and stale Suggestions do not count.
- Exhausting one allowance does not disable unrelated product capabilities.
- Show the user value received before showing allowance remaining.

The exact word-boundary algorithm, reset behavior across timezone changes, offline reconciliation, and multi-device concurrency must be specified and tested during implementation.

## Personal Memory Boundary

Do not market Personal Memory count as the reason to upgrade. Storage count is difficult to predict, poorly aligned with value, and creates the impression that users must pay to retain control of their own data.

- Paid plans fund continuous Memory Extraction, synchronization across entitled devices, and cloud-backed personalization work.
- Existing memories remain visible, editable, exportable, and deletable after downgrade or cancellation.
- A generous technical record ceiling, extraction-rate limit, and semantic deduplication protect infrastructure.
- Memory contents, Typing Context, and Suggestion text remain excluded from product analytics.

## Metric Model

The north-star metric is **Weekly Habitual Completers**: users who accept at least 20 Suggestions over at least three active days in a week.

### Activation

- Permission and setup completion.
- First accepted Suggestion within ten minutes of setup.
- Five accepted Suggestions in the first day.
- Strong activation: twenty acceptances across at least two application categories within three days.

### Local Value

- Local Suggestions generated, shown, accepted, dismissed, stale, and failed.
- Accepted Words and accepted characters.
- Acceptance rate and active writing days.
- Application category breadth, derived on-device without document names or window titles.
- Local latency, model version, hardware tier, and resource-related disablement.

### Deep Complete Value

- Eligible users exposed to the action.
- Explicit requests, successful returned Suggestions, acceptances, and repeat-use days.
- Acceptance rate and accepted characters.
- Memory-used flag/count and acceptance lift when Personal Memory is used.
- Latency, provider/model version, cost per request, and cost per accepted result.

### Retention And Revenue

- W1, W4, and W8 retention among activated users.
- Retention by local-only, Deep Complete-tried, repeat-Deep-Complete, and memory-enabled cohorts.
- Free allowance reached, offer viewed, checkout started, paid, and retained at 30/60 days.
- Monthly conversion by plan and trigger.
- Paid gross margin at median, 90th-percentile, and 99th-percentile cloud usage.

### Trust Guardrails

- Permission abandonment, pause/disable, uninstall, analytics opt-out, and support-contact rate.
- Crash-free sessions and local/cloud failure rates.
- No raw Typing Context, Suggestion text, Personal Memory contents, clipboard contents, URLs, document names, window titles, or contact identities in analytics.

User-facing statistics should emphasize completed words, approximate typing saved, active writing days, and local versus Deep Complete value. Remaining allowance is secondary entitlement information rather than the dashboard headline.

## Launch Validation

### Days 1-30: Habit

- Recruit 40-60 users across developers, founders, writers, and support professionals.
- Instrument local and Deep Complete behavior separately.
- Measure setup friction, first value, acceptance, latency, and W1 retention.
- Interview activated, retained, and churned users.
- Select the first audience by observed retention rather than stated enthusiasm.

### Days 31-60: Payment

- Concentrate recruitment on the strongest cohort.
- Launch the 30-day Pro trial, $10 monthly Pro, and $20 monthly Max.
- Present paid conversion only after demonstrated value.
- Compare conversion after reaching the local allowance, repeating Deep Complete, and experiencing continuous personalization.
- Compare Pro and Max conversion without introducing annual-plan complexity.

### Days 61-90: Repeatable Distribution

- Publish short workflow demonstrations across Slack, terminal, email, and Linear.
- Work with small Mac productivity creators and compensate on activated or paid users.
- Use founder-led distribution in developer, Mac, and productivity communities.
- Publish high-intent comparison and audience pages only after the product claims are demonstrably true.
- Ask for referrals after a value milestone such as 1,000 Accepted Words, not immediately after installation.

Avoid scaling paid acquisition until one audience shows strong activated-user W4 retention. Initial validation targets are greater than 70% setup completion, greater than 50% activation after completed setup, greater than 35% activated-user W4 retention, greater than 40% first-result Deep Complete acceptance, and greater than 75% paid cloud gross margin. These are decision thresholds, not external promises.

## Open Validation Questions

1. Does Local Suggestion usage alone create durable W4 retention?
2. Is Deep Complete a distinct and repeated job, rather than a novelty?
3. Does Personal Memory create a noticeable acceptance lift?
4. Which trigger best predicts payment: local allowance, repeated Deep Complete, or continuous personalization?
5. Are the Free, Pro, and Max allowances understandable without creating usage anxiety?
6. Does the higher Max Deep Complete allowance attract heavy users without confusing Pro buyers?
7. Which audience has the best combination of retention, willingness to pay, and reachable distribution?
