# Suggestion-Only App Context Fragments

Tab may send bounded, redacted App Context fragments to the hot suggestion API as background for the current request only. App Context is separate from Typing Context, Text Session snapshots, the Memory Extraction Window, and Personal Memory.

Suggestion requests carry App Context in an optional `appContext` field instead of concatenating passive content into `typingContext`. The prompt labels these fragments as suggestion-only background and still asks the model to continue the user's exact draft.

App Context fragments are in-memory, bounded, redacted before request construction, and omitted when unavailable or suppressed. The desktop clears them with the same sensitive lifecycle events as Typing Context, including pause, app/window changes, secure or private contexts, secret-like detection, and explicit clearing.

App Context is never Personal Memory eligible by default. Backend memory selection and memory job enqueueing continue to use only the user-authored `typingContext` and its context source.

Manual validation for the common writing app slice should type ordinary prose in Apple Notes, Slack, Discord, Apple Mail, Messages, VS Code, and TextEdit. Confirm supported reliable Accessibility surfaces show bounded suggestion-only App Context separately from Typing Context, while unsupported or low-confidence surfaces continue Suggestions through existing Typing Context/Text Session behavior without raw context logging.
