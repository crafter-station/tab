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

export const SuggestionContextSourceSchema = z.enum([
  "typed_text",
  "pasted_text",
  "terminal_input",
]);

export const RedactionSummarySchema = z.object({
  applied: z.boolean(),
  redactionCount: z.number().int().nonnegative(),
  kinds: z.array(z.string().min(1)),
});

export const ClientMetadataSchema = z.object({
  appVersion: z.string().min(1).optional(),
  platform: z.string().min(1).optional(),
});

export const DeviceTokenExchangeRequestSchema = z.object({
  code: z.string().min(1),
  deviceId: z.string().min(1),
  platform: z.string().min(1),
  appVersion: z.string().min(1),
});

export const DeviceTokenExchangeResponseSchema = z.object({
  token: z.string().min(1),
});

export const DeviceAuthorizeResponseSchema = z.object({
  code: z.string().min(1),
});

export const DeviceMetadataSchema = z.object({
  platform: z.string().min(1),
  appVersion: z.string().min(1),
  createdAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  revoked: z.boolean(),
});

export const SuggestionRequestSchema = z.object({
  requestId: z.string().min(1),
  deviceId: z.string().min(1),
  typingContext: z.string().min(1),
  contextSource: SuggestionContextSourceSchema,
  redaction: RedactionSummarySchema,
  activeApplication: ActiveApplicationSchema,
  memoryEnabled: z.boolean().default(true),
  contextHash: z.string().min(1).optional(),
  clientMetadata: ClientMetadataSchema.optional(),
});

export const SuggestionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
});

export const SuggestionResponseSchema = z.object({
  suggestions: z.array(SuggestionSchema).max(1),
});

export const ApiSuccessResponseSchema = z.object({
  status: z.literal("ok"),
  data: SuggestionResponseSchema,
});

export const ApiErrorResponseSchema = z.object({
  status: z.literal("error"),
  error: z.object({
    code: z.enum(errorCodes),
    message: z.string().min(1),
  }),
});

export const ApiResponseSchema = z.discriminatedUnion("status", [
  ApiSuccessResponseSchema,
  ApiErrorResponseSchema,
]);

export type ActiveApplication = z.infer<typeof ActiveApplicationSchema>;
export type SuggestionContextSource = z.infer<
  typeof SuggestionContextSourceSchema
>;
export type RedactionSummary = z.infer<typeof RedactionSummarySchema>;
export type ClientMetadata = z.infer<typeof ClientMetadataSchema>;
export type SuggestionRequest = z.infer<typeof SuggestionRequestSchema>;
export type Suggestion = z.infer<typeof SuggestionSchema>;
export type SuggestionResponse = z.infer<typeof SuggestionResponseSchema>;
export type ApiSuccessResponse = z.infer<typeof ApiSuccessResponseSchema>;
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
export type ApiResponse = z.infer<typeof ApiResponseSchema>;
export type DeviceTokenExchangeRequest = z.infer<
  typeof DeviceTokenExchangeRequestSchema
>;
export type DeviceTokenExchangeResponse = z.infer<
  typeof DeviceTokenExchangeResponseSchema
>;
export type DeviceAuthorizeResponse = z.infer<
  typeof DeviceAuthorizeResponseSchema
>;
export type DeviceMetadata = z.infer<typeof DeviceMetadataSchema>;
