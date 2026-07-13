# Animation implementation plans

- **Source commit**: `283aecc`
- **Planning status**: Complete
- **Scope**: Recommended animation-audit findings 1, 2, 3, 5, and 7 only

The plans are ordered by dependency and recommended execution order. Execute one plan at a time, verify it completely, and update its status before starting the next plan.

| Order | Plan | Severity | Status | Depends on |
| --- | --- | --- | --- | --- |
| 1 | [001 — Replace blanket reduced-motion suppression](001-replace-blanket-reduced-motion.md) | HIGH | TODO | None |
| 2 | [002 — Remove overlay visibility animation](002-remove-overlay-visibility-animation.md) | HIGH | TODO | 001 |
| 3 | [003 — Correct dashboard sidebar motion](003-correct-dashboard-sidebar-motion.md) | HIGH | TODO | 001 |
| 4 | [004 — Implement mobile sheet motion](004-implement-mobile-sheet-motion.md) | MEDIUM | TODO | 001, 003 |
| 5 | [005 — Add marketing motion controls](005-add-marketing-motion-controls.md) | MEDIUM | TODO | 001 |

## Execution notes

1. Plan 001 establishes the selective reduced-motion policy all later motion must respect.
2. Plan 002 removes high-frequency floating-overlay motion without changing the persistent Electron window or immediate inline presentation.
3. Plan 003 removes hydrated desktop-sidebar state motion before plan 004 gives the separate mobile sheet its intended drawer behavior.
4. Plan 004 adds explicit shared sheet keyframes and extends plan 001's reduced-motion policy with fade-only sheet behavior.
5. Plan 005 adds persistent controls to the three scoped marketing motion regions and relies on the semantic web reduced-motion block no longer being globally suppressed.

## Scope boundaries

- These plans do not cover the deferred audit findings: static dashboard width animation, native `<details>` exit/origin limitations, discrete marketing keyframe easing, keyboard-restarted demo scenes, switch-thumb easing beyond reduced-motion duration, onboarding remount animation, or overlay loading blur.
- These plans do not add the deferred onboarding, sign-in, settings, or marketing acceptance-state motion opportunities.
- The worktree contained unrelated desktop main-process and native-input changes when these plans were written. Executors must not revert or modify them unless a plan explicitly names a file and change.
