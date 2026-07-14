# Tab MVP PRD

## Problem Statement

People write across many macOS applications and often repeat the same phrasing, personal details, work context, and writing patterns. Existing autocomplete experiences are usually confined to one editor, browser, or app, so they cannot help while the user writes in Mail, Slack, Notes, terminals, or terminal-based tools like OpenCode.

Tab should provide native autocomplete across active macOS applications without feeling like a web app, keylogger, or intrusive assistant. It must generate routine Suggestions locally by default, offer an explicit cloud-backed Deep Complete for harder writing moments, and insert accepted Suggestions into the active application while preserving user trust.

## Solution

Build a macOS-first Native Autocomplete App with an Electron desktop app, a TanStack Start web business surface, and a Cloudflare Worker Hono API.

The Electron app observes text-bearing Typing Context in memory, suppresses secure or secret-like contexts, generates Automatic Suggestions through a local inference runtime, and displays one short Suggestion in a semitransparent Floating Suggestion Overlay. The user accepts with Option+Tab or by clicking the overlay, and the Electron app inserts the Suggestion into the previously active application using clipboard paste.

Double-tapping Option explicitly invokes Deep Complete. For that action only, the desktop sends bounded, redacted context to the authenticated Hono API. The API checks the user's Deep Complete entitlement, fetches relevant Personal Memory, generates a non-streaming Suggestion through the configured cloud model provider, and returns either one Suggestion or an empty suggestions array. A successful returned Deep Complete consumes one monthly Deep Complete allowance; empty responses and failures do not consume allowance. Local inference never silently falls back to this path.

A separate background memory workflow runs through Cloudflare Queues and may use a slower AI tool loop to read, create, update, or delete system-created Personal Memory after passing deterministic sensitive-data guardrails. Continuous Memory Extraction is a paid-plan service. Every user retains the ability to view, edit, export, and delete existing Personal Memory after trial expiration, downgrade, or cancellation.

The TanStack Start web app provides marketing, download, pricing, account management, Polar checkout/customer portal, device management, product-value metrics, and the full Personal Memory control plane. The Electron app provides onboarding, permissions guidance, local and Deep Complete status, quick memory controls, pause/opt-out controls, and native product settings.

## User Stories

