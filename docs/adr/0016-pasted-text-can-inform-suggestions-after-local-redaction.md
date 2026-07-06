# Pasted Text Can Inform Suggestions After Local Redaction

Tabb may include pasted text in the typing context sent for suggestion generation, but the native app must first detect and redact obvious secrets and sensitive values such as environment variables, tokens, keys, credentials, and other high-risk patterns. This allows pasted context to improve immediate suggestions without intentionally transmitting known secret-like values.
