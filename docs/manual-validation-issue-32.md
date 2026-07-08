# Issue 32 Manual Validation: Chrome Web Writing Context

Use a local debug build with Accessibility permission granted. Confirm Debug Context shows `chrome-web-writing-context` fragments separately from Typing Context and that request payloads omit URLs, hidden DOM, navigation/sidebar text, cookies, browser history, unrelated tabs, and full page dumps.

## Gmail Or Email Reply Surface

1. Open a visible email thread in Chrome and focus the reply compose field.
2. Type a short draft response.
3. Confirm App Context includes the focused draft plus a bounded nearby visible thread excerpt.
4. Confirm the address bar URL, mailbox navigation, labels/sidebar, and hidden older content are absent.

## Google Docs Or Long-Form Document Surface

1. Open a long document in Chrome and focus editable document text.
2. Type near the middle of the document.
3. Confirm App Context includes bounded nearby visible document semantics, not the full document.
4. Confirm long context truncates and remains suggestion-only and memory-ineligible.

## GitHub, Linear, ChatGPT, Notion, Or Web Messaging Surface

1. Focus a comment, issue, prompt, task, or message editor in Chrome.
2. Type a draft that depends on visible surrounding page or thread text.
3. Confirm App Context activates only when the focused editor is reliably exposed through Accessibility.
4. Confirm noisy controls, navigation, hidden content, and unrelated page chrome are ignored; if semantics are missing or noisy, Suggestions fall back to existing Typing Context/Text Session behavior.
