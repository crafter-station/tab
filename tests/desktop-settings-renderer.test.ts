import { describe, expect, it } from "bun:test";
import { describePauseState, describePersonalMemorySource } from "../apps/desktop/src/renderer/src/surfaces/settingsCopy";

describe("desktop settings renderer", () => {
  it("uses plain-language pause copy for suggestions", () => {
    expect(describePauseState(true)).toEqual({
      label: "Paused",
      description: "Suggestions and recent typing checks are paused.",
      action: "Resume Tab",
    });

    expect(describePauseState(false)).toEqual({
      label: "Active",
      description: "Suggestions and recent typing checks are running.",
      action: "Pause Tab",
    });
  });

  it("uses plain-language memory row sources", () => {
    expect(describePersonalMemorySource("user")).toBe("Saved by you");
    expect(describePersonalMemorySource("system")).toBe("Saved from accepted writing");
  });
});
