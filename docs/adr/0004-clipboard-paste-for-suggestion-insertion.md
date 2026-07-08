# Clipboard Paste For Suggestion Insertion

Tab inserts an accepted suggestion by temporarily placing it on the clipboard and sending paste to the previously active application, with best-effort restoration of the prior clipboard contents. This is the MVP insertion path because it works across more macOS applications than accessibility text insertion or simulated character typing, while app-specific insertion adapters can be added later.
