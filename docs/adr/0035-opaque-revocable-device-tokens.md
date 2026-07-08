# Opaque Revocable Device Tokens

Tab issues one opaque device token per native app installation after browser-based login handoff. The native app stores the token in macOS Keychain, the backend stores only a token hash in D1, and users can revoke devices from account settings or the native app.
