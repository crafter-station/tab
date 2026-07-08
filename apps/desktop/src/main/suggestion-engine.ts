import type { Suggestion } from "@tabb/contracts";

const FAKE_CONTINUATIONS: Record<string, string> = {
  hello: " world",
  thank: " you",
  please: " let me know",
  best: " regards",
  see: " you soon",
};

const LOCAL_CONFIDENT_CONTINUATIONS: Record<string, string> = {
  thank: " you",
  please: " let me know",
  best: " regards",
  see: " you soon",
};

function lastContextWord(context: string): string | null {
  const trimmed = context.trim();
  if (trimmed.length === 0) return null;

  const words = trimmed.split(/\s+/);
  const lastWord = words.at(-1) ?? "";
  return lastWord.length > 0 ? lastWord.toLowerCase() : null;
}

export function generateLocalSuggestion(context: string): Suggestion | null {
  const lowerLastWord = lastContextWord(context);
  if (!lowerLastWord) return null;

  const text = LOCAL_CONFIDENT_CONTINUATIONS[lowerLastWord];
  if (!text) return null;

  return {
    id: `local-${lowerLastWord}`,
    text,
  };
}

export function generateFakeSuggestion(context: string): Suggestion | null {
  const lowerLastWord = lastContextWord(context);
  if (!lowerLastWord) return null;

  const text = FAKE_CONTINUATIONS[lowerLastWord] ?? " continues…";

  return {
    id: `fake-${lowerLastWord}-${Date.now()}`,
    text,
  };
}
