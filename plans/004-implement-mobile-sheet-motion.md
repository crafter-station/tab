# 004 — Implement mobile sheet motion

- **Status**: TODO
- **Commit**: 283aecc
- **Severity**: MEDIUM
- **Category**: Cohesion & tokens / Physicality
- **Estimated scope**: 2 files, explicit component classes and keyframes

## Problem

The shared `Sheet` references animation utilities normally supplied by an animation plugin:

```tsx
/* packages/ui/src/components/ui/sheet.tsx:18-49 — current */
const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
    ref={ref}
  />
))

const sheetVariants = cva(
  "fixed z-50 gap-4 bg-background p-6 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500 data-[state=open]:animate-in data-[state=closed]:animate-out",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-0 border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-3/4 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
```

`packages/ui/package.json` does not depend on `tailwindcss-animate`, and `tailwind.config.ts:10-25` defines colors only. The classes therefore do not produce the intended overlay fade or directional drawer movement.

The mobile sidebar depends on this component:

```tsx
/* packages/ui/src/components/ui/sidebar.tsx:199-219 — current */
if (isMobile) {
  return (
    <Sheet open={openMobile} onOpenChange={setOpenMobile} {...props}>
      <SheetContent
        data-sidebar="sidebar"
        data-mobile="true"
        className="w-[--sidebar-width] bg-sidebar p-0 text-sidebar-foreground [&>button]:hidden"
        style={
          {
            "--sidebar-width": SIDEBAR_WIDTH_MOBILE,
          } as React.CSSProperties
        }
        side={side}
      >
```

## Target

Implement the motion with explicit shared CSS and no dependency. Add the drawer curve beside existing motion tokens:

```css
/* packages/ui/src/styles/globals.css:102-104 — target */
--tab-ease-out: cubic-bezier(0.23, 1, 0.32, 1);
--tab-ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
--tab-ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
```

Replace unsupported utilities with stable class hooks and a side data attribute:

```tsx
/* packages/ui/src/components/ui/sheet.tsx — target fragments */
"tab-sheet-overlay fixed inset-0 z-50 bg-black/80"

const sheetVariants = cva(
  "tab-sheet-content fixed z-50 gap-4 bg-background p-6 shadow-lg",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b",
        bottom: "inset-x-0 bottom-0 border-t",
        left: "inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm",
        right: "inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm",
      },
```

```tsx
<SheetPrimitive.Content
  ref={ref}
  className={cn(sheetVariants({ side }), className)}
  {...props}
  data-side={side}
>
```

Add these exact keyframes and state rules to `packages/ui/src/styles/globals.css` before the reduced-motion media query:

```css
@keyframes tab-sheet-fade-in {
  from { opacity: 0; }
}

@keyframes tab-sheet-fade-out {
  to { opacity: 0; }
}

@keyframes tab-sheet-in-from-top {
  from { transform: translate3d(0, -100%, 0); }
}

@keyframes tab-sheet-out-to-top {
  to { transform: translate3d(0, -100%, 0); }
}

@keyframes tab-sheet-in-from-bottom {
  from { transform: translate3d(0, 100%, 0); }
}

@keyframes tab-sheet-out-to-bottom {
  to { transform: translate3d(0, 100%, 0); }
}

@keyframes tab-sheet-in-from-left {
  from { transform: translate3d(-100%, 0, 0); }
}

@keyframes tab-sheet-out-to-left {
  to { transform: translate3d(-100%, 0, 0); }
}

@keyframes tab-sheet-in-from-right {
  from { transform: translate3d(100%, 0, 0); }
}

@keyframes tab-sheet-out-to-right {
  to { transform: translate3d(100%, 0, 0); }
}

.tab-sheet-overlay[data-state="open"] {
  animation: tab-sheet-fade-in 200ms var(--tab-ease-out) both;
}

.tab-sheet-overlay[data-state="closed"] {
  animation: tab-sheet-fade-out 160ms var(--tab-ease-out) both;
}

.tab-sheet-content[data-state="open"][data-side="top"] {
  animation: tab-sheet-in-from-top 300ms var(--tab-ease-drawer) both;
}

.tab-sheet-content[data-state="closed"][data-side="top"] {
  animation: tab-sheet-out-to-top 240ms var(--tab-ease-drawer) both;
}

.tab-sheet-content[data-state="open"][data-side="bottom"] {
  animation: tab-sheet-in-from-bottom 300ms var(--tab-ease-drawer) both;
}

.tab-sheet-content[data-state="closed"][data-side="bottom"] {
  animation: tab-sheet-out-to-bottom 240ms var(--tab-ease-drawer) both;
}

.tab-sheet-content[data-state="open"][data-side="left"] {
  animation: tab-sheet-in-from-left 300ms var(--tab-ease-drawer) both;
}

.tab-sheet-content[data-state="closed"][data-side="left"] {
  animation: tab-sheet-out-to-left 240ms var(--tab-ease-drawer) both;
}

.tab-sheet-content[data-state="open"][data-side="right"] {
  animation: tab-sheet-in-from-right 300ms var(--tab-ease-drawer) both;
}

.tab-sheet-content[data-state="closed"][data-side="right"] {
  animation: tab-sheet-out-to-right 240ms var(--tab-ease-drawer) both;
}
```

