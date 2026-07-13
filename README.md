# Tab

[![CI](https://github.com/crafter-station/tab/actions/workflows/ci.yml/badge.svg)](https://github.com/crafter-station/tab/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](./LICENSE)

Tab is a macOS-first native autocomplete app. It watches recent typing context in memory, suggests short continuations while you write in other apps, and lets you accept a suggestion without leaving the app you are using.

The project is early and contributor-friendly. Good contributions include bug fixes, tests, docs, product polish, privacy guardrail improvements, macOS compatibility reports, and small vertical slices from the issue tracker.

## What Tab Does

- Shows a lightweight Floating Suggestion Overlay while the active macOS app keeps focus.
- Generates routine Automatic Suggestions locally by default.
- Offers explicit cloud-backed Deep Complete for harder writing moments.
- Stores user-controlled Personal Memory without keeping raw typing logs by default.
- Provides web account, billing, device, and memory-management surfaces.

Tab is intentionally privacy-sensitive. Please read the product language in [CONTEXT.md](./CONTEXT.md) before changing behavior around Typing Context, Suggestions, Acceptance, Personal Memory, or telemetry.

## Repository Map

```text
apps/
  api/       Cloudflare Worker + Hono API, auth, D1, billing, memory, suggestions
  desktop/   Electron macOS app, overlay, native loop, permissions, settings
  web/       TanStack Start web app for marketing, account, billing, download
packages/
  billing/             Shared plan and entitlement definitions
  context-policy/      Shared app/context eligibility policy
  contracts/           API request and response schemas
  effect-services/     Typed service helpers for cross-runtime workflows
  memory-policy/       Personal Memory policy rules
  redaction/           Sensitive-data redaction helpers
  suggestion-policy/   Suggestion eligibility and behavior policy
  ui/                  Shared design system, components, and tokens
docs/
  adr/       Architectural decisions
  agents/    Project instructions for issue and domain workflows
```

## Quick Start

You need [Bun](https://bun.sh/) and, for full desktop testing, macOS.

```sh
bun install --frozen-lockfile
cp .dev.vars.example .dev.vars
bun run typecheck
bun run test
```

Common development commands:

```sh
bun run dev                # Run API plus web development servers
bun run web:dev            # Run only the web app
bun run api:dev            # Run only the Cloudflare Worker API
bun run desktop:dev        # Run only the Electron app
bun run desktop:permissions # Build a local macOS app for permission testing
bun run lint               # Current strict TypeScript baseline
bun run worker:types:check # Verify Worker binding types
```

Some provider-backed paths require local secrets in `.dev.vars`. Leave optional values blank when you are working on tests, docs, UI, policies, or code paths that do not call that provider. The combined `bun run dev` script validates non-empty Polar values, so use safe local placeholders for `POLAR_ACCESS_TOKEN` and `POLAR_ORGANIZATION_ID` if you are not testing billing.

## Contributing

Start with [CONTRIBUTING.md](./CONTRIBUTING.md). It covers setup, issue selection, pull requests, validation, database migrations, docs conventions, and privacy expectations.

Useful entry points:

- [Open issues](https://github.com/crafter-station/tab/issues)
- [Product requirements](./docs/PRD.md)
- [Domain glossary](./CONTEXT.md)
- [Architecture decisions](./docs/adr)
- [Design system notes](./docs/design-system.md)
- [Release checklist](./docs/release-checklist.md)

Before opening a PR, run the smallest relevant checks and mention what you ran:

```sh
bun run typecheck
bun run test
```

## Contributors

Thanks to everyone who helps make Tab better.

[![Tab contributors](https://contrib.rocks/image?repo=crafter-station/tab)](https://github.com/crafter-station/tab/graphs/contributors)

## Community

- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [Support](./SUPPORT.md)
- [Security Policy](./SECURITY.md)
- [Contributing Guide](./CONTRIBUTING.md)

## License

Tab is licensed under the [GNU Affero General Public License v3.0](./LICENSE).
