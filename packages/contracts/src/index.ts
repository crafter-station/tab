import { MEMORY_EXTRACTION_WINDOW_POLICY, SUGGESTION_CONTEXT_SOURCES } from "@tab/memory-policy";
import { z } from "zod";

const errorCodes = [
  "invalid_request",
  "unauthenticated",
  "email_unverified",
  "revoked_device",
  "billing_required",
  "plan_change_required",
  "quota_exhausted",
  "rate_limited",
  "provider_failure",
] as const;

export const ActiveApplicationSchema = z.object({
  bundleId: z.string().min(1),
  name: z.string().min(1).optional(),
  windowId: z.string().min(1).optional(),
});

export const SuggestionContextSourceSchema = z.enum(SUGGESTION_CONTEXT_SOURCES);

export const RedactionSummarySchema = z.object({
  applied: z.boolean(),
  redactionCount: z.number().int().nonnegative(),
  kinds: z.array(z.string().min(1)),
});

export const ClientMetadataSchema = z.object({
  appVersion: z.string().min(1).optional(),
  platform: z.string().min(1).optional(),
});

export const AppContextFragmentSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  kind: z.string().min(1),
  text: z.string().min(1).max(2_000),
  confidence: z.number().min(0).max(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
  redaction: RedactionSummarySchema,
  requestable: z.literal(true),
  memoryEligible: z.literal(false).default(false),
});

export const AppContextMetadataSchema = z.object({
  provider: z.string().min(1).optional(),
  status: z.enum(["available", "empty", "suppressed", "cleared", "unsupported"]),
  confidence: z.number().min(0).max(1).optional(),
  suppressionReason: z.string().min(1).optional(),
});

