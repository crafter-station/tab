# Native Utility Design System

Tab uses the shared `@tab/ui` package as the source of truth for visual tokens, theme behavior, primitives, and app-level patterns. Web and Electron surfaces should consume these tokens instead of defining local brand palettes or legacy glass-era aliases. The visual direction is a quiet native utility: compact, legible, warm-neutral, and deliberately layered without decorative effects.

## Palette

Use the warm-neutral surfaces from `packages/ui/src/styles/globals.css`: `--background`, `--foreground`, `--card`, `--popover`, `--muted`, `--border`, and `--input`. Orange is the shared product accent, split by role so contrast does not depend on one color doing every job: `--primary` and `--primary-hover` are solid control fills with `--primary-foreground`; `--emphasis` is the brighter decorative and focus color; `--emphasis-text` is the accessible small-text color; and `--accent` is the quiet interaction wash used for hover and selected surfaces. Use `--tab-emphasis-tint` for tinted brand treatments. All product colors, translucent blends, scrims, and color-bearing shadows must be declared in the shared token layer before use. Component, page, landing, and overlay code may use semantic variables, `transparent`, and `currentColor`, but must not contain palette literals, raw Tailwind color utilities, local `color-mix()` recipes, or default Tailwind shadows. Platform APIs and email markup that cannot consume CSS variables use the synchronized constants in `packages/ui/src/platform-colors.ts`.

## Typography

Use `--font-display` for hero, page, and section headings; `--font-body` for interface and prose; and `--font-code` for shortcuts, commands, debug metadata, and technical identifiers. Use the shared `Eyebrow` recipe for section kickers and `TabMark` for the compact brand glyph rather than recreating either in app CSS. Desktop keeps a compact 11/12/13/14px interface scale, while web marketing may use larger display sizes. Both runtimes rely on the shared system stack and must not require network font loading.

## Theme Modes

Light mode, dark mode, and system preference are first-class. Use `applyThemePreference`, `data-theme`, `.dark`, `.pug-theme-light`, or `.pug-theme-dark` at the surface boundary instead of local theme switches. Components must remain readable in both modes without mode-specific copy or behavior changes.

## Spacing

Prefer the established grid rhythm: compact controls at 8-12px gaps, card interiors at 13-18px, surface blocks at 20-28px, and page sections at responsive `clamp` values already used by shared page components. Avoid dense SaaS dashboards and avoid decorative whitespace that breaks Electron window constraints.

## Radius

Use shared radius tokens: `--radius-control` for buttons and inputs, `--radius-media` for compact media/control surfaces, `--radius-card` for cards and rows, and `--radius-surface` for large panes and window-level blocks. Use full pills only for true chips and badges. The Floating Suggestion Overlay uses `--radius-card` so it reads as a native command surface rather than a promotional pill.

## Grid And Surface Treatments

Use `--tab-canvas`, `--tab-sidebar`, `--tab-surface-raised`, and `--tab-surface-sunken` to establish hierarchy before adding borders or shadows. Sidebar utilities are aliases of these canonical roles rather than a separate palette, so review surfaces and explicit theme boundaries stay consistent. Use `--tab-hover` and `--tab-active` for interactive states, and the shared control, card, and window shadows only at their corresponding elevation. Large app surfaces remain opaque; reserve blur for the small Floating Suggestion Overlay, which uses the dedicated `--tab-overlay-*` tokens for reliable contrast over third-party applications.

## Motion

Use `--tab-ease-out` for direct feedback and entrances and `--tab-ease-in-out` only for movement between visible positions. Keep interaction feedback at 150ms or less and animate only opacity or transforms. Frequently used surfaces, including the suggestion overlay and settings tab changes, appear immediately; they do not replay decorative entrance motion. Pressable controls use a subtle `scale(0.97)` response and must honor reduced motion.

## Semantic Statuses

Use the shared `SemanticTone` vocabulary: `neutral`, `brand`, `success`, `warning`, `info`, and `destructive`. Apply it through `StatusRow`, `StatusBadge`, and related shared patterns so web and desktop represent equivalent states the same way. Use `brand` for product categories, enabled preferences, and availability; reserve green `success` for verified, connected, granted, completed, or healthy states. Status meaning must appear in text, not color alone. Warning states use `--warning` and `--tab-warning-tint`, not amber utility classes.

## Review Surface

Use `ComponentReviewSurface` when checking or changing the shared design system. It renders the canonical light and dark Native Utility treatments for `Button`, `Card`, `Badge`, `Input`, `Label`, `Table`, `Tooltip`, and `Separator`, plus app-level patterns for status rows, settings navigation, command/debug blocks, and empty states. Keep this surface small and reviewable so contributors can validate token and primitive changes without navigating billing, auth, desktop onboarding, or native suggestion flows.

## Component Usage Rules

Start with primitives from `@tab/ui`: `Button`, `Card`, `Badge`, `Input`, `Label`, `Table`, `Tooltip`, and `Separator`. Build product pages with app patterns such as `SectionBlock`, `SectionCard`, `SurfaceHeader`, `StatusRow`, `SettingsRow`, `SettingsGroup`, `SummaryMetric`, `SettingsNav`, `CommandBlock`, and `EmptyState`. Use `SuggestionCommand` for embedded product examples and `FloatingSuggestionBar` for the native overlay wrapper so the landing demo, onboarding practice, and real overlay share one command surface. Preserve native Electron behavior by keeping drag regions, transparent overlay roots, pointer-event rules, and acceptance handlers outside visual abstractions.
