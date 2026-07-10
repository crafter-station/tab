# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`.
- **Read an issue**: `gh issue view <number> --comments`, including labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments` with appropriate filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`.
- **Apply or remove labels**: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- **Close an issue**: `gh issue close <number> --comment "..."`.

Infer the repository from `git remote -v`; `gh` does this automatically inside the clone.

## Pull requests as a triage surface

**PRs as a request surface: no.** External pull requests do not enter the issue triage queue.

GitHub shares one number space across issues and pull requests. Resolve an ambiguous number with `gh pr view <number>` and fall back to `gh issue view <number>`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

The `/wayfinder` skill represents a map as one issue and its tickets as child issues.

- **Map**: Create one issue labelled `wayfinder:map` containing Destination, Notes, Decisions so far, Not yet specified, and Out of scope.
- **Child ticket**: Link an issue to the map as a GitHub sub-issue using the sub-issues API. If sub-issues are unavailable, add the child to a task list in the map and put `Part of #<map>` at the top of the child body. Label it `wayfinder:<type>`, where type is `research`, `prototype`, `grilling`, or `task`.
- **Blocking**: Use GitHub's native issue dependencies. Add an edge with `gh api --method POST repos/crafter-station/tab/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where the blocker database ID comes from `gh api repos/crafter-station/tab/issues/<number> --jq .id`. If dependencies are unavailable, put `Blocked by: #<number>` at the top of the child body.
- **Frontier query**: List the map's open children, then exclude tickets with open blockers or an assignee. The first remaining child in map order is the frontier ticket.
- **Claim**: Run `gh issue edit <number> --add-assignee @me` before doing any ticket work.
- **Resolve**: Post the answer as a resolution comment, close the ticket, and append a linked one-line gist to the map's Decisions so far.
