# Domain Docs

Tab uses a single domain context shared across the monorepo.

## Before exploring

- Read `CONTEXT.md` at the repository root.
- Read relevant decisions under `docs/adr/` before working in an affected area.
- If either location is absent, proceed silently. The `/domain-modeling` skill creates domain documentation lazily when decisions or terms are resolved.

## Use the glossary's vocabulary

When output names a domain concept in an issue title, proposal, hypothesis, or test, use the term defined in `CONTEXT.md`. Do not substitute synonyms the glossary explicitly avoids.

If a needed concept is absent, reconsider whether the new language is necessary or note the gap for `/domain-modeling`.

## Flag ADR conflicts

If proposed work contradicts an existing ADR, surface that conflict explicitly instead of silently overriding the recorded decision.
