import { describe, expect, it } from "bun:test";
import { describePauseState, describePersonalMemorySource } from "../apps/desktop/src/renderer/src/surfaces/settingsCopy";

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
});
