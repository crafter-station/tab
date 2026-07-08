import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { OnboardingSurface } from "../apps/desktop/src/renderer/src/surfaces/OnboardingSurface.tsx";
import { SignInSurface } from "../apps/desktop/src/renderer/src/surfaces/SignInSurface.tsx";

describe("desktop renderer setup surfaces", () => {
  it("renders sign-in and onboarding around the shared Private Utility Grid setup story", () => {
    const signInMarkup = renderToStaticMarkup(<SignInSurface />);
    const onboardingMarkup = renderToStaticMarkup(<OnboardingSurface />);
    const combinedMarkup = `${signInMarkup}${onboardingMarkup}`;

    expect(combinedMarkup).toInclude("Browser handoff");
    expect(combinedMarkup).toInclude("Accessibility");
    expect(combinedMarkup).toInclude("Input Monitoring");
    expect(combinedMarkup).toInclude("Privacy scope");
    expect(combinedMarkup).toInclude("Practice Suggestion");
    expect(combinedMarkup).toInclude("pug-dot-grid");
    expect(combinedMarkup).toInclude("Browser sign-in required");
  });
});
