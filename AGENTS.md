# Agent Instructions

## Sources Of Truth

- Prefer root scripts and app config over prose. In particular, ignore `CLAUDE.md`'s generic advice not to use Vite: the web app uses Vite/TanStack Start, the desktop renderer uses electron-vite, and the root test script intentionally invokes both Node and Bun.
- `docs/PRD.md` is the product contract, `CONTEXT.md` defines canonical product terms and rejected synonyms, and `docs/adr/` records architectural constraints. Contract tests assert that these stay aligned with code.

## Workspace Boundaries

- The root `index.ts` is a placeholder, not an application entrypoint.
- The API is a Cloudflare Worker configured by root `wrangler.jsonc`: `apps/api/src/worker.ts` is the Worker entrypoint and `apps/api/src/index.ts` composes the Hono app. D1 is local-capable, but the AI and Vectorize bindings are configured as remote.
- The web app's file routes live in `apps/web/src/routes/`; Vite/TanStack Start and the Cloudflare Vite plugin own its development and Worker request paths. Do not edit `apps/web/src/routeTree.gen.ts`.
- The desktop runtime is split across `apps/desktop/src/main/`, `preload/`, and `renderer/`. Its macOS input helper is `apps/desktop/native/macos-input-tap.swift` and is compiled during desktop dev/build.
- Put cross-runtime API schemas in `@tab/contracts` and shared UI in `packages/ui`; `components.json` points shadcn aliases and global CSS there, not into either app.

## Commands

- Match CI installation with `bun install --frozen-lockfile`.
- `bun run dev` loads `.dev.vars` and starts only API plus web. `scripts/env.ts` requires non-empty `POLAR_ACCESS_TOKEN` and `POLAR_ORGANIZATION_ID` even though `.dev.vars.example` groups Polar under optional settings. Start Electron separately with `bun run desktop:dev`.
- Run one app directly with `bun run api:dev`, `bun run web:dev`, or `bun run desktop:dev`. Build web or desktop with `bun run --cwd apps/web build` or `bun run --cwd apps/desktop build`; there is no root build script.
- Reproduce CI in this order: `bun run typecheck`, `bun run worker:types:check`, `bun run lint`, `bun run test`. `lint` currently repeats the TypeScript check, but CI runs both.
- The full suite must use `bun run test`; it runs `node --test tests/*.test.mjs` before `bun test`. For a focused Bun test use `bun test tests/api-suggestion.test.ts`, optionally with `--test-name-pattern "name"`; for a Node test use `node --test tests/prd-contracts.test.mjs`.
- Tests live at root and assume the repository root as the working directory. API/web integration tests construct the apps and in-memory SQLite directly; do not start dev servers for them.
- `bun run desktop:permissions` builds and opens an unsigned macOS app with permission/debug flags. The native desktop loop and permission flow require macOS even though non-macOS builds skip the Swift helper.

## Generated Files And Migrations

- Vite processes `apps/web/src/styles.css`, shared font imports, and `apps/web/public/` assets for web development and builds.
- `worker-configuration.d.ts` is generated from `wrangler.jsonc` and `.dev.vars.example`. After binding or env changes, regenerate with `bunx wrangler types --env-file=.dev.vars.example --include-runtime=false`, then run `bun run worker:types:check`.
- Treat `apps/api/src/db/schema.ts` as the database source of truth. Run `bun run db:generate`; do not handwrite files under `apps/api/drizzle/`.
- Validate generated migrations with `bun run db:migrate:local`. `bun run db:migrate` uses Drizzle's D1 HTTP driver and needs `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_DATABASE_ID`, and `CLOUDFLARE_D1_TOKEN`; `bun run db:migrate:remote` applies the generated files through Wrangler.

## Desktop Releases

- Desktop releases are GitHub Releases on this same public repo (`crafter-station/tab`), tagged `v<version>`. Pre-v1, bump only the patch version in `apps/desktop/package.json`.
- Default path: bump the version, push to `main`, then run `apps/desktop/scripts/build-and-upload.sh` — it builds, signs, notarizes, publishes, and uploads the stable `Tab.dmg` alias. Credentials live in the gitignored `apps/desktop/.env` (`APPLE_API_KEY*` for notarization, `GH_TOKEN` for publishing).
- `bun run dist:mac` alone does not load `apps/desktop/.env` into electron-builder; use `scripts/build-signed.sh` for a signed local build without publishing.
- The `v*` tag created by a local publish fires `.github/workflows/release-desktop.yml`; its guard job sees the existing release and skips. CI-only publishing (push the tag yourself) still works and uses the Actions secrets.
- Full manual verification steps: `docs/release-checklist.md`. The stable download URL is `https://github.com/crafter-station/tab/releases/latest/download/Tab.dmg`.

## Repository Workflow

- Work tracking is GitHub Issues in `crafter-station/tab`; external pull requests are not a triage surface. See `docs/agents/issue-tracker.md`.
- Use `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix` as defined in `docs/agents/triage-labels.md`.
