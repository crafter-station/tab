import { describe, expect, it } from "bun:test";
import { createCompletionHistory } from "../apps/desktop/src/main/completion-history.ts";

describe("desktop completion history", () => {
  it("publishes only accepted local suggestions", () => {
    const published: number[] = [];
    const history = createCompletionHistory((entries) => {
      published.push(entries.length);
    });

    history.stageLocalSuggestion("suggestion-1", {
      input: "private context",
      output: " accepted words",
      latencyMs: 12,
      model: "test-model",
    });

    expect(history.getEntries()).toEqual([]);
    expect(published).toEqual([]);

    history.acceptLocalSuggestion("suggestion-1");

    expect(history.getEntries()).toHaveLength(1);
    expect(history.getEntries()[0]).toMatchObject({
      id: "suggestion-1",
      input: "private context",
      output: " accepted words",
      mode: "local",
      model: "test-model",
    });
    expect(published).toEqual([1]);
  });

  it("keeps the latest 100 accepted suggestions in memory and publishes newest first", () => {
    let publishedCount = 0;
    const history = createCompletionHistory((entries) => {
      publishedCount = entries.length;
    });

    for (let index = 0; index < 101; index += 1) {
      history.stageLocalSuggestion(`suggestion-${index}`, {
        input: `input-${index}`,
        output: `output-${index}`,
        latencyMs: index,
        model: "test-model",
      });
      history.acceptLocalSuggestion(`suggestion-${index}`);
    }

    expect(publishedCount).toBe(100);
    expect(history.getEntries()).toHaveLength(100);
    expect(history.getEntries()[0]).toMatchObject({ id: "suggestion-100", input: "input-100", output: "output-100" });
    expect(history.getEntries().at(-1)).toMatchObject({ id: "suggestion-1", input: "input-1", output: "output-1" });
  });
});
