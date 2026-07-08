# Issue 59 Manual Validation Checklist

- [ ] Web surfaces: home, pricing, download, login/signup handoff, dashboard, and `/components` render with shared Private Utility Grid styles.
- [ ] Electron surfaces: sign-in, onboarding, settings, debug card, and Floating Suggestion Overlay import shared styles and preserve native window constraints.
- [ ] Light and dark modes: web and desktop surfaces respect system mode and explicit light/dark theme choices.
- [ ] Responsive widths: web pages work at desktop and mobile widths; desktop renderer remains usable inside current Electron window sizes.
- [ ] Reduced motion: transitions and overlay movement are minimal when `prefers-reduced-motion: reduce` is enabled.
- [ ] Focus traversal: forms, pricing CTAs, dashboard actions, onboarding controls, settings tabs, and overlay controls show visible focus and remain keyboard reachable.
- [ ] Floating Suggestion Overlay Acceptance: Option+Tab Acceptance and click Acceptance still work, and the transparent overlay root remains click-through outside interactive controls.
