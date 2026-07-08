# App Context Manual Validation Matrix

Use this matrix for issue 34 and PRD 26 validation on macOS with Accessibility and Input Monitoring enabled. App Context must remain temporary, suggestion-only background that is distinct from Typing Context and Personal Memory.

For every supported app, verify the debug or settings surface shows App Context status, provider, confidence, suppression reason when present, and allowlist state without requiring Screen Recording, Full Disk Access, raw logs, screenshots, browser history, hidden DOM, or file reads.

| App | Provider | Expected context | Validation notes |
| --- | --- | --- | --- |
| WhatsApp | `whatsapp-accessibility` | Recent visible conversation | Reply in a chat and confirm bounded conversation background is separate from Typing Context. |
| Ghostty | `ghostty-accessibility` | Terminal session text | Type prose or an agent prompt and confirm terminal output stays suggestion-only and Personal Memory ineligible. |
| Obsidian | `obsidian-accessibility` | Nearby note/document text | Edit markdown and confirm no vault file reads or Full Disk Access prompts. |
| Zed | `zed-accessibility` | Focused editor context | Edit prose or markdown and confirm partial Accessibility data degrades gracefully. |
| Chrome | `chrome-accessibility` | Browser writing surface text | Test Gmail, Google Docs, ChatGPT, GitHub, Linear, or Notion and confirm URLs/history/hidden DOM are not sent by default. |
| Apple Notes | `notes-accessibility` | Nearby note text | Confirm note context is bounded to visible/editor semantics. |
| Apple Mail | `mail-accessibility` | Visible email thread/reply context | Confirm App Context is separate from the user-authored draft. |
| Messages | `messages-accessibility` | Recent visible conversation | Confirm conversation background remains temporary and memory-ineligible. |
| Slack | `slack-accessibility` | Visible channel, DM, or thread context | Confirm provider metadata appears without raw text logs. |
| Discord | `discord-accessibility` | Visible channel or DM context | Confirm provider metadata appears without passive-memory creation. |
| VS Code | `vscode-accessibility` | Focused editor context | Confirm prose, comments, and agent instructions can use bounded context. |
| TextEdit | `textedit-accessibility` | Native document context | Use as a baseline reliable writing-app path. |

Required fallback cases:

- Unsupported-app fallback: type in an app outside the allowlist and confirm App Context status is unsupported while Typing Context and Text Session behavior continue normally.
- Low-confidence extraction: simulate or observe a provider with low reliability and confirm App Context status is suppressed or empty and does not influence suggestions.
- Secure/secret-like suppression: type or expose API keys, bearer tokens, password fields, private keys, or similar content and confirm suggestions are suppressed and both Typing Context and App Context are cleared.
- Metadata-only compatibility diagnostics: confirm diagnostics record app/provider reliability, status, confidence, and suppression reason without raw App Context, raw Typing Context, raw suggestions, accepted suggestion text, browser URLs, screenshots, or final inserted text.
- Global pause and explicit context clearing: pause Tabb or clear context and confirm both Typing Context and App Context disappear immediately from debug surfaces.
