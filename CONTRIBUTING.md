# Contributing

Tabb is a three-app monorepo with shared packages for product contracts, redaction, and cross-runtime policy.

## Product Language And Decisions

- Use `docs/PRD.md` as the canonical product requirements document for the Tabb MVP.
- Use `CONTEXT.md` as the canonical glossary for product terms such as Typing Context, Suggestion, Acceptance, and Personal Memory.
- Keep architectural decisions discoverable in `docs/adr/`; issue #2 is anchored by `docs/adr/0031-three-app-monorepo-with-shared-packages.md` and `docs/adr/0032-effect-for-typed-services-and-error-handling.md`.
- Preserve the PRD boundary between the Electron desktop app, TanStack Start web app, Cloudflare Worker Hono API, and shared packages.

## Commands

- Install with `bun install`.
- Run `bun run typecheck` before committing.
- Run `bun run test` before committing.
- `bun run lint` currently aliases the strict TypeScript baseline until a dedicated linter is introduced.

## API Contracts

- Put shared desktop/API request and response schemas in `@tabb/contracts`.
- Use `status: "ok"` success envelopes and `status: "error"` error envelopes so callers can distinguish empty suggestion results from API failures.

## Effect Usage

Use Effect-style service boundaries for cross-runtime workflows with typed dependencies and explicit failures, especially API orchestration, memory policy decisions, quota checks, retries, and background work. Keep simple UI rendering and placeholder shell code free of unnecessary Effect abstractions.
