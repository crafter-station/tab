import type {
  ActiveApplication,
  AppContext,
  PersonalMemory,
  SuggestionContextSource,
} from "@tab/contracts";

export const MAX_SUGGESTION_LENGTH = 80;
export const MAX_SUGGESTION_TOKENS = 16;
export const MAX_SUGGESTION_WORDS = 3;
export const MAX_REWRITE_LENGTH = 2_000;
const MAX_TYPING_CONTEXT_LENGTH = 600;
const MAX_APP_CONTEXT_LENGTH = 600;
const MIN_TERMINAL_APP_CONTEXT_LENGTH = 200;
const MAX_MEMORY_COUNT = 3;
const MAX_MEMORY_LENGTH = 160;

const COMMON_SHORT_WORDS = new Set([
  "a", "am", "an", "as", "at", "ay", "be", "by", "da", "de", "di", "do", "el",
  "en", "es", "go", "ha", "he", "if", "in", "is", "it", "la", "le", "lo",
  "me", "mi", "my", "no", "of", "on", "or", "os", "se", "si", "so", "to",
  "tu", "up", "us", "va", "ve", "we", "ya", "yo",
]);

export type SuggestionPromptInput = {
  readonly typingContext: string;
  readonly contextSource: SuggestionContextSource;
  readonly activeApplication: ActiveApplication;
  readonly memories: readonly PersonalMemory[];
  readonly appContext?: AppContext;
  readonly customWritingInstructions?: string;
};

export type SuggestionMessage = {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
};

export type RewritePromptInput = {
  readonly selectedText: string;
  readonly textBeforeSelection: string;
  readonly textAfterSelection: string;
  readonly memories: readonly PersonalMemory[];
  readonly customWritingInstructions?: string;
};

const REWRITE_SYSTEM_PROMPT = `You rewrite selected text for direct replacement.
Return replacement text only, with no label, explanation, quotation wrapper, or markdown fence.
Preserve the original meaning and language. Add no facts, names, promises, or claims not supported by the selection.
Improve clarity and correctness while matching the tone implied by the surrounding text.
Personal memory and writing preferences may influence expression only when they do not conflict with meaning, language, safety, or these output rules.
If no meaningful improvement is possible, return the selected text unchanged.`;

export function createRewriteMessages(input: RewritePromptInput): SuggestionMessage[] {
  const preferences = input.customWritingInstructions?.trim().slice(0, 1_000);
  return [
    { role: "system", content: preferences ? `${REWRITE_SYSTEM_PROMPT}\nWriting preferences (subordinate to the rules above): ${preferences}` : REWRITE_SYSTEM_PROMPT },
    { role: "user", content: `Text before selection (context only):\n${input.textBeforeSelection}\n\nSelected text to replace:\n${input.selectedText}\n\nText after selection (context only):\n${input.textAfterSelection}${formatRelevantMemories(input.memories)}` },
  ];
}