1. As a macOS user, I want to download Tab from a website, so that I can install the native autocomplete app directly.
2. As a macOS user, I want the app to guide me through required permissions, so that I understand why Accessibility or Input Monitoring is needed.
3. As a macOS user, I want Tab to avoid Screen Recording and Full Disk Access, so that I can trust the permission scope.
4. As a macOS user, I want Tab to run in the background, so that it can help while I type in other applications.
5. As a macOS user, I want Tab to observe only recent typing context in memory, so that it does not persist a local typing log.
6. As a macOS user, I want Tab to identify the active application, so that suggestions are grounded in where I am typing.
7. As a macOS user, I want Tab to ignore shortcuts, navigation, window switching, and non-text actions, so that suggestions are based on real typing context.
8. As a macOS user, I want Tab to suppress suggestions in secure input contexts, so that passwords and sensitive fields are not sent.
9. As a macOS user, I want Tab to redact obvious secrets before sending context, so that pasted or typed credentials are not intentionally transmitted.
10. As a macOS user, I want Tab to include pasted text in immediate suggestion context after redaction, so that suggestions can account for what I pasted.
11. As a macOS user, I do not want pasted text to create Personal Memory by default, so that copied third-party text, logs, or configs do not become durable profile data.
12. As a macOS user, I want Tab to work in terminal applications, so that it helps while I write inside terminal-based tools.
13. As an engineer, I want Tab to learn from user-authored terminal input, so that my OpenCode and terminal writing patterns can improve suggestions.
14. As an engineer, I do not want Tab to learn from terminal output, logs, or passive buffer content, so that server logs and command output do not become memories.
15. As a writer, I want suggestions to appear in a bottom-of-screen Floating Suggestion Overlay, so that the active application keeps receiving input.
16. As a writer, I want the overlay to be semitransparent and lightweight, so that it does not obscure my work.
17. As a writer, I want suggestions to appear only after a short pause, so that the overlay does not flicker on every keystroke.
18. As a writer, I want stale suggestions to disappear when I keep typing, so that I never accept text for the wrong context.
19. As a writer, I want to accept a suggestion with Option+Tab, so that I can insert text without leaving the keyboard.
20. As a writer, I want to accept a suggestion by clicking the overlay, so that I can insert it with the pointer.
21. As a writer, I want Tab to paste the accepted suggestion into the active application, so that it works across many macOS apps.
22. As a writer, I want Tab to preserve my clipboard as best as possible, so that accepting a suggestion does not unexpectedly destroy clipboard contents.
23. As a writer, I want Tab to fail silently when the network is slow, so that typing is never blocked.
24. As a writer, I want durable status to appear in tray/settings, so that I can diagnose auth, entitlement, or connectivity issues without typing interruptions.
25. As a user, I want Tab to make suggestions feel personal, so that it can complete text using facts and preferences I commonly use.
26. As a user, I want Personal Memory stored in the backend, so that personalization follows my account and not only one local machine.
27. As a user, I want to see all stored Personal Memory, so that I know what Tab remembers about me.
28. As a user, I want to delete any Personal Memory, so that I control what Tab uses for personalization.
29. As a user, I want memory controls in the web app, so that I can manage memories from my account surface.
30. As a user, I want quick memory controls in the native app, so that I can pause, review, or delete memory near where suggestions happen.
31. As a privacy-conscious user, I want Tab to avoid storing raw typing logs by default, so that my private writing is not retained as a corpus.
32. As a privacy-conscious user, I want sensitive-data guardrails before memory persistence, so that secrets, tokens, payment data, and identifiers are rejected.
33. As a privacy-conscious user, I want metadata-only suggestion telemetry, so that product quality can improve without storing raw text.
34. As a privacy-conscious user, I do not want accepted suggestion text stored by default, so that private inserted content is not retained.
35. As a user, I want to globally pause or opt out of typing observation, so that I can disable Tab when I choose.
36. As a future user, I want per-application controls eventually, so that I can choose where suggestions and memory learning apply.
37. As a new user, I want to sign in through the browser, so that account authentication is familiar and secure.
38. As a desktop user, I want the native app to stay signed in through a device token, so that I do not need browser cookies in the app.
39. As a user, I want to revoke old devices, so that lost or unused installations stop accessing my account.
40. As a new customer, I want the first month of Pro or Max free, so that I can experience unlimited local writing, Deep Complete, and continuous personalization before the first charge.
41. As a free user, I want up to 100 Accepted Words from Local Suggestions each day, so that Tab remains useful for occasional writing.
42. As a Pro user, I want unlimited Accepted Words from Local Suggestions for $10 per month, so that I can use Tab throughout every writing day.
43. As a free user, I want 10 Deep Completes per month, so that I can use the higher-capability path for occasional difficult writing.
44. As a Pro user, I want 300 Deep Completes per month, so that the higher-capability path can become part of my regular workflow.
45. As a Max user, I want 1,000 Deep Completes per month for $20 per month with the same other capabilities and device limit as Pro, so that heavy Deep Complete usage does not require a different workflow.
46. As a user, I want local usage to count only words I deliberately accept, so that ignored, dismissed, and stale Suggestions never consume my allowance.
47. As a user, I want Deep Complete usage to count only once when an explicit request returns a Suggestion, so that retries, empty responses, and failures never consume additional allowance.
48. As a paid user, I want continuous Personal Memory learning, so that Tab stays current with the facts and preferences I repeatedly write.
49. As a user, I want to retain access to view, edit, export, and delete Personal Memory after downgrade or cancellation, so that my data is never held hostage.
50. As a user, I want entitlement exhaustion to preserve the rest of Tab and show an upgrade path, so that reaching a limit never makes the app appear broken.
51. As a business owner, I want local and Deep Complete usage tracked separately, so that product value, conversion, and cloud unit economics can be measured independently.
52. As a developer, I want a native loop spike first, so that the riskiest macOS interaction is proven before building the full stack.
53. As a developer, I want shared schemas and policies, so that Electron, web, and API agree on request contracts, redaction, memory, and entitlement behavior.
54. As a developer, I want Effect for typed services and errors, so that cross-runtime workflows are explicit and testable.
55. As a developer, I want the Hono API to own auth, Deep Complete generation, memory APIs, Polar webhooks, and device tokens, so that backend authority is centralized.

