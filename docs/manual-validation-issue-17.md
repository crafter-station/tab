# Issue 17 Manual Validation

Validate on macOS with the desktop app launched from `bun run desktop:dev` after granting Accessibility and Input Monitoring.

1. Supported native text app: open TextEdit, type in a plain text document, and observe native helper stdout or desktop debug logging for `text-session` messages with `accessibilityReliability: "reliable"`, `activeApplication.bundleId: "com.apple.TextEdit"`, `selectedRange`, optional `selectedText`, bounded `surroundingContext`, and optional `caretBounds`. Suggestions should continue to appear from the Text Session context.
2. Unsupported or incomplete Accessibility case: revoke Accessibility permission or type in a custom control that does not expose AX text attributes. The helper should emit `accessibilityReliability: "unavailable"` or `"unreliable"` without crashing, and listen-only keyboard events should continue to provide fallback Typing Context signals.
