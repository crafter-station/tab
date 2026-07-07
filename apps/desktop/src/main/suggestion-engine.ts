import type { Suggestion } from "@tabb/contracts";

const FAKE_CONTINUATIONS: Record<string, string> = {
  hello: " world",
  thank: " you",
  please: " let me know",
  best: " regards",
  see: " you soon",
};

export function generateFakeSuggestion(context: string): Suggestion | null {
  const trimmed = context.trim();
  if (trimmed.length === 0) return null;

  const words = trimmed.split(/\s+/);
  const lastWord = words.at(-1) ?? "";
  if (lastWord.length === 0) return null;

  const lowerLastWord = lastWord.toLowerCase();
  const text = FAKE_CONTINUATIONS[lowerLastWord] ?? " continues…";

  return {
    id: `fake-${lowerLastWord}-${Date.now()}`,
    text,
  };
}
