# Dashboard Design Polish Report

Date: 2026-07-08

Scope: `apps/web/src/routes/dashboard*.tsx`, `apps/web/src/components/web-pages.tsx`, `apps/web/src/render-page.tsx`, `apps/web/src/routes/__root.tsx`, and shared `@tab/ui` primitives used by the dashboard.

Guideline source: Vercel Web Interface Guidelines fetched from `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md`.

## Summary

The dashboard feels vibecoded because it is mostly a generic grid of equal cards, button-looking navigation, and raw table/form surfaces. It uses the project design system tokens, but it does not yet compose them into a purposeful account-control product surface.

The polish direction should preserve the existing Private Utility Grid design system. Do not add random gradients, icons, or generic SaaS chrome. The work should make the dashboard feel more native, quieter, safer, and more deliberate.

## Highest Priority Findings

`apps/web/src/components/web-pages.tsx:473` - dashboard page title is rendered through `SurfaceHeader`, which always emits `h2`; dashboard needs a real page-level `h1`.

`packages/ui/src/components/app/patterns.tsx:78` - `SurfaceHeader` has a fixed `h2`; add a heading-level/as prop or a page-header variant.

`packages/ui/src/components/ui/card.tsx:32` - `CardTitle` renders a `div`, not a heading; card sections lose semantic hierarchy.

`apps/web/src/render-page.tsx:53` - no skip link target for main content.

`apps/web/src/routes/__root.tsx:37` - no skip link target for main content in the router shell.

`apps/web/src/components/web-pages.tsx:455` - dashboard nav lacks `aria-current` on the active section.

`apps/web/src/components/web-pages.tsx:651` - device revoke is an immediate destructive POST; needs confirmation or undo.

`apps/web/src/components/web-pages.tsx:733` - memory delete is an immediate destructive POST; needs confirmation or undo.

`apps/web/src/components/web-pages.tsx:628` - devices table has no caption or `aria-label`.

`apps/web/src/components/web-pages.tsx:705` - memories table has no caption or `aria-label`.

`apps/web/src/components/web-pages.tsx:636` - empty table header for row actions should be labeled, visually hidden if needed.

`apps/web/src/components/web-pages.tsx:711` - empty table header for row actions should be labeled, visually hidden if needed.

`apps/web/src/components/web-pages.tsx:120` - date formatting hardcodes `en-US`; use `Intl.DateTimeFormat` with user locale.

`apps/web/src/components/web-pages.tsx:129` - price formatting hardcodes `$` and `/mo`; use `Intl.NumberFormat`.

`apps/web/src/components/web-pages.tsx:694` - textarea uses `outline-none`; focus replacement exists, but keep this pattern intentional and consistent in shared primitives.

`apps/web/src/components/web-pages.tsx:695` - placeholder does not follow guideline format for example text ending with an ellipsis.

`apps/web/src/components/web-pages.tsx:688` - memory textarea should set `autoComplete="off"` for this non-auth field.

`apps/web/src/components/web-pages.tsx:719` - edit textarea should set `autoComplete="off"` for this non-auth field.

`apps/web/src/render-page.tsx:39` - theme control lacks active state semantics such as `aria-pressed`.

`apps/web/src/routes/__root.tsx:25` - theme control lacks active state semantics such as `aria-pressed`.

`apps/web/src/render-page.tsx:24` - missing `color-scheme` and `theme-color` handling for dark mode chrome.

`apps/web/src/routes/__root.tsx:10` - missing `color-scheme` and `theme-color` handling for dark mode chrome.

## Product Design Issues

`apps/web/src/components/web-pages.tsx:519` - overview repeats navigation cards instead of answering the account owner question: plan, quota, connected Macs, memory status, and next best action.

`apps/web/src/components/web-pages.tsx:455` - tabs use full button styles, so every nav item competes with primary actions. Replace with `SettingsNav`-style segmented navigation or a quiet sidebar on desktop.

`apps/web/src/components/web-pages.tsx:571` - usage page hides the most important affordance, quota progress. Add a progress meter, reset date, plan badge, and one primary billing action.

`apps/web/src/components/web-pages.tsx:613` - devices page is table-first. Add a short trust-oriented summary: connected count, active/revoked count, and why removal matters.

`apps/web/src/components/web-pages.tsx:666` - memories page combines education, create, edit, and delete in one dense table. Split create/edit/delete into calmer card rows with clearer authorship and danger treatment.

`apps/web/src/components/web-pages.tsx:686` - add-memory form looks like a utility block, not a primary creation surface. Use a card with helper text, counter, and save state.

`packages/ui/src/components/app/patterns.tsx:99` - `StatusRow` is useful, but dashboard overuses it for all content. Add purpose-built metric/progress/action patterns so pages do not become rows of badges.

## Recommended Work Plan

1. Fix semantics and safety first: `h1`, skip link, `aria-current`, labeled table action headers, table labels, destructive confirmations, locale-safe date/price formatting.

2. Redesign the dashboard overview as an account command center: one page header, four compact metrics, quota progress, connected device count, memory count, account/email status, and one contextual next action.

3. Replace button-like dashboard tabs with quiet navigation: segmented nav on mobile and possibly a two-column dashboard layout on desktop.

4. Polish each section around its job: usage gets progress and billing actions, devices gets revocation safety, memories gets calmer editable memory cards, account gets status plus sign-out separated as a secondary risk action.

5. Improve responsive behavior: convert devices and memories tables to stacked cards below `sm`, add `break-words` or truncation for long device IDs and memory text, and keep action buttons from forcing horizontal scroll.

6. Tighten visual hierarchy: reduce equal-weight cards, use one primary surface per route, add tabular numbers for quota/counts, balance headings, and reserve strong buttons for actual actions.

7. Validate both themes: review `/components`, dashboard overview, usage, devices, and memories in light, dark, desktop, and mobile widths.

## Acceptance Checklist

- Dashboard has one visible `h1` and a logical heading order.
- Keyboard users can skip to main content and see focus on nav, theme controls, form fields, and actions.
- Active dashboard section is exposed with `aria-current="page"`.
- Destructive device and memory actions require confirmation or provide undo.
- Tables have labels/captions and action columns are named.
- Dates, prices, and counts use locale-aware formatting.
- Overview shows account state at a glance instead of only links to subpages.
- Usage includes a visible quota progress treatment and reset date.
- Memories and devices handle long content on mobile without horizontal overflow.
- Theme control shows selected state and works in both shells.
- Dark mode sets browser chrome color correctly.

## Validation Notes

No runtime screenshot was captured because the real dashboard is served with authenticated API data. The report is based on implementation review plus the current Web Interface Guidelines and the repository design-system document.

Before merging implementation work, run `bun run --cwd apps/web build`, `bun run typecheck`, and a manual authenticated visual pass across `/dashboard`, `/dashboard/usage`, `/dashboard/devices`, and `/dashboard/memories`.
