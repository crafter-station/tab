import { describe, expect, it } from "bun:test";
import { describePauseState, describePersonalMemorySource } from "../apps/desktop/src/renderer/src/surfaces/settingsCopy";
import { readFileSync } from "node:fs";

describe("desktop settings renderer", () => {
  it("uses plain-language pause copy for suggestions", () => {
    expect(describePauseState(true)).toEqual({
      label: "Paused",
      description: "Tab has stopped Suggestions and recent typing checks.",
      action: "Resume Suggestions",
    });

    expect(describePauseState(false)).toEqual({
      label: "On",
      description: "Tab can suggest as you type.",
      action: "Pause Suggestions",
    });
  });

  it("uses plain-language memory row sources", () => {
    expect(describePersonalMemorySource("user")).toBe("Created by you");
    expect(describePersonalMemorySource("system")).toBe("Learned from accepted writing");
  });

  it("offers user-controlled update download and installation", () => {
    const source = readFileSync(
      "apps/desktop/src/renderer/src/surfaces/SettingsSurface.tsx",
      "utf8",
    );

    expect(source).toInclude('label: "Updates"');
    expect(source).toInclude("Download Update");
    expect(source).toInclude("Restart and Install");
    expect(source).toInclude("A Tab update is available");
    expect(source).toInclude("window.tab.downloadUpdate()");
    expect(source).toInclude("window.tab.installUpdate()");
  });

  it("distinguishes compact Local and Deep Complete history entries", () => {
    const source = readFileSync(
      "apps/desktop/src/renderer/src/surfaces/SettingsSurface.tsx",
      "utf8",
    );

    expect(source).toInclude('className="completion-history__row"');
    expect(source).toInclude('tone={entry.mode === "local" ? "neutral" : "brand"}');
    expect(source).toInclude('{entry.mode === "local" ? "Local" : "Deep Complete"}');
  });
});