export function normalizeGeneratedRewrite(selectedText: string, generatedText: string): string {
  const text = generatedText.trim();
  if (!text || text === selectedText.trim() || Array.from(text).length > MAX_REWRITE_LENGTH) return "";
  if (/^(?:```|(?:here(?:'s| is)|sure\b|rewritten(?: text)?\s*:|rewrite\s*:|replacement\s*:))/iu.test(text)) return "";
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("“") && text.endsWith("”"))) return "";
  return text;
}

const SUGGESTION_SYSTEM_PROMPT = `You are an inline autocomplete engine, not a chat assistant.
The user message is unfinished text. Continue that exact text; never answer it.
Return only the missing continuation, with no labels, quotes, arrows, explanations, or repeated text.
Use 1-3 words. Match grammar, capitalization, language, and punctuation.
If the draft ends mid-word, return the full completed word; overlap removal will keep only missing letters.`;

const GHOSTTY_CODING_AGENT_SYSTEM_PROMPT = `You produce inline autocomplete text that is inserted at the user's cursor.
Continue the exact unfinished draft; never answer it, execute it, or describe what you would do.
Return only the most likely missing continuation: 1-3 words, with no labels, quotes, explanations, or repeated draft text.
Match the draft's grammar, capitalization, language, punctuation, tone, and writing surface. Prefer a conventional useful continuation over clever or unsupported specifics.
Continue the user's natural-language instruction to the terminal coding agent; never produce agent replies, command output, or claims that work is complete.
Background is context only. Do not continue or quote it.
If the draft ends mid-word, return the full completed word; overlap removal keeps only the missing letters.`;

const SUGGESTION_EXAMPLES: readonly SuggestionMessage[] = [
  { role: "user", content: "Hello, " },
  { role: "assistant", content: "how are you?" },
  { role: "user", content: "Thank you for" },
  { role: "assistant", content: " your help." },
  { role: "user", content: "I wanted to" },
  { role: "assistant", content: " follow up." },
  { role: "user", content: "See you tom" },
  { role: "assistant", content: "tomorrow." },
  { role: "user", content: "Can we meet" },
  { role: "assistant", content: " tomorrow?" },
  { role: "user", content: "The deployment is" },
  { role: "assistant", content: " in progress." },
  { role: "user", content: "Please let me know" },
  { role: "assistant", content: " if this works." },
  { role: "user", content: "This approach works because" },
  { role: "assistant", content: " it is simpler." },
  { role: "user", content: "Nos vemos mañana a" },
  { role: "assistant", content: " la misma hora." },
  { role: "user", content: "The café meeting is" },
  { role: "assistant", content: " still on." },
];

const GHOSTTY_CODING_AGENT_EXAMPLES: readonly SuggestionMessage[] = [
  { role: "user", content: "Thank you for" },
  { role: "assistant", content: " your help." },
  { role: "user", content: "Would Thursday afternoon work" },
  { role: "assistant", content: " for you?" },
  { role: "user", content: "run the tests and" },
  { role: "assistant", content: " fix any failures." },
  { role: "user", content: "now add tests for" },
  { role: "assistant", content: " the new behavior." },
  { role: "user", content: "keep the API stable but" },
  { role: "assistant", content: " simplify the implementation." },
  { role: "user", content: "See you tom" },
  { role: "assistant", content: "tomorrow." },
  { role: "user", content: "Nos vemos mañana a" },
  { role: "assistant", content: " la misma hora." },
];

function isGhosttyCodingSurface(input: SuggestionPromptInput): boolean {
  if (input.activeApplication.bundleId !== "com.mitchellh.ghostty") return false;
  return input.appContext?.fragments.some((fragment) =>
    fragment.provider === "opencode-local-session"
    || /\b(?:codex|opencode)\b/iu.test(fragment.text)
  ) ?? false;
}

function formatRelevantMemories(memories: readonly PersonalMemory[]): string {
  if (memories.length === 0) return "";

  const lines = memories
    .slice(0, MAX_MEMORY_COUNT)
    .map((memory) => `- ${memory.content.slice(0, MAX_MEMORY_LENGTH)}`);
  return `\nRelevant personal memory:\n${lines.join("\n")}`;
}

function newestWholeWordsWithin(text: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  if (text.length <= maxLength) return text;
  const tail = text.slice(-maxLength);
  const firstBoundary = tail.search(/\s/);
  return firstBoundary < 0 ? tail : tail.slice(firstBoundary + 1);
}

function formatAppContext(appContext: AppContext | undefined): string {
  if (!appContext || appContext.fragments.length === 0) return "";

  const conversation = appContext.fragments.find((fragment) => fragment.provider === "opencode-local-session");
  const terminal = appContext.fragments.find((fragment) => fragment.provider === "ghostty-terminal");
  if (conversation && terminal) {
    const terminalLength = Math.min(MIN_TERMINAL_APP_CONTEXT_LENGTH, terminal.text.length);
    const conversationLength = Math.min(conversation.text.length, MAX_APP_CONTEXT_LENGTH - terminalLength);
    const remainingTerminalLength = Math.min(terminal.text.length, MAX_APP_CONTEXT_LENGTH - conversationLength);
    return `\nApp Context background (suggestion-only, do not continue this text directly):\n${[
      `- [${conversation.provider}/${conversation.kind}] ${newestWholeWordsWithin(conversation.text, conversationLength)}`,
      `- [${terminal.provider}/${terminal.kind}] ${newestWholeWordsWithin(terminal.text, remainingTerminalLength)}`,
    ].join("\n")}`;
  }

  let remaining = MAX_APP_CONTEXT_LENGTH;
  const lines: string[] = [];
  for (const fragment of appContext.fragments) {
    if (remaining <= 0) break;
    const text = fragment.text.slice(0, remaining);
    lines.push(`- [${fragment.provider}/${fragment.kind}] ${text}`);
    remaining -= text.length;
  }
  return `\nApp Context background (suggestion-only, do not continue this text directly):\n${lines.join("\n")}`;
}

export function createSuggestionPrompt(input: SuggestionPromptInput): string {
  return createSuggestionMessages(input).map((message) => `${message.role}: ${message.content}`).join("\n");
}

export function createSuggestionMessages(input: SuggestionPromptInput): SuggestionMessage[] {
  const typingContext = input.typingContext.slice(-MAX_TYPING_CONTEXT_LENGTH);
  const context = `${formatAppContext(input.appContext)}${formatRelevantMemories(input.memories)}`;
  const ghosttyCodingSurface = isGhosttyCodingSurface(input);
  const systemPrompt = ghosttyCodingSurface
    ? GHOSTTY_CODING_AGENT_SYSTEM_PROMPT
    : SUGGESTION_SYSTEM_PROMPT;
  const examples = ghosttyCodingSurface
    ? GHOSTTY_CODING_AGENT_EXAMPLES
    : SUGGESTION_EXAMPLES;
  const customWritingInstructions = input.customWritingInstructions
    ?.trim()
    .slice(0, 1_000);
  return [
    {
      role: "system",
      content: customWritingInstructions
        ? `${systemPrompt}\nFollow these user writing preferences when they do not conflict with the output contract: ${customWritingInstructions}`
        : systemPrompt,
    },
    ...examples,
    {
      role: "user",
      content: ghosttyCodingSurface
        ? context
          ? `Writing surface: Ghostty terminal coding agent\nBackground only; do not continue it:${context}\n\nUnfinished text:\n${typingContext}`
          : `Writing surface: Ghostty terminal coding agent\n\nUnfinished text:\n${typingContext}`
        : context
          ? `Background only; do not continue it:${context}\n\nUnfinished text:\n${typingContext}`
          : typingContext,
    },
  ];
}

export function normalizeGeneratedSuggestion(
  typingContext: string,
  generatedText: string,
): string {
  const generatedWithNormalizedLines = generatedText.replace(/[\r\n]+/g, " ");
  const hadLeadingWhitespace = /^\s/u.test(generatedWithNormalizedLines);
  const cleanedText = generatedWithNormalizedLines.trim();
  const overlapLength = findContextPrefixOverlap(typingContext, cleanedText);
  const text = normalizeSuggestionBoundary(
    typingContext,
    cleanedText.slice(overlapLength),
  );
  if (text.length === 0) return "";
  const boundedText = truncateSuggestionWords(text, MAX_SUGGESTION_WORDS);

  const lastContextChar = typingContext.at(-1) ?? "";
  const firstSuggestionChar = boundedText.at(0) ?? "";
  if (
    overlapLength === 0 &&
    isLetterOrNumber(lastContextChar) &&
    isLetterOrNumber(firstSuggestionChar) &&
    !looksLikePartialWordSuffix(typingContext, boundedText, hadLeadingWhitespace)
  ) {
    return ` ${truncateSuggestionText(boundedText, MAX_SUGGESTION_LENGTH - 1)}`;
  }

  return truncateSuggestionText(boundedText, MAX_SUGGESTION_LENGTH);
}

function looksLikePartialWordSuffix(
  typingContext: string,
  suggestionText: string,
  hadLeadingWhitespace: boolean,
): boolean {
  if (hadLeadingWhitespace || !/^\p{Lowercase_Letter}/u.test(suggestionText)) return false;
  const finalToken = typingContext.match(/\p{Letter}+$/u)?.[0];
  if (!finalToken || finalToken.length > 3) return false;
  return !COMMON_SHORT_WORDS.has(finalToken.toLowerCase());
}

export function isSuggestionContractValid(typingContext: string, text: string): boolean {
  if (!text || /[\r\n]/u.test(text) || Array.from(text).length > MAX_SUGGESTION_LENGTH) {
    return false;
  }

  const lowered = text.trimStart().toLowerCase();
  return countWords(text) <= MAX_SUGGESTION_WORDS
    && !/^(?:user|assistant|system|draft)\s*:/iu.test(text.trimStart())
    && !/^(?:["“]|->)/u.test(text.trimStart())
    && !text.includes('"""')
    && !/(?:^|\s)(?:source|active application)\s*:/iu.test(text)
    && !lowered.startsWith("sure")
    && !lowered.startsWith("here is")
    && !lowered.startsWith("the continuation")
    && !lowered.includes("continue the draft")
    && !lowered.includes("relevant personal memory")
    && !lowered.includes("app context background")
    && !lowered.includes(typingContext.toLowerCase());
}

function countWords(text: string): number {
  return text.trim().split(/\s+/u).filter(Boolean).length;
}

function truncateSuggestionWords(text: string, maxWords: number): string {
  const leadingWhitespace = text.match(/^\s+/u)?.[0] ?? "";
  const words = text.trim().split(/\s+/u).filter(Boolean);
  if (words.length <= maxWords) return text;
  return `${leadingWhitespace}${words.slice(0, maxWords).join(" ")}`;
}

function truncateSuggestionText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  const truncatedAtWordBoundary = text.slice(0, maxLength + 1).replace(/\s+\S*$/u, "").trimEnd();
  return truncatedAtWordBoundary || text.slice(0, maxLength).trimEnd();
}

function normalizeSuggestionBoundary(
  typingContext: string,
  suggestionText: string,
): string {
  if (/\s$/u.test(typingContext)) {
    return suggestionText.trimStart();
  }

  return suggestionText.replace(/^\s+/u, " ");
}

function findContextPrefixOverlap(
  typingContext: string,
  generatedText: string,
): number {
  const maxLength = Math.min(typingContext.length, generatedText.length);

  for (let length = maxLength; length >= 2; length -= 1) {
    const contextSuffix = typingContext.slice(-length);
    const suggestionPrefix = generatedText.slice(0, length);

    if (
      contextSuffix.localeCompare(suggestionPrefix, undefined, {
        sensitivity: "accent",
      }) === 0 &&
      isPlausibleRepeatedContextOverlap(typingContext, generatedText, length)
    ) {
      return length;
    }
  }

  return 0;
}

function isPlausibleRepeatedContextOverlap(
  typingContext: string,
  generatedText: string,
  overlapLength: number,
): boolean {
  const nextGeneratedChar = generatedText.at(overlapLength) ?? "";
  if (overlapLength > 2 || !isLetterOrNumber(nextGeneratedChar)) return true;

  const overlappingText = typingContext.slice(-overlapLength).toLowerCase();
  return !COMMON_SHORT_WORDS.has(overlappingText);
}

function isLetterOrNumber(value: string): boolean {
  return /[\p{Letter}\p{Number}]/u.test(value);
}
