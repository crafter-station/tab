# In Memory Only Local Typing Context

Tab keeps the native app's rolling typing context buffers in process memory only and does not persist them to disk. A buffer may be retained by application-window identity for up to five minutes so a person can switch away and resume typing without losing recent Typing Context. Retention is bounded to 20 inactive sessions and the normal per-buffer context limit; the oldest session is discarded when the bound is reached.

Ordinary context invalidation clears only the active session so activity in another application cannot erase a temporarily inactive session. All active and inactive buffers are cleared aggressively on pause, secure input, entry into a private application, sleep/lock, secret-like context detection, app quit, or explicit user action.
