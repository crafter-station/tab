import { z } from "zod";

const errorCodes = [
  "invalid_request",
  "unauthenticated",
  "revoked_device",
  "quota_exhausted",
  "rate_limited",
  "provider_failure",
] as const;

export const ActiveApplicationSchema = z.object({
  bundleId: z.string().min(1),
  name: z.string().min(1).optional(),
});

export const SuggestionRequestSchema = z.object({
  requestId: z.string().min(1),
  deviceId: z.string().min(1),
  typingContext: z.string().min(1),
  activeApplication: ActiveApplicationSchema,
  memoryEnabled: z.boolean().default(true),
});

export const SuggestionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
});

export const SuggestionResponseSchema = z.object({
  suggestions: z.array(SuggestionSchema).max(1),
});

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.enum(errorCodes),
    message: z.string().min(1),
  }),
});

export type ActiveApplication = z.infer<typeof ActiveApplicationSchema>;
export type SuggestionRequest = z.infer<typeof SuggestionRequestSchema>;
export type Suggestion = z.infer<typeof SuggestionSchema>;
export type SuggestionResponse = z.infer<typeof SuggestionResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
