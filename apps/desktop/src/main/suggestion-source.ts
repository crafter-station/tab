import type { Suggestion } from "@tab/contracts";
import type { RequestableTypingContextSnapshot } from "./typing-context.ts";

export type SuggestionSource = (
  snapshot: RequestableTypingContextSnapshot,
  options?: { signal?: AbortSignal },
) => Promise<Suggestion | null> | Suggestion | null;
