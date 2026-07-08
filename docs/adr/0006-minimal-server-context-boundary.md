# Minimal Server Context Boundary

Tab's MVP sends only recent typing context, active application identity, and client metadata to the suggestion API. It does not send raw key events, screenshots, full document contents, clipboard contents, browser URLs, window titles, or accessibility tree dumps, preserving a clear privacy boundary around what the native app may transmit.