export const AppContextSchema = z.object({
  fragments: z.array(AppContextFragmentSchema).max(5).default([]),
  metadata: AppContextMetadataSchema,
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

export const PersonalMemoryCreatedBySchema = z.enum(["user", "system"]);

export const PersonalMemorySchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  content: z.string().min(1),
  createdBy: PersonalMemoryCreatedBySchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const MemoryListResponseSchema = z.object({
  status: z.literal("ok"),
  data: z.object({
    memories: z.array(PersonalMemorySchema),
  }),
});

export const MemoryWriteRequestSchema = z
  .object({
    content: z.string().trim().min(1).max(500),
  })
  .strict();

export const MemoryWriteResponseSchema = z.object({
  status: z.literal("ok"),
  data: z.object({
    memory: PersonalMemorySchema,
  }),
});

export const MemoryDeleteResponseSchema = z.object({
  status: z.literal("ok"),
  data: z.object({
    deleted: z.boolean(),
  }),
});

export const MemoryExtractionWindowEntrySchema = z
  .object({
    id: z.string().min(1),
    text: z.string().trim().min(1).max(MEMORY_EXTRACTION_WINDOW_POLICY.maxEntryTextBytes),
    timestamp: z.string().datetime(),
    activeApplication: ActiveApplicationSchema,
    contextSource: SuggestionContextSourceSchema,
    redaction: RedactionSummarySchema,
  })
  .strict();

export const MemoryExtractionRequestSchema = z
  .object({
    batchId: z.string().min(1).max(200),
    entries: z.array(MemoryExtractionWindowEntrySchema).min(1).max(MEMORY_EXTRACTION_WINDOW_POLICY.maxRequestEntries),
    clientMetadata: ClientMetadataSchema.optional(),
  })
  .strict()
  .refine(
    (request) =>
      request.entries.reduce((total, entry) => total + entry.text.length, 0) <=
      MEMORY_EXTRACTION_WINDOW_POLICY.maxTotalTextBytes,
    "Extraction window text must be at most 8 KB.",
  );

export const MemoryExtractionCountsSchema = z.object({
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  deleted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
});

export const MemoryExtractionResponseSchema = z.object({
  status: z.literal("ok"),
  data: z.object({
    counts: MemoryExtractionCountsSchema,
  }),
});

export const DeviceListItemSchema = DeviceMetadataSchema.extend({
  id: z.string().min(1),
  deviceId: z.string().min(1),
});

export const DeviceListResponseSchema = z.object({
  status: z.literal("ok"),
  data: z.object({
    devices: z.array(DeviceListItemSchema),
  }),
});

export const BillingQuotaResponseSchema = z.object({
  status: z.literal("ok"),
  data: z.object({
    planId: z.string().min(1),
    quota: z.number().int().nonnegative(),
    usage: z.number().int().nonnegative(),
    resetAt: z.string().datetime(),
    upgradeUrl: z.string().min(1).optional(),
  }),
});

export const BillingCheckoutResponseSchema = z.object({
  status: z.literal("ok"),
  data: z.object({
    url: z.string().min(1),
  }),
});

export const BillingPortalResponseSchema = z.object({
  status: z.literal("ok"),
  data: z.object({
    url: z.string().min(1),
  }),
});

export const DesktopReleaseFeedSchema = z.object({
  version: z.string().min(1),
  url: z.string().url(),
  notes: z.string().optional(),
});

export const DesktopReleaseFeedResponseSchema = z.object({
  status: z.literal("ok"),
  data: DesktopReleaseFeedSchema,
});

export const DesktopStatusSchema = z.object({
  authenticated: z.boolean(),
  deviceRevoked: z.boolean(),
  userId: z.string().min(1).optional(),
  planId: z.string().min(1).optional(),
  quota: z.number().int().nonnegative().optional(),
  usage: z.number().int().nonnegative().optional(),
  resetAt: z.string().datetime().optional(),
  localSuggestionActivity: z.object({
    accepted: z.number().int().nonnegative(),
    averageAcceptanceLatencyMs: z.number().int().nonnegative().nullable(),
  }).optional(),
});

export const DesktopStatusResponseSchema = z.object({
  status: z.literal("ok"),
  data: DesktopStatusSchema,
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
  appContext: AppContextSchema.optional(),
  clientMetadata: ClientMetadataSchema.optional(),
});

export const MemoryJobSchema = z.object({
  requestId: z.string().min(1),
  userId: z.string().min(1),
  typingContext: z.string().min(1),
  contextSource: SuggestionContextSourceSchema,
  activeApplication: ActiveApplicationSchema,
  memoryEligible: z.boolean(),
  redaction: RedactionSummarySchema,
  clientMetadata: ClientMetadataSchema.optional(),
});

export const TelemetryEventTypeSchema = z.enum([
  "suggestion_shown",
  "suggestion_accepted",
  "suggestion_dismissed",
  "suggestion_stale",
  "suggestion_error",
  "memory_job_enqueued",
  "memory_extraction_attempted",
  "memory_extraction_succeeded",
  "memory_extraction_failed",
]);

export const TelemetryEventSchema = z.object({
  id: z.string().min(1),
  requestId: z.string().min(1),
  userId: z.string().min(1),
  deviceId: z.string().min(1).optional(),
  eventType: TelemetryEventTypeSchema,
  timestamp: z.string().datetime(),
  activeApplicationBundleId: z.string().min(1).optional(),
  contextSource: SuggestionContextSourceSchema.optional(),
  suggestionLength: z.number().int().nonnegative().optional(),
  planId: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
  latencyMs: z.number().int().nonnegative().optional(),
  errorCode: z.enum(errorCodes).optional(),
  memoryEligible: z.boolean().optional(),
  redactionApplied: z.boolean().optional(),
  redactionCount: z.number().int().nonnegative().optional(),
  clientAppVersion: z.string().min(1).optional(),
  clientPlatform: z.string().min(1).optional(),
  memoryCreatedCount: z.number().int().nonnegative().optional(),
  memoryUpdatedCount: z.number().int().nonnegative().optional(),
  memoryDeletedCount: z.number().int().nonnegative().optional(),
  memoryRejectedCount: z.number().int().nonnegative().optional(),
});

export const RecordTelemetryEventRequestSchema = z
  .object({
    eventType: z.enum([
      "suggestion_accepted",
      "suggestion_dismissed",
      "suggestion_stale",
    ]),
    requestId: z.string().min(1),
    timestamp: z.string().datetime(),
    activeApplicationBundleId: z.string().min(1).optional(),
    suggestionLength: z.number().int().nonnegative().optional(),
    latencyMs: z.number().int().nonnegative().optional(),
    modelId: z.string().min(1).optional(),
  })
  .strict();

export const TelemetryEventsResponseSchema = z.object({
  status: z.literal("ok"),
  data: z.object({
    recorded: z.boolean(),
  }),
});

export const LocalSuggestionActivitySchema = z.object({
  accepted: z.number().int().nonnegative(),
  averageAcceptanceLatencyMs: z.number().int().nonnegative().nullable(),
});

export const LocalSuggestionActivityResponseSchema = z.object({
  status: z.literal("ok"),
  data: LocalSuggestionActivitySchema,
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

export const EntitlementErrorDetailsSchema = z.object({
  quota: z.number().int().nonnegative(),
  usage: z.number().int().nonnegative(),
  resetAt: z.string().datetime(),
  upgradeUrl: z.string().min(1).optional(),
});

export const ApiErrorResponseSchema = z.object({
  status: z.literal("error"),
  error: z.object({
    code: z.enum(errorCodes),
    message: z.string().min(1),
    details: EntitlementErrorDetailsSchema.optional(),
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
export type AppContextFragment = z.infer<typeof AppContextFragmentSchema>;
export type AppContext = z.infer<typeof AppContextSchema>;
export type SuggestionRequest = z.infer<typeof SuggestionRequestSchema>;
export type Suggestion = z.infer<typeof SuggestionSchema>;
export type SuggestionResponse = z.infer<typeof SuggestionResponseSchema>;
export type EntitlementErrorDetails = z.infer<
  typeof EntitlementErrorDetailsSchema
>;
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
export type PersonalMemoryCreatedBy = z.infer<
  typeof PersonalMemoryCreatedBySchema
>;
export type PersonalMemory = z.infer<typeof PersonalMemorySchema>;
export type MemoryListResponse = z.infer<typeof MemoryListResponseSchema>;
export type MemoryDeleteResponse = z.infer<typeof MemoryDeleteResponseSchema>;
export type MemoryExtractionRequest = z.infer<
  typeof MemoryExtractionRequestSchema
>;
export type MemoryExtractionCounts = z.infer<
  typeof MemoryExtractionCountsSchema
>;
export type DeviceListItem = z.infer<typeof DeviceListItemSchema>;
export type DeviceListResponse = z.infer<typeof DeviceListResponseSchema>;
export type BillingQuotaResponse = z.infer<typeof BillingQuotaResponseSchema>;
export type BillingCheckoutResponse = z.infer<typeof BillingCheckoutResponseSchema>;
export type BillingPortalResponse = z.infer<typeof BillingPortalResponseSchema>;
export type DesktopReleaseFeed = z.infer<typeof DesktopReleaseFeedSchema>;
export type DesktopReleaseFeedResponse = z.infer<
  typeof DesktopReleaseFeedResponseSchema
>;
export type MemoryJob = z.infer<typeof MemoryJobSchema>;
export type TelemetryEventType = z.infer<typeof TelemetryEventTypeSchema>;
export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;
export type RecordTelemetryEventRequest = z.infer<
  typeof RecordTelemetryEventRequestSchema
>;
export type TelemetryEventsResponse = z.infer<
  typeof TelemetryEventsResponseSchema
>;
export type LocalSuggestionActivity = z.infer<typeof LocalSuggestionActivitySchema>;
export type DesktopStatus = z.infer<typeof DesktopStatusSchema>;
export type DesktopStatusResponse = z.infer<typeof DesktopStatusResponseSchema>;
