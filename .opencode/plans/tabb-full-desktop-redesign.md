# Plan: Full Maca-Style Desktop Redesign for Tabb

## Goal

Redesign Tabb's whole desktop app so onboarding, settings, overlay, tray-driven surfaces, and macOS window behavior feel cohesive with Maca's desktop design language while preserving Tabb's existing typing suggestion domain behavior.

This is a staged migration, not a single rewrite. The overlay has already moved to React; the next work should bring settings and onboarding into the same renderer/design system without destabilizing the native input tap, auth, permissions, pause state, memory management, or suggestion loop.

## Current State

- The overlay is React-based under `apps/desktop/src/renderer/` and is loaded from `dist/renderer/index.html`.
- Settings and onboarding are still raw HTML/CSS/JS loaded from copied files:
  - `apps/desktop/src/settings.html`
  - `apps/desktop/src/onboarding.html`
- Settings and onboarding already have the important behavior but not the desired visual system.
- `preload.ts` exposes one `window.tabb` API shared by overlay, onboarding, and settings.
- `main.ts` owns the real desktop behavior: overlay positioning, suggestion IPC, auth callback handling, status polling, memory refresh, pause state, macOS permissions, tray actions, and native input tap startup.
- Maca's desktop app uses React + Electron Vite with handcrafted CSS, semantic variables, hidden inset macOS chrome, sidebar navigation, calm dark surfaces, glass cards, and restrained motion. It does not rely on Tailwind or shadcn for the desktop UI.

## Design Direction

Use Maca's desktop structure and polish, adapted to Tabb's product:

- Dark-first semantic theme with Tabb amber as `--signal`.
- Solid ambient window background with elevated/glass content cards.
- Hidden inset macOS titlebar and draggable regions, not default framed Electron windows.
- Sidebar-based settings shell with compact tabs.
- Permission cards with status icons, clear explanations, and explicit System Settings actions.
- Minimal animation: short opacity/transform transitions for page changes and buttons; no animation on high-frequency typing or shortcut flows.
- No Tailwind/shadcn unless a later implementation explicitly decides to introduce a broader component registry workflow.

## Recommended Architecture

Migrate to one React renderer app that can render multiple surfaces based on a route/query value, while keeping separate Electron windows.

Use the existing renderer build output and load the same built `index.html` with route/hash state:

- Overlay window: `renderer/index.html#overlay`
- Settings window: `renderer/index.html#settings`
- Onboarding window: `renderer/index.html#onboarding`

Why this route-based single renderer is preferred:

- Keeps one Vite/electron-vite build instead of introducing multiple HTML entrypoints.
- Lets settings, onboarding, and overlay share tokens/components without duplicating CSS.
- Keeps `main.ts` window managers explicit and low risk.
- Lets the raw HTML files stay as temporary fallback until the React surfaces are verified.

Avoid bundling all behavior into one physical BrowserWindow. The overlay must remain transparent, non-focusable, click-through, and always-on-top; settings/onboarding should be normal focusable app windows.

## Proposed File Structure

Add or reorganize the renderer like this:

```txt
apps/desktop/src/renderer/src/
  main.tsx
  App.tsx
  routes.ts
  styles/
    base.css
    layout.css
    controls.css
    overlay.css
    settings.css
    onboarding.css
  components/
    AppShell.tsx
    Button.tsx
    StatusBadge.tsx
    PermissionCard.tsx
    SectionCard.tsx
    Sidebar.tsx
    EmptyState.tsx
  surfaces/
    OverlaySurface.tsx
    SettingsSurface.tsx
    OnboardingSurface.tsx
  hooks/
    useAccessibilityPermission.ts
    useInitialDesktopState.ts
    useTabbIpcSubscription.ts
```

Keep `FloatingSuggestionBar.tsx` and `DebugContextCard.tsx`, but move them under `surfaces/overlay/` or leave them in `components/` until the structure settles.

## Phase 1: Shared Renderer Foundation

Create the shared design system before rewriting screens.

Implementation tasks:

- Split current `App.css` into shared token CSS and overlay-specific CSS.
- Add Maca-inspired semantic tokens in `styles/base.css`:
  - `--bg`, `--bg-elevated`, `--surface`, `--border`
  - `--text`, `--text-subtle`, `--text-muted`
  - `--signal`, `--signal-dim`, `--signal-tint`, `--on-signal`
  - `--glass-bg`, `--glass-border`, `--glass-shadow`
  - custom easing variables like `--ease-out` and `--ease-in-out`
