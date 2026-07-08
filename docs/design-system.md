# Private Utility Grid Design System

Tabb uses the shared `@tab/ui` package as the source of truth for visual tokens, theme behavior, primitives, and app-level patterns. Web and Electron surfaces should consume these tokens instead of defining local brand palettes or legacy glass-era aliases.

## Palette

Use the neutral Private Utility Grid palette from `packages/ui/src/styles/globals.css`: `--background`, `--foreground`, `--card`, `--popover`, `--muted`, `--accent`, `--border`, `--input`, and `--ring`. Keep `--primary` monochrome and reserve semantic color for status or evidence. Do not reintroduce amber brand blocks, one-off hex values, or local duplicate variables when a shared token exists.

## Typography

Use `--font-display` for hero, page, and section headings; `--font-body` for interface and prose; and `--font-code` for shortcuts, commands, debug metadata, and technical identifiers. Desktop must rely on the bundled/shared fallback stack and must not require network font loading at runtime.

## Theme Modes

Light mode, dark mode, and system preference are first-class. Use `applyThemePreference`, `data-theme`, `.dark`, `.pug-theme-light`, or `.pug-theme-dark` at the surface boundary instead of local theme switches. Components must remain readable in both modes without mode-specific copy or behavior changes.

## Spacing

Prefer the established grid rhythm: compact controls at 8-12px gaps, card interiors at 13-18px, surface blocks at 20-28px, and page sections at responsive `clamp` values already used by shared page components. Avoid dense SaaS dashboards and avoid decorative whitespace that breaks Electron window constraints.

## Radius

Use shared radius tokens: `--radius-control` for buttons and inputs, `--radius-media` for compact media/control surfaces, `--radius-card` for cards and rows, and `--radius-surface` for large panes and feature blocks. Use full pills only for chips, badges, and the Floating Suggestion Overlay control.

## Grid And Surface Treatments

Use `--tab-page-wash`, `--tab-grid-bg`, `--tab-dot-grid-bg`, `--tab-grid-line`, `--tab-grid-strong`, and utilities such as `.pug-grid-surface` and `.pug-dot-grid` for grid-backed layouts. Use `--tab-shadow-soft` and constrained `--tab-glass-*` tokens only for shared translucent surfaces such as `SectionCard` and the Floating Suggestion Overlay where blur is part of the native treatment.

## Semantic Statuses

Use `success`, `warning`, `info`, `destructive`, `muted`, and active text labels through shared components such as `StatusRow`, `Badge`, and `StatusChip` patterns. Status meaning must appear in text, not color alone. Warning states should use `--warning` and `--tab-warning-tint`, not amber utility classes.

## Component Usage Rules

Start with primitives from `@tab/ui`: `Button`, `Card`, `Badge`, `Input`, `Label`, `Table`, `Tooltip`, and `Separator`. Build product pages with app patterns such as `SectionBlock`, `SectionCard`, `SurfaceHeader`, `StatusRow`, `SettingsRow`, `SettingsNav`, `CommandBlock`, `EmptyState`, `HeroProofPanel`, and `FloatingSuggestionBar`. Preserve native Electron behavior by keeping drag regions, transparent overlay roots, pointer-event rules, and Acceptance handlers outside visual abstractions.
