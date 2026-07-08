# Native App Owns Typing Interpretation

Tab's native app decides when user input represents typing context, when to request a suggestion, and when to cancel or hide one; the server receives only filtered typing context and generates a suggestion. This keeps privacy-sensitive input filtering, active application awareness, latency control, and acceptance behavior close to the macOS event loop instead of sending raw key events to the backend.