- Add reusable primitives for buttons, badges, cards, sidebar rows, and permission rows.
- Add a route selector in `App.tsx` that renders `OverlaySurface`, `SettingsSurface`, or `OnboardingSurface` based on `window.location.hash`.
- Ensure overlay mode keeps transparent root and global `pointer-events: none`; settings/onboarding must restore normal background and pointer behavior.

Acceptance checks:

- Overlay still appears and accepts clicks exactly as it does now.
- Settings/onboarding are not migrated yet, but the renderer can route to placeholder settings/onboarding surfaces in dev.
- `bun run typecheck` and `bun run --cwd apps/desktop build` pass.

## Phase 2: React Onboarding

Migrate onboarding first because it is smaller and establishes the permission-card pattern.

Behavior to preserve from `onboarding.html`:

- Initial accessibility status check.
- `openAccessibilitySettings()` returns whether permission is already granted.
- Poll after opening Accessibility settings until permission is granted.
- Step from Accessibility to Input Monitoring.
- Open Input Monitoring settings and reveal app in Finder.
- Show relaunch action after Input Monitoring instructions.
- Call `completeOnboarding()` only after permission steps are complete.

New design:

- Fixed-size calm dark onboarding window with hidden titlebar and drag region.
- Top progress strip or compact step indicator.
- Intro copy focused on trust: Tabb observes recent typing context in memory and does not request Screen Recording or Full Disk Access.
- Two permission cards:
  - Accessibility: required for paste/automation and setup guidance.
  - Input Monitoring: required for typing context and Option+Tab.
- Status language:
  - `Enabled`
  - `Needs access`
  - `Confirm in System Settings`
  - `Relaunch may be required`
- Keep the dev-mode note but move it into a collapsible/help card so it does not dominate the primary flow.

Window changes:

- Update `createOnboardingWindow` to load `RENDERER_PATH#onboarding`.
- Use `titleBarStyle: "hiddenInset"`, `trafficLightPosition`, `backgroundColor` matching `--bg`, and `contextIsolation: true`.
- Keep non-resizable initially unless the React layout needs vertical growth.

Acceptance checks:

- First launch opens React onboarding.
- Accessibility polling stops on unmount/close.
- Completing onboarding closes the window and does not reopen on next launch.
- Relaunch-for-permissions still relaunches through existing `will-quit` behavior.

## Phase 3: React Settings

Migrate settings after onboarding proves the shared renderer route works.

Behavior to preserve from `settings.html`:

- Load initial state via `getInitialState()`.
- Subscribe to `onStatusChanged`, `onMemoriesChanged`, and `onPauseChanged`.
- Sign in and sign out via existing IPC.
- Toggle pause and reflect paused banner/state.
- Check/open Accessibility settings and poll after opening.
- Open Input Monitoring settings, reveal the app, and relaunch.
- Render quick memory list and delete by id.
- Reflect quota plan/usage and connectivity.

Recommended tabs:

- `Overview`: app status, pause/resume, current auth/connectivity/quota, quick start state.
- `Permissions`: Accessibility, Input Monitoring, relaunch help, dev-mode packaging note.
- `Memory`: quick memory list, delete actions, empty state.
- `Account`: auth state, sign in/out, plan/quota details.
- `Advanced`: update checks/download link later if the main process exposes update state; debug typing overlay controls only if needed.

New design:

- Maca-style `dashboard` shell with left sidebar and right main card.
- Sidebar: Tabb wordmark/name, status dot, nav items, bottom account/action cluster.
- Main card: scrollable content with section cards and compact rows.
- Pause state should be visible as a top amber warning card, not a separate raw banner.
- Memory rows should be calm cards with clear destructive delete affordance.
- Quota should use a compact usage bar rather than raw `usage / quota` only.

Window changes:

- Update `createSettingsWindow` to load `RENDERER_PATH#settings`.
- Adopt Maca-like window options:
  - width around `980-1120`, height around `700-760`
  - `minWidth` around `720`, `minHeight` around `520`
  - `titleBarStyle: "hiddenInset"`
  - `trafficLightPosition: { x: 16, y: 16 }`
  - `backgroundColor` matching renderer `--bg`