Extend the selective reduced-motion query established by plan 001 with fade-only content behavior. This keeps Radix content mounted long enough for its close animation while dropping directional movement:

```css
@media (prefers-reduced-motion: reduce) {
  .tab-sheet-content[data-state="open"] {
    animation: tab-sheet-fade-in 160ms var(--tab-ease-out) both;
  }

  .tab-sheet-content[data-state="closed"] {
    animation: tab-sheet-fade-out 160ms var(--tab-ease-out) both;
  }
}
```

The overlay already uses fade-only motion, so its 200ms open and 160ms close behavior can remain in reduced-motion mode.

## Repo conventions to follow

- Motion tokens belong in `packages/ui/src/styles/globals.css:102-103`; add `--tab-ease-drawer` there rather than hand-typing the cubic-bezier into component classes.
- Existing shared popovers use CSS class hooks plus data-state selectors in `packages/ui/src/styles/globals.css:248-318`; follow that placement and naming pattern.
- Enter/exit UI uses the strong ease-out token `cubic-bezier(0.23, 1, 0.32, 1)`. Directional drawer motion uses the audit's iOS-like `cubic-bezier(0.32, 0.72, 0, 1)`.
- Animate only `transform` and `opacity`.

## Steps

1. Add `--tab-ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)` to the shared root token block in `packages/ui/src/styles/globals.css`.
2. In `packages/ui/src/components/ui/sheet.tsx`, replace unsupported animation utilities with `tab-sheet-overlay` and `tab-sheet-content` hooks while preserving all positioning, border, width, background, padding, and shadow classes.
3. Pass `data-side={side}` to `SheetPrimitive.Content` after `{...props}` so caller props cannot override the variant's physical side.
4. Add the exact fade and four-direction keyframes and state rules above to `packages/ui/src/styles/globals.css`.
5. Add the fade-only content overrides to the existing reduced-motion query created by plan 001.
6. Do not change the mobile sidebar consumer; it should receive left/right drawer motion through `SheetContent side={side}`.

## Boundaries

- Plan 001 must be complete first. If the universal 1ms override still exists, STOP and execute plan 001 rather than adding `!important` workarounds.
- Do NOT install `tailwindcss-animate` or any animation package.
- Do NOT edit `tailwind.config.ts` or `packages/ui/package.json`.
- Do NOT animate width, height, left, right, top, bottom, margin, or padding.
- Do NOT add bounce beyond the specified drawer curve.
- Do NOT alter focus trapping, portal behavior, dismissal, close controls, side widths, or mobile breakpoints.
- If a step does not match commit `283aecc` plus prior completed plans, STOP and report drift instead of improvising.

## Verification

- **Mechanical**: run `bun run typecheck`, `bun test tests/ui-patterns.test.tsx`, `bun run --cwd apps/web build`, and `bun run --cwd apps/desktop build:renderer`. All commands must exit successfully.
- **Source check**: `packages/ui/src/components/ui/sheet.tsx` must contain none of `animate-in`, `animate-out`, `fade-in-0`, `fade-out-0`, or `slide-*-to-*`.
- **Feel check**: at a mobile dashboard viewport, open the left sidebar and confirm it starts at `translate3d(-100%, 0, 0)`, reaches rest in 300ms, and the overlay fades in over 200ms.
- **Feel check**: dismiss by overlay click, Escape, close action, and swipe-equivalent pointer flow; content must remain mounted for the 240ms exit and leave toward its configured side.
- **Feel check**: rapidly open/close several times and confirm there is no flash at the resting edge. Because Radix presence uses CSS animation lifecycle, every close must complete before unmount.
- **Feel check**: in DevTools at 10% playback, confirm only transform and opacity animate and the sheet moves from the correct physical edge.
- **Feel check**: emulate `prefers-reduced-motion: reduce`; overlay and content should fade for at most 200ms with no directional translation.
- **Done when**: every `SheetContent` side has real directional open/close motion, mobile sidebar motion works without a plugin, and reduced-motion mode is fade-only.
