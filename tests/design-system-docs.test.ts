import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

describe("Private Utility Grid documentation and styling contract", () => {
  it("documents usage rules and final manual validation coverage", () => {
    const docs = readFileSync("docs/design-system.md", "utf8");
    const validation = readFileSync("docs/manual-validation-issue-59.md", "utf8");

    for (const section of [
      "Palette",
      "Typography",
      "Theme Modes",
      "Spacing",
      "Radius",
      "Grid And Surface Treatments",
      "Semantic Statuses",
      "Component Usage Rules",
    ]) {
      expect(docs).toInclude(`## ${section}`);
    }

    for (const coverage of [
      "Web surfaces",
      "Electron surfaces",
      "Light and dark modes",
      "Responsive widths",
      "Reduced motion",
      "Focus traversal",
      "Floating Suggestion Overlay Acceptance",
    ]) {
      expect(validation).toInclude(coverage);
    }
  });

  it("keeps migrated surfaces on canonical shared tokens instead of legacy aliases", () => {
    const desktopCss = [
      readFileSync("apps/desktop/src/renderer/src/styles/base.css", "utf8"),
      readFileSync("apps/desktop/src/renderer/src/styles/layout.css", "utf8"),
      readFileSync("apps/desktop/src/renderer/src/styles/sign-in.css", "utf8"),
      readFileSync("apps/desktop/src/renderer/src/styles/onboarding.css", "utf8"),
    ].join("\n");
    const dashboardSource = readFileSync("apps/web/src/components/web-pages.tsx", "utf8");

    expect(desktopCss).not.toContain("--glass-");
    expect(desktopCss).not.toContain("--tabb-");
    expect(dashboardSource).not.toContain("amber-");
    expect(desktopCss).toInclude("--tab-grid-bg");
    expect(desktopCss).toInclude("--tab-shadow-soft");
  });
});
