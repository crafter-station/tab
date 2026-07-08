import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { OnboardingSurface } from "../apps/desktop/src/renderer/src/surfaces/OnboardingSurface.tsx";
import { SignInSurface } from "../apps/desktop/src/renderer/src/surfaces/SignInSurface.tsx";

describe("desktop renderer setup surfaces", () => {
  it("renders sign-in and onboarding around the shared Private Utility Grid setup story", () => {
    const signInMarkup = renderToStaticMarkup(<SignInSurface />);
    const onboardingMarkup = renderToStaticMarkup(<OnboardingSurface />);

    expect(signInMarkup).toInclude("Browser handoff");
    expect(signInMarkup).toInclude("Accessibility");
    expect(signInMarkup).toInclude("Input Monitoring");
    expect(signInMarkup).toInclude("Privacy scope");
    expect(signInMarkup).toInclude("Practice Suggestion");
    expect(signInMarkup).toInclude("pug-dot-grid");
    expect(onboardingMarkup).toInclude("Browser sign-in required");
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
  });
});
