import {
  type RecordTelemetryEventRequest,
  TelemetryEventSchema,
  type TelemetryEvent,
} from "@tab/contracts";
import { and, eq, gte, sql } from "drizzle-orm";
import type { AppDatabase } from "./db/index.ts";
import { telemetryEvents } from "./db/schema.ts";

export interface TelemetryStorage {
  recordEvent(event: TelemetryEvent): Promise<void>;
  listEvents(): Promise<readonly TelemetryEvent[]>;
  getLocalSuggestionActivity(userId: string, since: string): Promise<LocalSuggestionActivity>;
}

export type LocalSuggestionActivity = {
  readonly acceptedSuggestions: number;
  readonly acceptedWords: number;
  readonly acceptedCharacters: number;
  readonly activeWritingDays: number;
  readonly averageAcceptanceLatencyMs: number | null;
};

export type TelemetryServiceDependencies = {
  readonly storage?: TelemetryStorage;
};

export type DeviceTelemetryIdentity = {
  readonly userId: string;
  readonly deviceId: string;
};

export class TelemetryService {
  private readonly storage: TelemetryStorage;

  constructor(deps: TelemetryServiceDependencies = {}) {
    if (!deps.storage) {
      throw new Error("TelemetryService requires a storage implementation");
    }
    this.storage = deps.storage;
  }

  async record(
    event: Omit<TelemetryEvent, "id"> & { id?: string },
  ): Promise<TelemetryEvent> {
    const record: TelemetryEvent = TelemetryEventSchema.parse({
      ...event,
      id: event.id ?? crypto.randomUUID(),
    });
    await this.storage.recordEvent(record);
    return record;
  }

  async recordDeviceEvents(
    events: readonly RecordTelemetryEventRequest[],
    identity: DeviceTelemetryIdentity,
  ): Promise<void> {
    for (const event of events) {
      try {
        await this.record({
          id: event.eventId,
          eventType: event.eventType,
          requestId: event.requestId,
          userId: identity.userId,
          deviceId: identity.deviceId,
          timestamp: event.timestamp,
          suggestionLength: event.suggestionLength,
          latencyMs: event.latencyMs,
          errorCode: event.errorCode,
          modelId: event.modelId,
          inferenceSource: event.inferenceSource,
          trigger: event.trigger,
          acceptedWordCount: event.acceptedWordCount,
          acceptedCharacterCount: event.acceptedCharacterCount,
          applicationCategory: event.applicationCategory,
          memoryUsed: event.memoryUsed,
          memoryCount: event.memoryCount,
        });
      } catch {
        // Device telemetry is best-effort; one failed event must not block the batch.
      }
    }
  }

  async listEvents(): Promise<readonly TelemetryEvent[]> {
    return this.storage.listEvents();
  }

  async getLocalSuggestionActivity(userId: string, now = new Date()): Promise<LocalSuggestionActivity> {
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    return this.storage.getLocalSuggestionActivity(userId, since);
  }
}

export class InMemoryTelemetryStorage implements TelemetryStorage {
  private events: TelemetryEvent[] = [];

  async recordEvent(event: TelemetryEvent): Promise<void> {
    this.events.push(event);
  }

  async listEvents(): Promise<readonly TelemetryEvent[]> {
    return this.events;
  }

  async getLocalSuggestionActivity(userId: string, since: string): Promise<LocalSuggestionActivity> {
    const events = this.events.filter((event) =>
      event.userId === userId &&
      event.eventType === "suggestion_accepted" &&
      event.inferenceSource === "local" &&
      event.timestamp >= since
    );
    const latencies = events.flatMap((event) => event.latencyMs === undefined ? [] : [event.latencyMs]);
    return {
      acceptedSuggestions: events.length,
      acceptedWords: events.reduce(
        (total, event) => total + (event.acceptedWordCount ?? 0),
        0,
      ),
      acceptedCharacters: events.reduce(
        (total, event) => total + (event.acceptedCharacterCount ?? 0),
        0,
      ),
      activeWritingDays: new Set(
        events.map((event) => event.timestamp.slice(0, 10)),
      ).size,
      averageAcceptanceLatencyMs: latencies.length === 0
        ? null
        : Math.round(latencies.reduce((total, latency) => total + latency, 0) / latencies.length),
    };
  }
}

function optionalNumber(value: number | null): number | undefined {
  return value === null ? undefined : value;
}

function optionalBoolean(value: boolean | null): boolean | undefined {
  return value === null ? undefined : value;
}

