import { describe, expect, it } from "bun:test";
import { describePauseState } from "../apps/desktop/src/renderer/src/surfaces/SettingsSurface.tsx";

describe("desktop settings renderer", () => {
  it("uses domain-specific pause copy for observation and suggestions", () => {
    expect(describePauseState(true)).toEqual({
      label: "Paused",
      description: "Typing Context observation and Suggestions are disabled.",
      action: "Resume Tabb",
    });

    expect(describePauseState(false)).toEqual({
      label: "Active",
      description: "Typing Context observation and Suggestions are running.",
      action: "Pause Tabb",
    });
  });
});
