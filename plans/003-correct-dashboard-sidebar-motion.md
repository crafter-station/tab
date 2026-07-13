# 003 — Correct dashboard sidebar motion

- **Status**: TODO
- **Commit**: 283aecc
- **Severity**: HIGH
- **Category**: Purpose & frequency / Performance
- **Estimated scope**: 1 file, five class-recipe removals

## Problem

The hydrated React sidebar handles `Cmd/Ctrl+B` through the same toggle path as pointer input:

```tsx
/* packages/ui/src/components/ui/sidebar.tsx:96-117 — current */
// Helper to toggle the sidebar.
const toggleSidebar = React.useCallback(() => {
  return isMobile
    ? setOpenMobile((open) => !open)
    : setOpen((open) => !open)
}, [isMobile, setOpen, setOpenMobile])

// Adds a keyboard shortcut to toggle the sidebar.
React.useEffect(() => {
  const handleKeyDown = (event: KeyboardEvent) => {
    if (
      event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
      (event.metaKey || event.ctrlKey)
    ) {
      event.preventDefault()
      toggleSidebar()
    }
  }

  window.addEventListener("keydown", handleKeyDown)
  return () => window.removeEventListener("keydown", handleKeyDown)
}, [toggleSidebar])
```

The state change animates layout and positional properties, and the rail uses `transition-all`:

```tsx
/* packages/ui/src/components/ui/sidebar.tsx:232-252 — current */
<div
  className={cn(
    "relative w-[--sidebar-width] bg-transparent transition-[width] duration-200 ease-linear",
    "group-data-[collapsible=offcanvas]:w-0",
    "group-data-[side=right]:rotate-180",
    variant === "floating" || variant === "inset"
      ? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)_+_theme(spacing.4))]"
      : "group-data-[collapsible=icon]:w-[--sidebar-width-icon]"
  )}
/>
<div
  className={cn(
    "fixed inset-y-0 z-10 hidden h-svh w-[--sidebar-width] transition-[left,right,width] duration-200 ease-linear md:flex",
```

```tsx
/* packages/ui/src/components/ui/sidebar.tsx:303-314 — current */
<button
  ref={ref}
  data-sidebar="rail"
  aria-label="Toggle Sidebar"
  tabIndex={-1}
  onClick={toggleSidebar}
  title="Toggle Sidebar"
  className={cn(
    "absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 transition-all ease-linear after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] hover:after:bg-sidebar-border group-data-[side=left]:-right-4 group-data-[side=right]:left-0 sm:flex",
```

Two descendant recipes also animate layout as the sidebar becomes icon-only:

```tsx
/* packages/ui/src/components/ui/sidebar.tsx:450-451 — current */
"flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 outline-none ring-sidebar-ring transition-[margin,opacity] duration-200 ease-linear focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
"group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0",
```

```tsx
/* packages/ui/src/components/ui/sidebar.tsx:522-523 — current */
const sidebarMenuButtonVariants = cva(
  "peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-none ring-sidebar-ring transition-[width,height,padding] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 group-has-[[data-sidebar=menu-action]]/menu-item:pr-8 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground data-[state=open]:hover:bg-sidebar-accent data-[state=open]:hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-2 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0",
```

Animating `width`, `left`, `right`, `margin`, `height`, and `padding` triggers layout/paint and makes a high-frequency keyboard action wait for motion.

## Target

The desktop React sidebar should snap between expanded and icon states for both keyboard and pointer toggles. Delete only the state-transition utilities:

```tsx
/* packages/ui/src/components/ui/sidebar.tsx — target fragments */
"relative w-[--sidebar-width] bg-transparent"

"fixed inset-y-0 z-10 hidden h-svh w-[--sidebar-width] md:flex"

"absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] hover:after:bg-sidebar-border group-data-[side=left]:-right-4 group-data-[side=right]:left-0 sm:flex"

"flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 outline-none ring-sidebar-ring focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0"

"peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-none ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ..."
```

