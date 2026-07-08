import { describe, expect, it } from "bun:test";
import { describePauseState, describePersonalMemorySource } from "../apps/desktop/src/renderer/src/surfaces/settingsCopy";

describe("desktop settings renderer", () => {
  it("uses domain-specific pause copy for observation and suggestions", () => {
    expect(describePauseState(true)).toEqual({
      label: "Paused",
      description: "Typing Context observation and Suggestions are disabled.",
      action: "Resume Tab",
    });

    expect(describePauseState(false)).toEqual({
      label: "Active",
      description: "Typing Context observation and Suggestions are running.",
      action: "Pause Tab",
    });
  });

  it("uses domain language for Personal Memory row sources", () => {
    expect(describePersonalMemorySource("user")).toBe("Saved by you");
    expect(describePersonalMemorySource("system")).toBe("Learned from accepted writing");
  });
});