## Implementation Decisions

- Build a three-app monorepo: Electron desktop app, TanStack Start web app, and Cloudflare Worker Hono API.
- Use shared packages for API schemas, memory policy, sensitive-data redaction, plan entitlement definitions, and reusable Effect services.
- Use Electron as the native product surface for macOS onboarding, permissions guidance, input observation, overlay display, acceptance, clipboard paste, and quick controls.
- Use TanStack Start as the web business surface for marketing, download, pricing, account management, Polar checkout/customer portal, memory management, and device management.
- Use Cloudflare Workers with Hono as the backend API runtime.
- Use Better Auth as the identity layer, owned by the Hono API Worker.
- Use browser-based login handoff for the native app, with a custom URL scheme callback and device-scoped token exchange.
- Store native device tokens in macOS Keychain and only token hashes in D1.
- Make device tokens opaque, per-installation, rotatable, and revocable.
- Use Cloudflare D1 for durable product data: users, devices, Personal Memory, memory mutations, subscription/entitlement cache, settings, local usage state, and metadata-only suggestion events.
- Use Cloudflare KV for short-lived exchange, rate-limit, and cache data where appropriate.
- Use durable background delivery for memory jobs and Polar meter ingestion retries; Polar usage uses a D1 transactional outbox drained by the Worker schedule.
- Do not use R2 for raw typing or suggestion storage by default.
- Use a local inference runtime for Automatic Suggestions and the AI SDK through the configured cloud provider for Deep Complete and Memory Extraction.
- Never silently fall back from local inference to Deep Complete.
- Use one explicit cloud model call for Deep Complete and a separate slower background Memory Extraction workflow.
- Fetch relevant active Personal Memory before suggestion generation rather than using a model tool call to read memory in the hot path.
- Return non-streaming suggestions for MVP.
- Return `200 OK` with `suggestions: []` when no confident suggestion should be shown.
- Reserve API errors for invalid requests, authentication failures, entitlement failures, rate limits, and backend/provider failures.
- Use an array-shaped `suggestions` response but return at most one suggestion in MVP.
- Count Free local allowance in Accepted Words, with a daily reset. Ignored, dismissed, stale, empty, and failed Local Suggestions do not count.
- Count one Deep Complete when an explicit request returns at least one Suggestion. Internal retries, empty responses, and failures do not count.
- Treat allowance exhaustion as an entitlement state with a visible upgrade path, not an empty Suggestion result.
- Model Free, Pro, and Max as monthly Polar products. Provision Free asynchronously after verified signup and use Polar for paid checkout, subscription management, customer portal, and lifecycle reconciliation.
- Enforce Accepted Word and Deep Complete allowances from local app/backend entitlement state without calling Polar synchronously in either hot path.
- Configure a one-month trial on both paid products in Polar. The trial starts only after checkout, requires a payment method, converts to the selected monthly plan unless canceled, and uses Polar's trial-abuse prevention.
- After the trial, Free includes 100 Accepted Words per day, 10 Deep Completes per month, one Mac, and management of existing Personal Memory.
- Use Ternary Bonsai 8B as the default local model for Automatic Suggestions and make it downloadable and selectable on every plan, including Free. Additional supported catalog models may remain a paid capability.
- Pro costs $10 per month and includes unlimited Accepted Words, 300 Deep Completes per month, continuous Memory Extraction, custom writing instructions, the supported model catalog, and up to three personal Macs.
- Max costs $20 per month and includes 1,000 Deep Completes per month. Its other capabilities and three-device limit are the same as Pro.
- Offer paid plans monthly only. There is no annual plan and there are no annual customers.
- Do not use Personal Memory record count as the primary pricing metric. Keep a generous technical abuse ceiling and gate continuous learning rather than access to user data.
- Preserve view, edit, export, and delete controls for Personal Memory after trial expiration, downgrade, or cancellation.
- Use exact cached Polar subscription period boundaries for every Deep Complete allowance; never substitute a fixed 30-day or UTC calendar month.
- Durably meter successful Deep Completes and Local Accepted Words to Polar for reporting. Local Accepted Words remain Mac-local daily allowances enforced by Tab, not Polar credits.
- Do not call Polar synchronously on every Suggestion or Acceptance.
- Keep the native rolling typing context buffer in process memory only.
- Clear the local typing context buffer on app switch, pause, secure input, sleep/lock, secret-like context detection, app quit, and explicit user action.
- Observe typing context across active applications by default after explicit macOS permissions, with a global pause/opt-out control for MVP.
- Defer per-application allow/deny controls until after MVP.
- Suppress suggestion requests locally for secure input, password-like contexts when detectable, known password managers, and obvious secret-like text before network transmission.
- Allow terminal user-authored input to inform suggestions and memory.
- Exclude terminal output, logs, passive buffer content, screenshots, clipboard contents, and scraped documents from memory sources by default.
- Allow pasted text to inform immediate suggestions after local redaction.
- Do not allow pasted text to create Personal Memory by default.
- Store durable Personal Memory in the backend database, not on user disk.
- Do not store raw typing logs by default.
- Do not store accepted suggestion text, final inserted text, or surrounding raw context by default.
- Record Suggestion telemetry as metadata only: local or cloud inference, automatic or explicit trigger, generated, shown, accepted, dismissed, stale, or failed outcome, Accepted Word and character counts, app category, latency, memory-used flag/count, plan, model version, cloud cost where applicable, and timestamp.
- Use both prompt-level and deterministic programmatic guardrails for memory creation and updates.
- Reject memory candidates containing secrets, tokens, environment variable values, payment data, government identifiers, private keys, auth headers, cookies, high-entropy strings, and other high-risk patterns.
- Show all active Personal Memory in both web and native surfaces, with deletion controls.
- Keep background memory work non-blocking by enqueueing jobs after suggestion requests.
- Allow the background memory agent to use tools to read, create, update, or archive memories, but enforce backend validators before persistence.
- Show the Floating Suggestion Overlay at the bottom of the screen for MVP, not near the caret.
- Accept suggestions with Option+Tab or click.
- Insert accepted suggestions through clipboard paste into the previously active application, with best-effort clipboard restoration.
- Avoid making the overlay an error notification surface; transient failures should hide or withhold suggestions and surface status in tray/settings.
- Distribute the macOS app directly as a signed and notarized download, not through the Mac App Store for MVP.
- Request only the macOS permissions needed for typing-context observation, active application awareness, global acceptance, and suggestion insertion; do not require Screen Recording or Full Disk Access.
- First implementation milestone is a native macOS loop spike with fake suggestions before building full AI, memory, billing, and web surfaces.

