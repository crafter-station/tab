import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

describe("desktop renderer setup surfaces", () => {
  it("renders sign-in and onboarding around the shared Tab setup story", () => {
    const signInSource = readFileSync("apps/desktop/src/renderer/src/surfaces/SignInSurface.tsx", "utf8");
    const onboardingSource = readFileSync("apps/desktop/src/renderer/src/surfaces/OnboardingSurface.tsx", "utf8");
    const desktopMainSource = readFileSync("apps/desktop/src/main/index.ts", "utf8");

    expect(signInSource).toInclude("Connect this Mac");
    expect(signInSource).toInclude("Accessibility");
    expect(signInSource).toInclude("Input Monitoring");
    expect(signInSource).toInclude("Try a Suggestion");
    expect(signInSource).toInclude("Continue in browser");
    expect(signInSource).toInclude("Open browser again");
    expect(signInSource).toInclude("pug-dot-grid");
    expect(signInSource).toInclude("<TabMark />");
    expect(onboardingSource).toInclude("Try accepting a Suggestion");
    expect(onboardingSource).toInclude("Ask for a Deep Complete Suggestion");
    expect(onboardingSource).toInclude("DOUBLE_OPTION_WINDOW_MS = 400");
    expect(onboardingSource).toInclude('source="cloud"');
    expect(onboardingSource).toInclude("Download local model");
    expect(onboardingSource).toInclude("onOnboardingOptionTab");
    expect(onboardingSource).toInclude("I turned it on");
    expect(onboardingSource).toInclude("<SuggestionCommand");
    expect(onboardingSource).not.toInclude("Try another");
    expect(desktopMainSource).toInclude("onboardingWindowManager.isFocused()");
    expect(desktopMainSource).toInclude("onboardingWindowManager.sendOptionTab()");
    expect(desktopMainSource).toInclude("if (onboardingWindowManager.isOpen()) return null");
  });

  it("uses plan-neutral paid entitlement copy in settings", () => {
    const settingsSource = readFileSync("apps/desktop/src/renderer/src/surfaces/SettingsSurface.tsx", "utf8");

    expect(settingsSource).toInclude("View plans");
    expect(settingsSource).toInclude("on a paid plan");
    expect(settingsSource).not.toInclude("Upgrade to Pro");
    expect(settingsSource).not.toInclude("and on Pro.");
  });

  it("uses clear activity and allowance language in account settings", () => {
    const settingsSource = readFileSync("apps/desktop/src/renderer/src/surfaces/SettingsSurface.tsx", "utf8");

    expect(settingsSource).toInclude("Automatic Suggestions accepted");
    expect(settingsSource).toInclude("Words inserted");
    expect(settingsSource).toInclude("accepted words used today");
    expect(settingsSource).toInclude("Deep Completes left");
    expect(settingsSource).toInclude("No daily limit on");
    expect(settingsSource).not.toInclude('label="Words completed"');
    expect(settingsSource).not.toInclude('label="Accepted Words today"');
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
