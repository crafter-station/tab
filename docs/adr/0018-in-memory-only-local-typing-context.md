# In Memory Only Local Typing Context

Tab keeps the native app's rolling typing context buffer in process memory only and does not persist it to disk. The buffer is bounded and cleared aggressively on application switches, pause, secure input, sleep/lock, secret-like context detection, app quit, or explicit user action.
