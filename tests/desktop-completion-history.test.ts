import { describe, expect, it } from "bun:test";
import { createCompletionHistory } from "../apps/desktop/src/main/completion-history.ts";

describe("desktop completion history", () => {
  it("keeps the latest 100 completions in memory and publishes newest first", () => {
    let publishedCount = 0;
    const history = createCompletionHistory((entries) => {
      publishedCount = entries.length;
    });

    for (let index = 0; index < 101; index += 1) {
      history.record({
        input: `input-${index}`,
        output: `output-${index}`,
        latencyMs: index,
        mode: "local",
        model: "test-model",
      });
    }

    expect(publishedCount).toBe(100);
    expect(history.getEntries()).toHaveLength(100);
    expect(history.getEntries()[0]).toMatchObject({ input: "input-100", output: "output-100" });
    expect(history.getEntries().at(-1)).toMatchObject({ input: "input-1", output: "output-1" });
  });
});