function rowToTelemetryEvent(
  row: typeof telemetryEvents.$inferSelect,
): TelemetryEvent {
  return TelemetryEventSchema.parse({
    id: row.id,
    requestId: row.requestId,
    userId: row.userId,
    deviceId: row.deviceId ?? undefined,
    eventType: row.eventType,
    timestamp: row.timestamp,
    activeApplicationBundleId: row.activeApplicationBundleId ?? undefined,
    contextSource: row.contextSource ?? undefined,
    suggestionLength: optionalNumber(row.suggestionLength),
    planId: row.planId ?? undefined,
    modelId: row.modelId ?? undefined,
    latencyMs: optionalNumber(row.latencyMs),
    errorCode: row.errorCode ?? undefined,
    memoryEligible: optionalBoolean(row.memoryEligible),
    redactionApplied: optionalBoolean(row.redactionApplied),
    redactionCount: optionalNumber(row.redactionCount),
    clientAppVersion: row.clientAppVersion ?? undefined,
    clientPlatform: row.clientPlatform ?? undefined,
    memoryCreatedCount: optionalNumber(row.memoryCreatedCount),
    memoryUpdatedCount: optionalNumber(row.memoryUpdatedCount),
    memoryDeletedCount: optionalNumber(row.memoryDeletedCount),
    memoryRejectedCount: optionalNumber(row.memoryRejectedCount),
    inferenceSource: row.inferenceSource ?? undefined,
    trigger: row.trigger ?? undefined,
    acceptedWordCount: optionalNumber(row.acceptedWordCount),
    acceptedCharacterCount: optionalNumber(row.acceptedCharacterCount),
    applicationCategory: row.applicationCategory ?? undefined,
    memoryUsed: optionalBoolean(row.memoryUsed),
    memoryCount: optionalNumber(row.memoryCount),
    providerId: row.providerId ?? undefined,
    cloudCostUsdMicros: optionalNumber(row.cloudCostUsdMicros),
    suggestionMode: row.suggestionMode ?? undefined,
    selectedTextLength: optionalNumber(row.selectedTextLength),
    surroundingTextLength: optionalNumber(row.surroundingTextLength),
  });
}

export class D1TelemetryStorage implements TelemetryStorage {
  private readonly db: AppDatabase;

  constructor(db: AppDatabase) {
    this.db = db;
  }

  async recordEvent(event: TelemetryEvent): Promise<void> {
    await this.db.insert(telemetryEvents).values({
      id: event.id,
      requestId: event.requestId,
      userId: event.userId,
      deviceId: event.deviceId ?? null,
      eventType: event.eventType,
      timestamp: event.timestamp,
      activeApplicationBundleId: event.activeApplicationBundleId ?? null,
      contextSource: event.contextSource ?? null,
      suggestionLength: event.suggestionLength ?? null,
      planId: event.planId ?? null,
      modelId: event.modelId ?? null,
      latencyMs: event.latencyMs ?? null,
      errorCode: event.errorCode ?? null,
      memoryEligible: event.memoryEligible ?? null,
      redactionApplied: event.redactionApplied ?? null,
      redactionCount: event.redactionCount ?? null,
      clientAppVersion: event.clientAppVersion ?? null,
      clientPlatform: event.clientPlatform ?? null,
      memoryCreatedCount: event.memoryCreatedCount ?? null,
      memoryUpdatedCount: event.memoryUpdatedCount ?? null,
      memoryDeletedCount: event.memoryDeletedCount ?? null,
      memoryRejectedCount: event.memoryRejectedCount ?? null,
      inferenceSource: event.inferenceSource ?? null,
      trigger: event.trigger ?? null,
      acceptedWordCount: event.acceptedWordCount ?? null,
      acceptedCharacterCount: event.acceptedCharacterCount ?? null,
      applicationCategory: event.applicationCategory ?? null,
      memoryUsed: event.memoryUsed ?? null,
      memoryCount: event.memoryCount ?? null,
      providerId: event.providerId ?? null,
      cloudCostUsdMicros: event.cloudCostUsdMicros ?? null,
      suggestionMode: event.suggestionMode ?? null,
      selectedTextLength: event.selectedTextLength ?? null,
      surroundingTextLength: event.surroundingTextLength ?? null,
    });
  }

  async listEvents(): Promise<readonly TelemetryEvent[]> {
    const rows = await this.db
      .select()
      .from(telemetryEvents)
      .orderBy(telemetryEvents.timestamp);
    return rows.map(rowToTelemetryEvent);
  }

  async getLocalSuggestionActivity(userId: string, since: string): Promise<LocalSuggestionActivity> {
    const [row] = await this.db
      .select({
        acceptedSuggestions: sql<number>`count(*)`,
        acceptedWords: sql<number>`coalesce(sum(${telemetryEvents.acceptedWordCount}), 0)`,
        acceptedCharacters: sql<number>`coalesce(sum(${telemetryEvents.acceptedCharacterCount}), 0)`,
        activeWritingDays: sql<number>`count(distinct substr(${telemetryEvents.timestamp}, 1, 10))`,
        averageAcceptanceLatencyMs: sql<number | null>`round(avg(${telemetryEvents.latencyMs}))`,
      })
      .from(telemetryEvents)
      .where(and(
        eq(telemetryEvents.userId, userId),
        eq(telemetryEvents.eventType, "suggestion_accepted"),
        eq(telemetryEvents.inferenceSource, "local"),
        gte(telemetryEvents.timestamp, since),
      ));
    return {
      acceptedSuggestions: Number(row?.acceptedSuggestions ?? 0),
      acceptedWords: Number(row?.acceptedWords ?? 0),
      acceptedCharacters: Number(row?.acceptedCharacters ?? 0),
      activeWritingDays: Number(row?.activeWritingDays ?? 0),
      averageAcceptanceLatencyMs: row?.averageAcceptanceLatencyMs === null || row?.averageAcceptanceLatencyMs === undefined
        ? null
        : Number(row.averageAcceptanceLatencyMs),
    };
  }
}