For the final fragment, preserve every class after `transition-[width,height,padding]`; remove that transition utility only. Do not introduce a replacement transition.

The server-rendered static sidebar is a separate implementation and already suppresses keyboard motion:

```ts
/* apps/web/src/render-page.tsx:32-39 — preserve exactly */
function toggle(fromKeyboard) {
  if (fromKeyboard) root.dataset.dashboardSidebarMotion = 'none';
  var next = collapsed() ? 'expanded' : 'collapsed';
  root.dataset.dashboardSidebarState = next;
  try { localStorage.setItem('tab-dashboard-sidebar', next); } catch (_) {}
  sync();
  if (fromKeyboard) requestAnimationFrame(function() { requestAnimationFrame(function() { delete root.dataset.dashboardSidebarMotion; }); });
}
```

Its pointer-triggered 160ms width transition in `apps/web/src/styles.css:7-42` remains out of scope.

## Repo conventions to follow

- The dashboard opts into icon collapse at `apps/web/src/components/pages/dashboard.tsx:305-359` with `<Sidebar collapsible="icon">`; preserve this structure and its tooltips.
- The audit rule for 100+-times/day keyboard actions is no animation. Removing the state transitions is simpler and more reliable than adding keyboard-source state to the shared provider.
- The audit performance rule permits `transform` and `opacity`, but a collapse that changes document width still requires layout. Do not disguise the same width animation behind another utility.
- Keep ordinary hover colors and focus rings; they are feedback, not sidebar state motion.

## Steps

1. In `packages/ui/src/components/ui/sidebar.tsx`, remove `transition-[width] duration-200 ease-linear` from the desktop gap element.
2. Remove `transition-[left,right,width] duration-200 ease-linear` from the fixed desktop panel.
3. Remove `transition-all ease-linear` from `SidebarRail`.
4. Remove `transition-[margin,opacity] duration-200 ease-linear` from `SidebarGroupLabel` so keyboard collapse does not animate its layout or opacity.
5. Remove `transition-[width,height,padding]` from `sidebarMenuButtonVariants` so icon-size changes snap with the shell.
6. Do not alter `toggleSidebar`, the keyboard listener, mobile `Sheet`, dashboard markup, or the static-sidebar scripts/styles.

## Boundaries

- Do NOT edit `apps/web/src/render-page.tsx`; preserve its existing keyboard suppression.
- Do NOT edit `.dashboard-static-sidebar` rules in `apps/web/src/styles.css`.
- Do NOT change sidebar widths, cookies, shortcut keys, collapse state, tooltips, focus behavior, or mobile behavior.
- Do NOT replace the removed classes with `transition-all`, JS timers, keyframes, or animated layout properties.
- Do NOT add dependencies.
- If a step does not match commit `283aecc` plus the current worktree, STOP and report drift instead of improvising.

## Verification

- **Mechanical**: run `bun run typecheck`, `bun test tests/web-account.test.ts`, and `bun run --cwd apps/web build`. All commands must exit successfully.
- **Source check**: in `packages/ui/src/components/ui/sidebar.tsx`, confirm the desktop state path contains no `transition-all`, `transition-[width]`, `transition-[left,right,width]`, `transition-[margin,opacity]`, or `transition-[width,height,padding]`.
- **Feel check**: load a hydrated dashboard at desktop width and toggle with `Cmd+B` on macOS or `Ctrl+B` elsewhere; expanded/icon states must switch on the first frame.
- **Feel check**: click the header trigger and sidebar rail; these transitions must also snap, with hover and focus feedback intact.
- **Feel check**: set DevTools Animations playback to 10% and confirm no sidebar-collapse animation is recorded and no progressive layout reflow occurs.
- **Feel check**: test the server-rendered dashboard before hydration. Pointer toggle may retain its 160ms width transition, while `Cmd/Ctrl+B` must still snap because `data-dashboard-sidebar-motion="none"` is applied.
- **Done when**: the hydrated desktop sidebar never animates collapse/expand, no blanket transition remains on the rail, and the static sidebar's established keyboard behavior is unchanged.
