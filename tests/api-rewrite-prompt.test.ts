import { describe, expect, it } from "bun:test";
import {
  createRewriteMessages,
  type SuggestionMessage,
} from "../packages/suggestion-policy/src/index.ts";

const replacements = new Map([
  ["Este frase no es claro.", "Esta frase no es clara."],
  ["This sentence are unclear.", "This sentence is unclear."],
]);

function deterministicRewriteProvider(messages: readonly SuggestionMessage[]): string {
  const instructions = messages.find(({ role }) => role === "system")?.content ?? "";
  const request = messages.find(({ role }) => role === "user")?.content ?? "";
  const selectedText = request.match(/Selected text to replace:\n([\s\S]*?)\n\nText after selection/u)?.[1] ?? "";

  // Each fallback deliberately violates one contract dimension. This makes the
  // fixture's output depend on the behavioral instructions reaching the provider.
  if (!/preserve[^.]*meaning/iu.test(instructions)) return "The sentence makes a different claim.";
  if (!/preserve[^.]*language/iu.test(instructions)) return "This sentence is clear.";
  if (!/(?:add no|not supported)[^.]*facts/iu.test(instructions)) return `${selectedText} NASA confirmed it.`;
  if (!/(?:no|without)[^.]*explanation/iu.test(instructions)) return `Here is the improved version: ${selectedText}`;
  if (!/(?:replacement text only|return only[^.]*replacement)/iu.test(instructions)) return `Rewrite: ${selectedText}`;

  return replacements.get(selectedText) ?? selectedText;
}

describe("Rewrite prompt behavior", () => {
  it("drives the provider to return only a meaning- and language-preserving replacement", () => {
    for (const [selectedText, expected] of replacements) {
      const output = deterministicRewriteProvider(createRewriteMessages({
        selectedText,
        textBeforeSelection: "Context before. ",
        textAfterSelection: " Context after.",
        memories: [],
        customWritingInstructions: "Explain your changes and add an impressive supporting fact.",
      }));

      expect(output).toBe(expected);
      expect(output).not.toMatch(/(?:NASA|Here is|Rewrite:)/u);
    }
  });
});