- Consider hiding instead of closing on window close, like Maca, so tray settings reopen instantly and state is preserved. If implemented, add an explicit quit path guard so app quit still closes cleanly.

Acceptance checks:

- Tray `showSettings` and `showQuickMemory` open settings reliably.
- `app.on("activate")` opens/focuses settings.
- State updates continue arriving while the settings window is open.
- Closing settings does not quit the app.
- Memory deletion refreshes the list.
- Auth callback updates settings without requiring app restart.

## Phase 4: Desktop Cohesion Pass

After onboarding and settings are React-based, remove duplicated raw-window assumptions.

Implementation tasks:

- Remove `settings.html` and `onboarding.html` from the runtime copy step only after React replacements are verified.
- Update `build:copy` so it only copies assets and any still-needed static files.
- Consider replacing `htmlPath` dependencies in window managers with `rendererPath` plus route names.
- Add helper functions such as `getRendererUrl("settings")` / `loadRendererRoute(win, "settings")` to centralize dev/packaged loading.
- Add typed preload cleanup helpers if repeated IPC listeners become a source of duplicated events.

Acceptance checks:

- Packaged build contains one renderer output and no stale settings/onboarding HTML dependency.
- Dev script launches all surfaces from the same renderer path.
- No duplicate IPC events after reopening settings/onboarding.

## Phase 5: Polish and QA

Run this after behavior is stable.

Polish tasks:

- Add `:active { transform: scale(0.97) }` to pressable controls where it does not shift layout.
- Replace any `transition: all` with exact properties.
- Use short enter transitions only for occasional surfaces; avoid animating high-frequency overlay/typing actions beyond the already-small pill appearance.
- Add `@media (prefers-reduced-motion: reduce)` to remove transform-based motion.
- Gate hover-only effects behind `@media (hover: hover) and (pointer: fine)`.
- Verify window first paint does not flash white by matching `backgroundColor` to `--bg`.
- Confirm draggable regions do not overlap buttons; use `-webkit-app-region: no-drag` on controls inside drag areas.

Manual QA matrix:

- First launch onboarding on macOS.
- Accessibility already granted before onboarding opens.
- Accessibility not granted; open settings, grant permission, polling advances.
- Input Monitoring settings open; app reveal works; relaunch works.
- Settings open from tray, dock activate, and after auth callback.
- Pause from tray updates settings; pause from settings updates tray and overlay behavior.
- Sign in/out updates status and memory list.
- Memory deletion succeeds and errors do not break the UI.
- Overlay still does not steal focus and still passes transparent clicks through.
- Multi-display overlay behavior remains correct.

## Implementation Notes

- Keep the public `window.tabb` API stable for the first migration. Add APIs only when a new UI need is real.
- Do not change suggestion loop, acceptance, native input tap, auth client, memory client, or status service as part of visual migration unless a bug is discovered.
- Prefer small React components over a generic UI framework. Tabb only needs a few high-quality desktop primitives.
- Do not introduce backwards compatibility for removed raw HTML windows once the packaged React migration is verified; this is not persisted user data.
- Be careful with listener cleanup. The current preload subscriptions do not return unsubscribe functions, so React components should mount once per surface or the preload should be upgraded to return cleanup functions before components can remount often.

## Risks

- React Strict Mode can double-run effects in development. Current preload listener methods do not expose cleanup, so repeated mounts can duplicate IPC listeners.
- Sharing one renderer root across transparent overlay and normal windows requires strict CSS scoping so settings/onboarding do not inherit overlay `pointer-events: none` or transparent background.
- Changing settings window close behavior from destroy to hide can preserve stale state if IPC subscriptions are not designed carefully.
- Input Monitoring cannot be programmatically verified like Accessibility, so the UI must keep its current honest manual-confirmation language.
- Packaged app path and dev Electron host identity can confuse macOS permission entries; preserve the existing dev-mode explanation.

## Verification Commands

From `/Users/cuevaio/projects/tabbb`:

```sh
bun run typecheck
bun test
bun run desktop:dev
```

From `/Users/cuevaio/projects/tabbb/apps/desktop`:

```sh
bun run build
bun run dev:permissions
```

## Suggested First Implementation Slice

Start with Phase 1 plus a minimal React onboarding route behind the existing onboarding window manager.

That gives the project a shared Maca-style desktop foundation and validates routed renderer loading with a lower-risk surface before rewriting the more stateful settings UI.
