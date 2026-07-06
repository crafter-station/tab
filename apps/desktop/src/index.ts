import type { SuggestionRequest } from "@tabb/contracts";

export const desktopAppBoundary = {
  runtime: "electron",
  owns: [
    "macOS permissions guidance",
    "typing context observation",
    "floating suggestion overlay",
    "suggestion acceptance",
  ],
} as const;

export function createDesktopSuggestionRequest(input: SuggestionRequest): SuggestionRequest {
  return input;
}

export { createTypingContextBuffer } from "./typing-context.ts";
export { generateFakeSuggestion } from "./suggestion-engine.ts";
export { createSuggestionLoop } from "./suggestion-loop.ts";
export { acceptAndInsertSuggestion } from "./acceptance.ts";
