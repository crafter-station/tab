import { relations } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("idx_session_user_id").on(table.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("idx_account_user_id").on(table.userId)],
);

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

export const rateLimit = sqliteTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: integer("last_request").notNull(),
});

export const deviceTokens = sqliteTable(
  "device_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    platform: text("platform").notNull(),
    appVersion: text("app_version").notNull(),
    createdAt: text("created_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    revoked: integer("revoked", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [
    index("idx_device_tokens_user").on(table.userId),
    index("idx_device_tokens_user_revoked").on(table.userId, table.revoked),
    uniqueIndex("idx_device_tokens_user_device").on(table.userId, table.deviceId),
  ],
);

export const deviceExchangeCodes = sqliteTable("device_exchange_codes", {
  code: text("code").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  expiresAt: text("expires_at").notNull(),
});

export const personalMemories = sqliteTable(
  "personal_memories",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    createdBy: text("created_by").notNull().default("system"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_personal_memories_user").on(table.userId)],
);

export const pendingPersonalMemoryVectorDeletions = sqliteTable(
  "pending_personal_memory_vector_deletions",
  {
    userId: text("user_id").notNull(),
    memoryId: text("memory_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.memoryId] })],
);

export const pendingPersonalMemoryVectorUpserts = sqliteTable(
  "pending_personal_memory_vector_upserts",
  {
    userId: text("user_id").notNull(),
    memoryId: text("memory_id").notNull(),
    mutationId: text("mutation_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.memoryId] })],
);

export const memoryExtractionIdempotency = sqliteTable(
  "memory_extraction_idempotency",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    batchIdHash: text("batch_id_hash").notNull(),
    created: integer("created").notNull(),
    updated: integer("updated").notNull(),
    deleted: integer("deleted").notNull(),
    rejected: integer("rejected").notNull(),
    claimId: text("claim_id"),
    leaseExpiresAt: text("lease_expires_at"),
    operationPlan: text("operation_plan"),
    operationCount: integer("operation_count").notNull().default(0),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.batchIdHash] }),
    index("idx_memory_extraction_idempotency_expires").on(table.expiresAt),
  ],
);

export const memoryExtractionOperations = sqliteTable(
  "memory_extraction_operations",
  {
    userId: text("user_id").notNull(),
    batchIdHash: text("batch_id_hash").notNull(),
    operationIndex: integer("operation_index").notNull(),
    outcome: text("outcome").notNull(),
    memoryId: text("memory_id"),
    counted: integer("counted", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.batchIdHash, table.operationIndex],
    }),
    index("idx_memory_extraction_operations_batch").on(
      table.userId,
      table.batchIdHash,
    ),
  ],
);

export const userEntitlements = sqliteTable("user_entitlements", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  planId: text("plan_id").notNull(),
  polarCustomerId: text("polar_customer_id"),
  polarSubscriptionId: text("polar_subscription_id"),
  polarProductId: text("polar_product_id"),
  status: text("status").notNull(),
  currentPeriodStart: text("current_period_start"),
  currentPeriodEnd: text("current_period_end"),
  cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" })
    .notNull()
    .default(false),
  billingInterval: text("billing_interval"),
  trialStartedAt: text("trial_started_at"),
  trialEndsAt: text("trial_ends_at"),
  lastWebhookEventId: text("last_webhook_event_id"),
  lastWebhookOccurredAt: text("last_webhook_occurred_at"),
  provisioningState: text("provisioning_state").notNull().default("pending"),
  provisioningAttempts: integer("provisioning_attempts").notNull().default(0),
  provisioningError: text("provisioning_error"),
  provisioningUpdatedAt: text("provisioning_updated_at"),
  reconciledAt: text("reconciled_at"),
  cachedAt: text("cached_at").notNull(),
});

export const usageRecords = sqliteTable(
  "usage_records",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    count: integer("count").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.month] })],
);

export const allowanceUsageEvents = sqliteTable(
  "allowance_usage_events",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    metric: text("metric").notNull(),
    eventId: text("event_id").notNull(),
    period: text("period").notNull(),
    amount: integer("amount").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.metric, table.eventId] }),
    index("idx_allowance_usage_period").on(
      table.userId,
      table.metric,
      table.period,
    ),
  ],
);

export const polarUsageOutbox = sqliteTable(
  "polar_usage_outbox",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    eventName: text("event_name").notNull(),
    eventTimestamp: text("event_timestamp").notNull(),
    metadata: text("metadata").notNull(),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: text("next_attempt_at").notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: text("lease_expires_at"),
    deliveredAt: text("delivered_at"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_polar_usage_outbox_pending").on(
      table.status,
      table.nextAttemptAt,
    ),
  ],
);

export const telemetryEvents = sqliteTable(
  "telemetry_events",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    deviceId: text("device_id"),
    eventType: text("event_type").notNull(),
    timestamp: text("timestamp").notNull(),
    activeApplicationBundleId: text("active_application_bundle_id"),
    contextSource: text("context_source"),
    suggestionLength: integer("suggestion_length"),
    planId: text("plan_id"),
    modelId: text("model_id"),
    latencyMs: integer("latency_ms"),
    errorCode: text("error_code"),
    memoryEligible: integer("memory_eligible", { mode: "boolean" }),
    redactionApplied: integer("redaction_applied", { mode: "boolean" }),
    redactionCount: integer("redaction_count"),
    clientAppVersion: text("client_app_version"),
    clientPlatform: text("client_platform"),
    memoryCreatedCount: integer("memory_created_count"),
    memoryUpdatedCount: integer("memory_updated_count"),
    memoryDeletedCount: integer("memory_deleted_count"),
    memoryRejectedCount: integer("memory_rejected_count"),
    inferenceSource: text("inference_source"),
    trigger: text("trigger"),
    acceptedWordCount: integer("accepted_word_count"),
    acceptedCharacterCount: integer("accepted_character_count"),
    applicationCategory: text("application_category"),
    memoryUsed: integer("memory_used", { mode: "boolean" }),
    memoryCount: integer("memory_count"),
    providerId: text("provider_id"),
    cloudCostUsdMicros: integer("cloud_cost_usd_micros"),
  },
  (table) => [
    index("idx_telemetry_events_user").on(table.userId),
    index("idx_telemetry_events_request").on(table.requestId),
    index("idx_telemetry_events_source_time").on(
      table.userId,
      table.inferenceSource,
      table.timestamp,
    ),
  ],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  devices: many(deviceTokens),
  memories: many(personalMemories),
  memoryExtractionIdempotency: many(memoryExtractionIdempotency),
  usage: many(usageRecords),
  allowanceUsageEvents: many(allowanceUsageEvents),
  polarUsageOutbox: many(polarUsageOutbox),
  telemetryEvents: many(telemetryEvents),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));
