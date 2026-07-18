import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { FloatingSuggestionBar } from "../packages/ui/src/components/app/floating-suggestion-bar.tsx";

describe("desktop renderer setup surfaces", () => {
  it("labels Rewrite previews and renders oversized guidance without Acceptance", () => {
    const rewrite = renderToStaticMarkup(
      <FloatingSuggestionBar
        suggestion={{ id: "rewrite", text: "Improved text" }}
        source="cloud"
        label="Rewrite"
        onAccept={() => {}}
      />,
    );
    const guidance = renderToStaticMarkup(
      <FloatingSuggestionBar
        suggestion={{ id: "guidance", text: "Select up to 2,000 characters" }}
        source="local"
        acceptable={false}
        onAccept={() => {}}
      />,
    );

    expect(rewrite).toContain("Rewrite: </strong>Improved text");
    expect(rewrite).toContain("Accept Rewrite suggestion");
    expect(guidance).toContain("disabled");
    expect(guidance).toContain("Select up to 2,000 characters");
    expect(guidance).not.toContain("Option+Tab");
  });

  it("renders sign-in and onboarding around the shared Tab setup story", () => {
    const signInSource = readFileSync("apps/desktop/src/renderer/src/surfaces/SignInSurface.tsx", "utf8");
    const onboardingSource = readFileSync("apps/desktop/src/renderer/src/surfaces/OnboardingSurface.tsx", "utf8");
    const desktopMainSource = readFileSync("apps/desktop/src/main/index.ts", "utf8");

    expect(signInSource).toInclude("Connect this Mac");
    expect(signInSource).toInclude("Allow access");
    expect(signInSource).toInclude("Turn on two macOS permissions");
    expect(signInSource).toInclude("Try a Suggestion");
    expect(signInSource).toInclude("Continue in browser");
    expect(signInSource).toInclude("Open browser again");
    expect(signInSource).toInclude("pug-dot-grid");
    expect(signInSource).toInclude("<TabMark />");
    expect(onboardingSource).toInclude("Try accepting a Suggestion");
    expect(onboardingSource).toInclude("Ask for a Deep Suggestion");
    expect(onboardingSource).toInclude("DOUBLE_OPTION_WINDOW_MS = 400");
    expect(onboardingSource).toInclude('source="cloud"');
    expect(onboardingSource).toInclude("Download local model");
    expect(onboardingSource).toInclude("onOnboardingOptionTab");
    expect(onboardingSource).toInclude("I turned it on");
    expect(onboardingSource).toInclude("<SuggestionCommand");
    expect(onboardingSource).not.toInclude("Try another");
    expect(desktopMainSource).toInclude('controlWindowManager.isRoute("onboarding")');
    expect(desktopMainSource).toInclude("controlWindowManager.sendOptionTab()");
    expect(desktopMainSource).not.toInclude("onboardingWindowManager");
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

    expect(settingsSource).toInclude("Suggestions used");
    expect(settingsSource).toInclude("Words inserted");
    expect(settingsSource).toInclude("accepted words used today");
    expect(settingsSource).toInclude('title="Deep Suggestions"');
    expect(settingsSource).toInclude('remaining={`${(status.entitlement.deepCompletes.remaining ?? 0).toLocaleString()} left`}');
    expect(settingsSource).toInclude("No daily limit on");
    expect(settingsSource).not.toInclude('label="Words completed"');
    expect(settingsSource).not.toInclude('label="Accepted Words today"');
  });

  it("lets users download and select supported local models", () => {
    const settingsSource = readFileSync("apps/desktop/src/renderer/src/surfaces/SettingsSurface.tsx", "utf8");
    const catalogSource = readFileSync("apps/desktop/src/main/local-model-catalog.ts", "utf8");

    expect(catalogSource).toInclude("Ternary Bonsai 8B");
    expect(settingsSource).toInclude("downloadLocalModel(modelId)");
    expect(settingsSource).toInclude("selectLocalModel(modelId)");
    expect(settingsSource).toInclude("Use model");
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
