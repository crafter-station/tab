import { describe, expect, it } from "bun:test";
import { PersonalMemoryPolicy } from "../apps/api/src/personal-memory-policy.ts";

describe("Personal Memory policy", () => {
  it("does not retain rejected sensitive content in a durable operation plan", () => {
    const policy = new PersonalMemoryPolicy();

    expect(
      policy.planExtractionOperations(
        [{ type: "create", content: "Stripe key sk_live_1234567890abcdef" }],
        () => "planned-memory",
      ),
    ).toEqual([
      {
        type: "create",
        memoryId: "planned-memory",
        content: "",
        eligible: false,
      },
    ]);
  });
});
