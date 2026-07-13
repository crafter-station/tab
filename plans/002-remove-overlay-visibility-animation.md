# 002 — Remove overlay visibility animation

- **Status**: TODO
- **Commit**: 283aecc
- **Severity**: HIGH
- **Category**: Purpose & frequency
- **Estimated scope**: 2 files, one class recipe and focused render assertions

## Problem

The floating suggestion shell fades for 150ms every time a suggestion appears or is dismissed. This is a high-frequency typing surface that can appear more than 100 times per day, where visibility must be immediate.

```tsx
/* packages/ui/src/components/app/floating-suggestion-bar.tsx:25-31 — current */
const shellClassName =
  "absolute inset-0 flex items-center justify-center px-3 py-2 opacity-0 transition-opacity duration-150 ease-[var(--tab-ease-out)] motion-reduce:duration-0";
const visibleShellClassName = "opacity-100";
const hiddenShellClassName = "opacity-0";

const commandClassName =
  "pointer-events-auto grid min-h-11 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 overflow-hidden rounded-[var(--radius-card)] border border-[var(--tab-overlay-border)] bg-[var(--tab-overlay-bg)] py-2 pr-2 pl-2.5 text-[var(--tab-overlay-text)] shadow-[var(--tab-overlay-shadow)] backdrop-blur-xl transition-transform duration-100 ease-[var(--tab-ease-out)] active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:pointer-events-none disabled:scale-100";
```

The renderer swaps between the inline and floating presentations. The inline presentation is already immediate and must remain unchanged:

```tsx
/* apps/desktop/src/renderer/src/surfaces/OverlaySurface.tsx:54-74 — current */
return (
  <main className="overlay-shell" data-mode={mode}>
    {mode === "suggestion" && suggestion?.presentation === "inline" ? (
      <span
        className="inline-suggestion"
        aria-hidden="true"
        style={suggestion.inlineMetrics ? {
          "--inline-font-size": `${suggestion.inlineMetrics.fontSize}px`,
          "--inline-line-height": `${suggestion.inlineMetrics.lineHeight}px`,
        } as CSSProperties : undefined}
      >
        {suggestion.text}
      </span>
    ) : (
      <FloatingSuggestionBar
        suggestion={mode === "suggestion" ? suggestion : null}
        source={suggestion?.source}
        loading={suggestionLoading}
        onAccept={() => window.tab?.acceptSuggestion()}
      />
    )}
```

The main process intentionally keeps the transparent overlay window available and sends renderer state changes instead of hiding the native window:

```ts
/* apps/desktop/src/main/index.ts:729-748 — current */
overlayWindow.webContents.send("suggestion", {
  ...suggestion,
  source: suggestion.id.startsWith("sg-local-") ? "local" : "cloud",
  presentation: inline ? "inline" : "floating",
  ...(inline ? {
    inlineMetrics: {
      fontSize: Math.max(11, Math.round(snapshot.textSession!.caretBounds!.height * 0.82)),
      lineHeight: Math.max(1, Math.round(snapshot.textSession!.caretBounds!.height)),
    },
  } : {}),
});
if (!overlayWindow.isVisible()) {
  overlayWindow.showInactive();
}
}

function clearSuggestionOverlay(): void {
  unregisterObsidianTabAcceptance();
  if (!overlayRendererReady || !isUsableWebContents(overlayWindow)) return;
  overlayWindow.webContents.send("hide");
}
```

Do not replace the fade with native window show/hide churn.

## Target

Use discrete CSS visibility with no transition:

```tsx
/* packages/ui/src/components/app/floating-suggestion-bar.tsx — target */
const shellClassName =
  "absolute inset-0 flex items-center justify-center px-3 py-2";
const visibleShellClassName = "visible";
const hiddenShellClassName = "invisible";
```

Keep the render expression unchanged:

```tsx
className={cn(shellClassName, suggestion ? visibleShellClassName : hiddenShellClassName, className)}
```

`visibility` must switch immediately. Keep the command's 100ms active press feedback; that feedback is initiated by deliberate pointer acceptance and is not the shell visibility animation.

## Repo conventions to follow

- `FloatingSuggestionBar` is the shared seam used by `OverlaySurface`; fix the shell recipe once rather than adding renderer state or timers.
- Hidden state already uses `aria-hidden={!suggestion}` and disables the command when there is no suggestion. Preserve both behaviors.
- ADR `docs/adr/0030-silent-overlay-failure-for-transient-errors.md` requires transient failures to hide or withhold the overlay silently. An immediate `invisible` state satisfies that decision.
- The production inline suggestion in `apps/desktop/src/renderer/src/surfaces/OverlaySurface.tsx:56-66` has no entrance transition and is the correct exemplar.

## Steps

1. In `packages/ui/src/components/app/floating-suggestion-bar.tsx`, remove `opacity-0`, `transition-opacity`, `duration-150`, `ease-[var(--tab-ease-out)]`, and `motion-reduce:duration-0` from `shellClassName`.
2. Change `visibleShellClassName` to exactly `"visible"` and `hiddenShellClassName` to exactly `"invisible"`.
3. In `tests/ui-patterns.test.tsx`, extend the existing floating-overlay test to assert visible suggestion markup contains `visible` and does not contain `transition-opacity`.
4. Add a focused render with `suggestion={null}` and assert the markup contains `invisible`, `aria-hidden="true"`, and a disabled command.

## Boundaries

- Do NOT edit `apps/desktop/src/main/index.ts`; it currently contains unrelated worktree changes and its persistent transparent-window flow is intentional.
- Do NOT edit `OverlaySurface.tsx` or `overlay.css`.
- Do NOT add any animation to `.inline-suggestion`.
- Do NOT remove the command's active press transform, loading opacity, or 1px loading blur.
- Do NOT add timers, unmount delays, Electron window animations, or dependencies.
- If a step does not match commit `283aecc` plus the current worktree, STOP and report drift instead of improvising.

## Verification

- **Mechanical**: run `bun run typecheck`, `bun test tests/ui-patterns.test.tsx`, and `bun run --cwd apps/desktop build:renderer`. All commands must exit successfully.
- **Source check**: `packages/ui/src/components/app/floating-suggestion-bar.tsx` must have no `transition-opacity` on `shellClassName` and must select exactly one of `visible` or `invisible` from suggestion presence.
- **Feel check**: run the desktop app, type until floating suggestions repeatedly appear and dismiss, and confirm the shell is fully visible or fully hidden on the first painted frame.
- **Feel check**: in DevTools Animations, set playback to 10% and confirm no animation is recorded for floating-shell visibility.
- **Feel check**: trigger an Obsidian inline suggestion and confirm its immediate presentation is unchanged.
- **Feel check**: trigger a transient suggestion failure and confirm no error surface or fade appears in the typing flow.
- **Done when**: every floating suggestion appearance and dismissal is immediate, silent failures remain silent, and inline suggestions are untouched.
