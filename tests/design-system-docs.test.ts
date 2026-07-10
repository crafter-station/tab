import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const designSystemSections = [
  "Palette",
  "Typography",
  "Theme Modes",
  "Spacing",
  "Radius",
  "Grid And Surface Treatments",
  "Semantic Statuses",
  "Review Surface",
  "Component Usage Rules",
] as const;

const manualValidationCoverage = [
  "Web surfaces",
  "Electron surfaces",
  "Light and dark modes",
  "Responsive widths",
  "Reduced motion",
  "Focus traversal",
  "Floating Suggestion Overlay Acceptance",
] as const;

const documentedPrimitives = ["Button", "Card", "Badge", "Input", "Label", "Table", "Tooltip", "Separator"] as const;

const migratedDesktopStylePaths = [
  "apps/desktop/src/renderer/src/styles/base.css",
  "apps/desktop/src/renderer/src/styles/layout.css",
  "apps/desktop/src/renderer/src/styles/sign-in.css",
  "apps/desktop/src/renderer/src/styles/onboarding.css",
] as const;

describe("Private Utility Grid documentation and styling contract", () => {
  it("documents usage rules and final manual validation coverage", () => {
    const docs = readFileSync("docs/design-system.md", "utf8");
    const validation = readFileSync("docs/manual-validation-issue-59.md", "utf8");

    for (const section of designSystemSections) {
      expect(docs).toInclude(`## ${section}`);
    }

    for (const coverage of manualValidationCoverage) {
      expect(validation).toInclude(coverage);
    }

    expect(docs).toInclude("ComponentReviewSurface");
    for (const primitive of documentedPrimitives) {
      expect(docs).toInclude(primitive);
    }
  });

  it("keeps migrated surfaces on canonical shared tokens instead of legacy aliases", () => {
    const desktopCss = migratedDesktopStylePaths.map((path) => readFileSync(path, "utf8")).join("\n");
    const dashboardSource = readFileSync("apps/web/src/components/pages/dashboard.tsx", "utf8");

    expect(desktopCss).not.toContain("--glass-");
    expect(desktopCss).not.toContain("--tabb-");
    expect(desktopCss).not.toContain("--text-muted");
    expect(desktopCss).not.toContain("--text-subtle");
    expect(dashboardSource).not.toContain("amber-");
    expect(desktopCss).toInclude("--tab-grid-bg");
    expect(desktopCss).toInclude("--tab-shadow-soft");
  });
});
