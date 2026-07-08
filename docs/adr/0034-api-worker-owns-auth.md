# API Worker Owns Auth

Tab runs Better Auth in the Hono API Worker as the source of truth for users, sessions, and native device-token exchange. The TanStack Start web app provides the account and login UI as a client of the API, while the Electron app authenticates through a browser handoff and stores a device-scoped token in macOS Keychain.
