# 001 — Replace blanket reduced-motion suppression

- **Status**: TODO
- **Commit**: 283aecc
- **Severity**: HIGH
- **Category**: Accessibility
- **Estimated scope**: 4 files, small CSS and utility-class changes

## Problem

The shared stylesheet forces every transition and animation to finish in 1ms. The desktop renderer imports that stylesheet and then repeats the same blanket rule. This removes useful opacity, color, focus, and loading feedback instead of selectively removing spatial movement.

```css
/* packages/ui/src/styles/globals.css:339-359 — current */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    transition-duration: 1ms !important;
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
  }

  button:active,
  a:active,
  summary:active {
    scale: 1 !important;
  }

  .tab-disclosure-panel,
  .tab-popover-content,
  .tab-tooltip-content,
  .tab-disclosure-chevron {
    transform: none !important;
  }
}
```

```css
/* apps/desktop/src/renderer/src/styles/base.css:53-60 — current */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    transition-duration: 1ms !important;
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

The blanket rule also converts the shared skeleton's perpetual pulse into a single 1ms flash and animates the switch thumb unless all transitions are globally suppressed:

```tsx
/* packages/ui/src/components/ui/skeleton.tsx:9 — current */
className={cn("animate-pulse rounded-md bg-primary/10", className)}
```

```tsx
/* packages/ui/src/components/ui/switch.tsx:22 — current */
"pointer-events-none block size-4 rounded-full bg-background shadow-sm ring-0 transition-transform duration-150 ease-[var(--tab-ease-out)] data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
```

Reduced motion should remove position and scale movement while preserving short fades, color changes, focus feedback, and comprehensible state changes.

## Target

Replace the universal shared media query with component-specific behavior:

```css
/* packages/ui/src/styles/globals.css — target */
@media (prefers-reduced-motion: reduce) {
  button:active,
  a:active,
  summary:active {
    scale: 1 !important;
  }

  .tab-disclosure-panel,
  .tab-popover-content,
  .tab-tooltip-content {
    transform: none !important;
    transition-property: opacity;
  }

  .tab-disclosure-chevron {
    transition-duration: 0ms;
  }
}
```

This keeps the existing 160ms disclosure and popover fades and 125ms tooltip fade, all using `--tab-ease-out: cubic-bezier(0.23, 1, 0.32, 1)`. The disclosure chevron still reaches its rotated open-state immediately; do not force its transform to `none` and erase that state indication.

Delete the entire reduced-motion media query from `apps/desktop/src/renderer/src/styles/base.css`. Both desktop entry points import `@tab/ui/styles.css` before `base.css`, so the shared policy remains active without duplication.

Make perpetual skeleton motion static under reduced motion:

```tsx
/* packages/ui/src/components/ui/skeleton.tsx — target */
className={cn("animate-pulse rounded-md bg-primary/10 motion-reduce:animate-none motion-reduce:opacity-65", className)}
```

Make the switch thumb reach its state immediately under reduced motion while retaining the track's 150ms background-color feedback:

```tsx
/* packages/ui/src/components/ui/switch.tsx — target */
"pointer-events-none block size-4 rounded-full bg-background shadow-sm ring-0 transition-transform duration-150 ease-[var(--tab-ease-out)] motion-reduce:duration-0 data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
```

Do not add another universal selector or globally disable transitions/animations.

## Repo conventions to follow

- Motion tokens are defined in `packages/ui/src/styles/globals.css:102-103`: `--tab-ease-out: cubic-bezier(0.23, 1, 0.32, 1)` and `--tab-ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)`.
- Shared popovers and tooltips already separate `opacity` and `transform` in `packages/ui/src/styles/globals.css:248-286`; preserve those durations and only narrow the reduced-motion transition property.
- Component-local Tailwind reduced-motion variants are already used in `packages/ui/src/components/app/floating-suggestion-bar.tsx:26`; use the same `motion-reduce:` pattern for skeleton and switch exceptions.
- `apps/web/src/styles.css:476-522` already defines semantic reduced-motion outcomes for the marquee and marketing showcases. Preserve that block exactly in this plan.

## Steps

1. In `packages/ui/src/styles/globals.css`, remove the universal `transition-duration`, `animation-duration`, and `animation-iteration-count` declarations from the reduced-motion query.
2. In that same query, retain the active-press `scale: 1 !important` rule, limit disclosure/popover/tooltip transitions to opacity, and make chevron rotation immediate without removing its open-state transform.
3. Delete the duplicate reduced-motion query from `apps/desktop/src/renderer/src/styles/base.css`; do not replace it with another blanket selector.
4. Add `motion-reduce:animate-none motion-reduce:opacity-65` to the base class in `packages/ui/src/components/ui/skeleton.tsx`.
5. Add `motion-reduce:duration-0` to the switch thumb class in `packages/ui/src/components/ui/switch.tsx`; do not remove the track's color transition.

## Boundaries

- Do NOT edit `apps/web/src/styles.css`; its component-specific reduced-motion outcomes are already correct and must continue to win through ordinary cascade order.
- Do NOT alter animation durations outside `@media (prefers-reduced-motion: reduce)`.
- Do NOT remove focus rings, hover colors, loading opacity, or other non-spatial feedback.
- Do NOT change the production inline suggestion presentation.
- Do NOT add dependencies or Tailwind plugins.
- If a step does not match commit `283aecc` plus the current worktree, STOP and report drift instead of improvising.

## Verification

- **Mechanical**: run `bun run typecheck`, `bun test tests/ui-patterns.test.tsx`, `bun run --cwd apps/web build`, and `bun run --cwd apps/desktop build:renderer`. All commands must exit successfully.
- **Source check**: search `packages/ui/src/styles/globals.css` and `apps/desktop/src/renderer/src/styles/base.css` for `transition-duration: 1ms`, `animation-duration: 1ms`, and `animation-iteration-count: 1`; all searches must return no matches.
- **Feel check**: in Chrome DevTools Rendering, emulate `prefers-reduced-motion: reduce`, then open a dropdown/tooltip and confirm it fades without translating or scaling.
- **Feel check**: press a shared button and confirm it does not scale, but hover, active color, focus ring, and disabled opacity feedback remain visible.
- **Feel check**: toggle a switch and confirm the thumb snaps to its final position while the track color still changes over 150ms.
- **Feel check**: render a skeleton and confirm it remains visibly static at 65% opacity rather than flashing once or pulsing forever.
- **Done when**: reduced-motion mode removes spatial and perpetual movement through component-specific rules while preserving useful opacity, color, focus, and state feedback.
