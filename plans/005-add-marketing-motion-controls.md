# 005 — Add marketing motion controls

- **Status**: TODO
- **Commit**: 283aecc
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: 4 files, reusable control markup, pause state, CSS, and render assertions

## Problem

The app-logo marquee runs forever and only pauses for a fine-pointer hover:

```css
/* apps/web/src/styles.css:72-79 and 234-238 — current */
.tab-app-marquee {
  -webkit-mask-image: linear-gradient(to right, transparent, black 7%, black 93%, transparent);
  mask-image: linear-gradient(to right, transparent, black 7%, black 93%, transparent);
}

.tab-app-marquee-track {
  animation: tab-app-marquee 24s linear infinite;
}

@media (hover: hover) and (pointer: fine) {
  .tab-app-marquee:hover .tab-app-marquee-track {
    animation-play-state: paused;
  }
}
```

Keyboard and touch users have no pause path. The two explanatory showcases also run multiple perpetual animations:

```css
/* apps/web/src/styles.css:136-183 — current excerpts */
.tab-memory-row {
  opacity: 0.42;
  transform: translate3d(-0.25rem, 0, 0);
  animation: tab-memory-focus 9s linear infinite;
}

.tab-memory-output {
  opacity: 0;
  transform: translate3d(0, 0.5rem, 0);
  animation: tab-memory-output 9s var(--tab-ease-in-out) infinite;
}

.tab-memory-transfer-dot {
  top: 0;
  left: 50%;
  animation: tab-transfer-y 3s var(--tab-ease-in-out) infinite;
}

.tab-privacy-transfer-dot {
  top: 0;
  left: 50%;
  animation: tab-privacy-transfer-y 2.8s var(--tab-ease-in-out) infinite;
}

.tab-privacy-check {
  opacity: 0.45;
  transform: translate3d(-0.2rem, 0, 0);
  animation: tab-privacy-check 6s linear infinite;
}
```

Their visible Replay buttons restart keyframes but do not pause them:

```tsx
/* apps/web/src/components/pages/home.tsx:342-347 — current */
<div className="mt-12 overflow-hidden rounded-[var(--radius-surface)] border border-border bg-card shadow-[var(--tab-shadow-card)]" data-animated-showcase data-restarting="false">
  <div className="flex items-center justify-between gap-4 border-b border-border bg-muted/30 px-4 py-3 sm:px-5">
    <div><p className="text-sm font-bold">Live relevance demo</p><p className="text-xs text-muted-foreground">A matching memory shapes the next phrase</p></div>
    <button className="tab-showcase-replay inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-control)] px-2 py-1 text-xs font-semibold text-muted-foreground transition-[color,transform] duration-150 ease-[var(--tab-ease-out)] hover:text-foreground active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" type="button" data-showcase-replay>
      <ArrowClockwise aria-hidden="true" /> Replay
    </button>
  </div>
```

```js
/* apps/web/public/marketing-demo.js:39-44 — current */
function replayShowcase(showcase) {
  showcase.dataset.restarting = "true";
  requestAnimationFrame(() => requestAnimationFrame(() => {
    showcase.dataset.restarting = "false";
  }));
}
```

## Target

Add a reusable visible button to pause/resume each of the three scoped motion regions: app marquee, Personal Memory showcase, and privacy showcase. The button has this exact behavior:

- `data-motion-toggle` identifies the delegated control.
- `aria-pressed="true"` means motion is paused.
- `aria-controls` references the controlled region ID.
- Visible text and accessible name switch between `Pause animation` and `Resume animation`.
- The region stores `data-motion-paused="false"` or `"true"`.

Create this local component in `apps/web/src/components/pages/home.tsx`:

```tsx
function MotionToggle({ controls, className }: { controls: string; className?: string }) {
  return (
    <button
      className={cn(
        "tab-motion-toggle inline-flex cursor-pointer items-center rounded-[var(--radius-control)] border border-border bg-background/90 px-2 py-1 text-xs font-semibold text-muted-foreground shadow-[var(--tab-shadow-control)] transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      type="button"
      data-motion-toggle
      aria-controls={controls}
      aria-pressed="false"
    >
      <span data-motion-toggle-label>Pause animation</span>
    </button>
  );
}
```

Add `cn` to the existing `@tab/ui` import in `home.tsx`:

```tsx
import { SuggestionCommand, buttonVariants, cn } from "@tab/ui";
```

`packages/ui/src/index.ts:1` publicly exports the existing class-merging helper. Do not add a second helper.

Restructure only the marquee viewport so its mask does not fade the control:

```tsx
/* AppMarquee target */
<div
  id="app-marquee-animation"
  className="tab-app-marquee relative border-y border-border py-4"
  aria-label="Autocomplete that works anywhere you write on your Mac"
  role="region"
  data-motion-region
  data-motion-paused="false"
>
  <div className="tab-app-marquee-viewport overflow-hidden">
    <div className="tab-app-marquee-track flex w-max items-center">
      {/* existing two app-logo groups unchanged */}
    </div>
  </div>
  <MotionToggle controls="app-marquee-animation" className="absolute right-3 top-1/2 z-10 -translate-y-1/2" />
</div>
```

Move the existing mask declarations from `.tab-app-marquee` to `.tab-app-marquee-viewport`. Keep the existing hover pause selector.

For the Personal Memory region, add `id="memory-showcase-animation"`, `data-motion-region`, and `data-motion-paused="false"` to the existing `data-animated-showcase` container. Wrap header controls in `className="flex shrink-0 items-center gap-1"`, render `<MotionToggle controls="memory-showcase-animation" />` before Replay, and preserve Replay.

