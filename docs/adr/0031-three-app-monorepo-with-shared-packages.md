# Three App Monorepo With Shared Packages

Tab is organized as a monorepo with separate apps for the Electron desktop app, TanStack Start web app, and Cloudflare Worker Hono API, plus shared packages for schemas, memory policy, redaction, billing, and other cross-runtime logic. This keeps native, web, and edge runtime concerns isolated while avoiding duplicated contracts and policy code.
