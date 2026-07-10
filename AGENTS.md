# Agent Instructions

## Database Migrations

- Use Drizzle schema changes in `apps/api/src/db/schema.ts` as the source of truth.
- Generate migration files with `bun run db:generate`; do not handwrite or hardcode migration SQL files.
- Apply migrations with `bun run db:migrate` when Cloudflare D1 credentials are available.
- For local D1 validation, run `bun run db:migrate:local` after generating migrations.
- For remote D1, set `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_DATABASE_ID`, and `CLOUDFLARE_D1_TOKEN`, then run `bun run db:migrate` or `bun run db:migrate:remote` as appropriate.

## Agent skills

### Issue tracker

GitHub Issues in `crafter-station/tab`; external pull requests are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the standard `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix` labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout using root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.
