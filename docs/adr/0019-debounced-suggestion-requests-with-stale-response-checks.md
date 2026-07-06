# Debounced Suggestion Requests With Stale Response Checks

Tabb requests suggestions after a short debounce rather than on every keystroke. The native app cancels or marks stale in-flight requests when typing context changes, and displays a response only if the request is still current for the same active application and context hash.
