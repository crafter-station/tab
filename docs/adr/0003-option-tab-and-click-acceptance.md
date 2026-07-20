# Option Tab And Click Acceptance

Tab accepts a visible suggestion with Option+Tab or by clicking the floating suggestion overlay, then inserts the suggestion into the previously active application via clipboard paste. Option+Tab is preferred over Fn+Tab for the MVP because Fn handling can be inconsistent across macOS keyboards and global input APIs.

Double-tapping Option within 400 milliseconds explicitly requests Deep Complete at a reliably observed caret or Rewrite for a reliable non-empty selection. Tab does nothing when selection state is unknown rather than risk pasting a continuation over text it could not observe. Any intervening text, shortcut, or navigation input cancels the double-tap sequence so ordinary Option usage does not trigger a request.
