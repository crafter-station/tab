import type { Suggestion } from "@tab/contracts";

const CONFIDENT_CONTINUATIONS: Record<string, string> = {
  thank: " you",
  please: " let me know",
  best: " regards",
  see: " you soon",
};

const FAKE_CONTINUATIONS: Record<string, string> = {
  hello: " world",
  ...CONFIDENT_CONTINUATIONS,
};

function lastContextWord(context: string): string | null {
  const trimmed = context.trim();
  if (trimmed.length === 0) return null;

  const words = trimmed.split(/\s+/);
  const lastWord = words.at(-1) ?? "";
  return lastWord.length > 0 ? lastWord.toLowerCase() : null;
}

export function generateLocalSuggestion(context: string): Suggestion | null {
  const lastWord = lastContextWord(context);
  if (!lastWord) return null;

  const text = CONFIDENT_CONTINUATIONS[lastWord];
  if (!text) return null;

  return {
    id: `local-${lastWord}`,
    text,
  };
}

export function generateFakeSuggestion(context: string): Suggestion | null {
  const lastWord = lastContextWord(context);
  if (!lastWord) return null;

  const text = FAKE_CONTINUATIONS[lastWord] ?? " continues…";

  return {
    id: `fake-${lastWord}-${Date.now()}`,
    text,
  };
}