## Testing Decisions

- The highest-value first test seam is the native macOS loop: observed typing context produces a visible fake suggestion, Option+Tab or click inserts it into the active application, and context changes clear stale suggestions.
- Native spike testing should cover TextEdit, Notes, Mail, Slack, Ghostty, and at least one secure input/password scenario.
- Native tests should validate external behavior rather than internal implementation details: overlay appears, overlay hides, suggestion inserts, shortcuts are ignored, app switch clears state, secure input suppresses requests.
- Deep Complete API contract tests should cover a successful Suggestion, empty Suggestions, invalid request, unauthenticated request, revoked device, allowance exhausted, and provider failure.
- API tests should assert that `suggestions: []` is a successful no-Suggestion result and that Deep Complete allowance exhaustion is an entitlement error.
- Local allowance tests should cover Accepted Word counting, word boundaries, daily reset, offline use, restart persistence, and multi-device reconciliation without counting ignored, dismissed, stale, empty, or failed Suggestions.
- Deep Complete allowance tests should assert that one successful returned Suggestion consumes one allowance, internal retries do not double-count, and empty or failed requests do not count.
- Trial and plan tests should cover Free-by-default accounts, Polar trialing Pro and Max entitlements, monthly paid conversion, one-versus-three-device enforcement, downgrade, and cancellation.
- Memory entitlement tests should verify that paid plans receive continuous Memory Extraction while every user can view, edit, export, and delete existing memories.
- Memory policy tests should focus on external policy behavior: typed text can produce memory jobs, pasted text cannot create memory by default, terminal user input is eligible, terminal output is not.
- Redaction tests should include common environment variable values, API keys, bearer tokens, private key blocks, database URLs, auth cookies, payment data, government identifiers, and high-entropy strings.
- Background memory workflow tests should verify that unsafe memory tool writes are rejected by deterministic validators even if the model proposes them.
- Web app tests should cover Free, Pro, and Max pricing display, plan-only monthly Polar checkout forwarding, Polar trial state, product-value metrics, allowance state, account login, retained memory controls, and device revocation.
- Desktop auth tests should cover browser handoff, device-token exchange, Keychain storage, revoked token handling, and sign-in-required status.
- Telemetry tests should cover local/cloud and automatic/explicit dimensions, outcomes, Accepted Word/character counts, app category, memory-use metadata, conversion events, and cloud cost while asserting that raw Typing Context, Suggestion text, and Personal Memory contents are not persisted.
- Tests should prefer shared schema fixtures and public API boundaries over testing private functions.

