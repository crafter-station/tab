import { SuggestionRequestSchema, SuggestionResponseSchema } from "@tabb/contracts";

export const apiAppBoundary = {
  runtime: "cloudflare-worker-hono",
  owns: [
    "device authentication",
    "suggestion generation",
    "Personal Memory APIs",
    "billing and quota enforcement",
  ],
} as const;

export function validateSuggestionPayload(payload: unknown) {
  const request = SuggestionRequestSchema.parse(payload);

  return SuggestionResponseSchema.parse({
    suggestions: request.typingContext.trim().length > 0 ? [] : [],
  });
}
