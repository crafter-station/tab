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
