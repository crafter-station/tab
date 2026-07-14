# Contributing

Thanks for helping with Tab. This project is a macOS-first native autocomplete app, so small, careful changes matter more than large rewrites. The best contributions keep typing fast, privacy boundaries clear, and contributor review easy.

## Code of Conduct

By participating, you agree to follow the [Code of Conduct](./CODE_OF_CONDUCT.md). Be kind, be specific, and assume good intent while staying direct about risks.

## Good First Contributions

Good starter work usually has a narrow surface area:

- Fix a small bug with a reproduction.
- Add or improve a focused test.
- Clarify setup, product language, or validation docs.
- Improve UI consistency using shared `@tab/ui` patterns.
- Tighten a policy package without changing unrelated behavior.
- Report macOS compatibility findings with exact version and app details.

If you are unsure where to start, open a contributor-help issue or comment on an existing issue and describe the area you want to work on.

## Before You Start

1. Search existing issues and pull requests.
2. For larger behavior changes, open or comment on an issue before investing heavily.
3. Prefer small PRs that can be reviewed in one sitting.
4. Keep unrelated formatting, refactors, and dependency changes out of feature PRs.
5. Never include secrets, raw typing logs, private prompts, customer data, or provider responses in issues, tests, screenshots, or commits.

## Local Setup

Install dependencies and create a local environment file:

```sh
bun install --frozen-lockfile
cp .dev.vars.example .dev.vars
```

Run the baseline checks:

```sh
bun run typecheck
bun run test
```

Useful local commands:

```sh
bun run dev                 # Run API plus web development servers
bun run web:dev             # TanStack Start web app
bun run api:dev             # Cloudflare Worker API through Wrangler
bun run desktop:dev         # Electron desktop app
bun run desktop:permissions # Local macOS build for permission testing
bun run worker:types:check  # Worker binding type validation
bun run lint                # TypeScript baseline until a dedicated linter exists
bun run --cwd apps/web build # Vite/Cloudflare production web build
```

Most tests and type checks do not need real provider credentials. Provider-backed development paths use `.dev.vars`; do not commit that file. The combined `bun run dev` script validates non-empty Polar values, so use safe local placeholders for `POLAR_ACCESS_TOKEN` and `POLAR_ORGANIZATION_ID` when you are not testing billing.

## Repository Structure

```text
apps/api       Cloudflare Worker + Hono API
apps/desktop   Electron macOS app
apps/web       TanStack Start web app
packages/*     Shared contracts, policies, billing, redaction, UI, services
tests/         Cross-surface tests
docs/adr       Architectural decisions
```

## Product Language And Decisions

- Use `docs/PRD.md` as the canonical product requirements document for the Tab MVP.
- Use `CONTEXT.md` as the canonical glossary for terms such as Typing Context, Suggestion, Acceptance, Deep Complete, and Personal Memory.
- Keep architectural decisions discoverable in `docs/adr/`.
- Preserve the PRD boundary between the Electron desktop app, TanStack Start web app, Cloudflare Worker Hono API, and shared packages.

When a PR changes product behavior or privacy boundaries, link the relevant issue, PRD section, or ADR. If no decision exists, propose one before burying the behavior change in code.

## Coding Guidelines

- Keep changes minimal and local to the problem.
- Prefer shared package boundaries for contracts, policies, redaction, billing, and reusable UI.
- Put shared desktop/API request and response schemas in `@tab/contracts`.
- Use `status: "ok"` success envelopes and `status: "error"` error envelopes so callers can distinguish empty suggestion results from API failures.
- Use Effect-style service boundaries for cross-runtime workflows with typed dependencies and explicit failures, especially API orchestration, memory policy decisions, quota checks, retries, and background work.
- Keep simple UI rendering and placeholder shell code free of unnecessary Effect abstractions.
- Use shared `@tab/ui` tokens and patterns instead of introducing local palettes, one-off hex colors, or duplicate primitives.
- Keep app surfaces accessible in light and dark mode.

## Privacy And Trust Rules

Tab handles sensitive typing-adjacent behavior. Treat privacy rules as product requirements, not implementation details.

- Do not persist raw typing logs by default.
- Do not store accepted suggestion text by default.
- Do not add telemetry that includes user-authored text, prompts, completions, secrets, credentials, or document contents.
- Redact logs and screenshots before sharing them in issues or PRs.
- Keep local inference and Deep Complete behavior separate. Local inference must not silently fall back to cloud generation.
- Preserve user-visible controls for Personal Memory wherever behavior affects memory creation, use, export, edit, or deletion.

## Tests And Validation

Run the smallest useful checks while iterating, then the full relevant set before opening a PR.

```sh
bun run typecheck
bun run test
```

For targeted work:

```sh
bun test tests/api-status.test.ts
node --test tests/prd-contracts.test.mjs
```

Desktop and permission changes often need manual validation on macOS. Include the macOS version, hardware, target app, and exact validation steps in the PR.

## Database Migrations

Use the Drizzle schema as the source of truth:

1. Change `apps/api/src/db/schema.ts`.
2. Generate migrations with `bun run db:generate`.
3. Validate locally with `bun run db:migrate:local` when local D1 is available.
4. Do not handwrite or hardcode migration SQL files.

Remote D1 migration commands require `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_DATABASE_ID`, and `CLOUDFLARE_D1_TOKEN`.

## Pull Request Checklist

Before requesting review, make sure the PR includes:

- A clear description of the problem and solution.
- Linked issue or context for behavior changes.
- Tests, or a clear explanation of why tests are not practical.
- Manual validation notes for desktop, permission, billing, auth, or provider-backed changes.
- Screenshots or recordings for user-facing UI changes, with sensitive data removed.
- Notes about privacy, telemetry, storage, or security impact when relevant.

## Review Expectations

Maintainers may ask you to reduce scope, add tests, adjust product language, or split a PR. That is normal and keeps the project easier to maintain. Reviews focus on correctness, privacy boundaries, user trust, and small durable architecture.

## Issue Triage

New issues start with `needs-triage`. The project uses the standard triage labels documented in `docs/agents/triage-labels.md`: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`.

## License

By contributing, you agree that your contributions are licensed under the [AGPL-3.0 license](./LICENSE).
