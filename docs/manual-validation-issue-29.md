# Issue 29 Manual Validation: Ghostty App Context

1. Prose/agent-prompt scenario: open Ghostty, start writing a commit message, prompt, or agent instruction in an editable terminal surface, and confirm the Debug Context surface reports `appContextProvider: ghostty-terminal` with an available App Context fragment while the Suggestion continues the current Typing Context.
2. Sensitive terminal scenario: display or type a token-like value such as an auth header or API key in Ghostty, then type nearby prose. Confirm the App Context status is suppressed or empty and no raw secret-like terminal text appears in the request debug payload.
3. Fallback scenario: repeat in a non-Ghostty terminal or with unreliable Accessibility text. Confirm Suggestions still use Typing Context and do not attach Ghostty App Context.