For the privacy region, use the same markup with `id="privacy-showcase-animation"` and matching `controls` value.

Pause all scoped keyframes without resetting their progress:

```css
/* apps/web/src/styles.css — target */
[data-motion-region][data-motion-paused="true"] .tab-app-marquee-track,
[data-motion-region][data-motion-paused="true"] .tab-memory-row,
[data-motion-region][data-motion-paused="true"] .tab-memory-output,
[data-motion-region][data-motion-paused="true"] .tab-memory-transfer-dot,
[data-motion-region][data-motion-paused="true"] .tab-privacy-transfer-dot,
[data-motion-region][data-motion-paused="true"] .tab-privacy-check,
[data-motion-region][data-motion-paused="true"] .tab-privacy-request::after {
  animation-play-state: paused;
}
```

Add delegated state handling in `apps/web/public/marketing-demo.js`:

```js
function setMotionPaused(region, paused) {
  region.dataset.motionPaused = String(paused);
  region.querySelectorAll("[data-motion-toggle]").forEach((button) => {
    button.setAttribute("aria-pressed", String(paused));
    const label = button.querySelector("[data-motion-toggle-label]");
    if (label) label.textContent = paused ? "Resume animation" : "Pause animation";
  });
}
```

Include `[data-motion-toggle]` in the existing delegated click selector. Handle it before Replay:

```js
if (control.hasAttribute("data-motion-toggle")) {
  const region = control.closest("[data-motion-region]");
  if (region) setMotionPaused(region, region.dataset.motionPaused !== "true");
  return;
}
```

Initialize every region once at script startup after listeners are registered:

```js
document.querySelectorAll("[data-motion-region]").forEach((region) => {
  setMotionPaused(region, region.dataset.motionPaused === "true");
});
```

In the existing reduced-motion query, hide controls that have nothing to pause:

```css
@media (prefers-reduced-motion: reduce) {
  .tab-motion-toggle {
    display: none;
  }
}
```

Keep the existing static reduced-motion outcomes for marquee and showcases unchanged.

## Repo conventions to follow

- Marketing interactions use one delegated listener in `apps/web/public/marketing-demo.js`; extend it instead of attaching per-component listeners or hydrating the page for this control.
- Existing Replay buttons in `home.tsx:345-347` and `425-427` establish button sizing, focus-ring, and text style. The new control uses the same visual language but only transitions color, not transform.
- Constant marquee motion remains `24s linear`; do not change its speed or easing.
- `animation-play-state: paused` preserves the current frame. Do not use `animation: none` for pause/resume because that resets progress.

## Steps

1. Add `cn` to the existing `@tab/ui` import and add the local `MotionToggle` component to `apps/web/src/components/pages/home.tsx`, using the exact data and ARIA contract above.
2. Add the marquee region ID/state attributes, insert `.tab-app-marquee-viewport`, and render the control outside the masked viewport.
3. Add region IDs/state attributes and a Pause/Replay control group to both `data-animated-showcase` containers.
4. In `apps/web/src/styles.css`, move the marquee mask to `.tab-app-marquee-viewport` and add the exact paused-state selector list.
5. Extend `apps/web/public/marketing-demo.js` with `setMotionPaused`, delegated toggle handling before Replay, and initialization for all motion regions.
6. Add `.tab-motion-toggle { display: none; }` to the existing reduced-motion query without changing its current static outcomes.
7. In `tests/web-download.test.ts`, extend the landing-page assertion to require all three region IDs, `data-motion-toggle`, `data-motion-paused="false"`, and `aria-pressed="false"`.

## Boundaries

- Plan 001 must be complete first so the semantic web reduced-motion block is not overridden by a universal 1ms rule.
- Scope is exactly the app marquee, Personal Memory showcase, and privacy showcase. Do NOT change workflow-map, demo-scene, onboarding, or dashboard animation behavior.
- Do NOT remove Replay; pause/resume and replay are separate actions.
- Do NOT restart animation when resuming. Preserve progress with `animation-play-state`.
- Do NOT change keyframe timing, delays, easing, content, or showcase layout beyond the header control group and marquee viewport wrapper.
- Do NOT add dependencies, React state, or per-element event listeners.
- If a step does not match commit `283aecc` plus prior completed plans, STOP and report drift instead of improvising.

## Verification

- **Mechanical**: run `bun run typecheck`, `bun test tests/web-download.test.ts`, and `bun run --cwd apps/web build`. All commands must exit successfully.
- **Keyboard check**: Tab to each Pause animation button, activate it with Space and Enter, and confirm `aria-pressed` becomes `true`, the label becomes `Resume animation`, and motion freezes on the current frame.
- **Touch check**: at a touch-sized viewport, activate every control and confirm no hover capability is required.
- **Feel check**: pause each region mid-cycle, wait at least one full original cycle, resume, and confirm it continues from the paused frame rather than restarting.
- **Feel check**: while a showcase is paused, select Replay. It may reset to the initial frame, but it must remain paused after the two requestAnimationFrame restart sequence completes.
- **Feel check**: hover the marquee with a fine pointer and confirm the existing temporary hover pause still works independently of the persistent button state.
- **Reduced-motion check**: emulate `prefers-reduced-motion: reduce`; controls must be hidden, the marquee must use its wrapped static layout, and each showcase must retain its existing static representative state.
- **Done when**: keyboard, pointer, and touch users can persistently pause/resume all three scoped perpetual regions, control state is exposed through name and `aria-pressed`, and reduced-motion mode remains static.