## Out of Scope

- Windows and Linux support.
- Mac App Store distribution.
- Caret-relative suggestion positioning.
- Streaming token-by-token suggestions.
- Multiple suggestions in the MVP overlay.
- Regenerate-suggestion command.
- Per-application allow/deny controls for MVP.
- Raw typing log storage.
- Full document scraping.
- Terminal buffer scraping.
- Screenshot capture.
- Clipboard-content memory creation.
- Screen Recording permission.
- Full Disk Access permission.
- Direct native text insertion adapters beyond clipboard paste.
- Silent high-risk memory persistence.
- Storing accepted suggestion text by default.
- R2-based raw debug/evaluation capture by default.
- Advanced team/seat billing.
- Automatic cloud fallback when local inference is unavailable or returns no Suggestion.
- A lifetime license or separate one-time local-only purchase.

## Further Notes

- The riskiest assumption is that Electron plus a macOS native bridge can reliably observe text-bearing global input, filter non-text actions, identify the active application, show a non-disruptive bottom overlay, detect Option+Tab, and paste into the previously active application without stealing focus. This must be proven before the full stack is built.
- The second riskiest assumption is trust. Tab needs explicit language and controls that distinguish Typing Context, Personal Memory, telemetry metadata, and raw logs. Raw logs are not part of the default product.
- Polar subscription state does not enforce product allowances by itself. Tab must keep authoritative Accepted Word and Deep Complete entitlement state in the desktop/API boundary and use Polar for paid subscription lifecycle and reporting.
- The pricing numbers are launch decisions to validate against retained usage, conversion, and cloud cost. Revisit the Deep Complete allowance only after measuring gross margin at median, 90th-percentile, and 99th-percentile usage.
- AI SDK and AI Gateway implementation details, including current model IDs, must be verified against current docs during implementation rather than relying on memory.
- The glossary in `CONTEXT.md` is the canonical product language for future specs, implementation, and UI copy.
- Do not close until all subissues are closed.
