import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

describe("desktop renderer setup surfaces", () => {
  it("renders sign-in and onboarding around the shared Tab setup story", () => {
    const signInSource = readFileSync("apps/desktop/src/renderer/src/surfaces/SignInSurface.tsx", "utf8");
    const onboardingSource = readFileSync("apps/desktop/src/renderer/src/surfaces/OnboardingSurface.tsx", "utf8");

    expect(signInSource).toInclude("Connect this Mac");
    expect(signInSource).toInclude("Accessibility");
    expect(signInSource).toInclude("Input Monitoring");
    expect(signInSource).toInclude("Privacy scope");
    expect(signInSource).toInclude("Practice suggestion");
    expect(signInSource).toInclude("pug-dot-grid");
    expect(signInSource).toInclude("<TabMark />");
    expect(onboardingSource).toInclude("Try Tab before it appears in other apps");
    expect(onboardingSource).toInclude("I enabled Input Monitoring");
    expect(onboardingSource).toInclude("<SuggestionCommand");
  });

  it("keeps sign-in and onboarding setup styles on shared visual tokens instead of glass-era tokens", () => {
    const setupCss = [
      readFileSync("apps/desktop/src/renderer/src/styles/sign-in.css", "utf8"),
      readFileSync("apps/desktop/src/renderer/src/styles/onboarding.css", "utf8"),
    ].join("\n");

    expect(setupCss).not.toContain("tabb-glass");
    expect(setupCss).not.toContain("glass-bg");
    expect(setupCss).not.toContain("glass-border");
    expect(setupCss).not.toContain("glass-shadow");
    expect(setupCss).not.toContain("--text-muted");
    expect(setupCss).not.toContain("--text-subtle");
  });
});
