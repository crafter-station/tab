import {
  TelemetryEventSchema,
  type TelemetryEvent,
} from "@tabb/contracts";
import type { D1DatabaseLike } from "./device-tokens.ts";

export interface TelemetryStorage {
  recordEvent(event: TelemetryEvent): Promise<void>;
  listEvents(): Promise<readonly TelemetryEvent[]>;
}

export type TelemetryServiceDependencies = {
  readonly storage?: TelemetryStorage;
};

export class TelemetryService {
  private readonly storage: TelemetryStorage;

  constructor(deps: TelemetryServiceDependencies = {}) {
    this.storage = deps.storage ?? new InMemoryTelemetryStorage();
  }

  async record(event: Omit<TelemetryEvent, "id">): Promise<TelemetryEvent> {
    const record: TelemetryEvent = TelemetryEventSchema.parse({
      ...event,
      id: crypto.randomUUID(),
    });
    await this.storage.recordEvent(record);
    return record;
  }

  async listEvents(): Promise<readonly TelemetryEvent[]> {
    return this.storage.listEvents();
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
}

function rowToTelemetryEvent(row: Record<string, unknown>): TelemetryEvent {
  return TelemetryEventSchema.parse({
    id: String(row.id),
    requestId: String(row.request_id),
    userId: String(row.user_id),
    deviceId: row.device_id ? String(row.device_id) : undefined,
    eventType: String(row.event_type),
    timestamp: String(row.timestamp),
    activeApplicationBundleId: row.active_application_bundle_id
      ? String(row.active_application_bundle_id)
      : undefined,
    contextSource: row.context_source
      ? String(row.context_source)
      : undefined,
    suggestionLength:
      row.suggestion_length !== null && row.suggestion_length !== undefined
        ? Number(row.suggestion_length)
        : undefined,
    planId: row.plan_id ? String(row.plan_id) : undefined,
    modelId: row.model_id ? String(row.model_id) : undefined,
    latencyMs:
      row.latency_ms !== null && row.latency_ms !== undefined
        ? Number(row.latency_ms)
        : undefined,
    errorCode: row.error_code ? String(row.error_code) : undefined,
    memoryEligible:
      row.memory_eligible === true || row.memory_eligible === 1 || row.memory_eligible === "1"
        ? true
        : row.memory_eligible === false || row.memory_eligible === 0 || row.memory_eligible === "0"
          ? false
          : undefined,
    redactionApplied:
      row.redaction_applied === true ||
      row.redaction_applied === 1 ||
      row.redaction_applied === "1"
        ? true
        : row.redaction_applied === false ||
            row.redaction_applied === 0 ||
            row.redaction_applied === "0"
          ? false
          : undefined,
    redactionCount:
      row.redaction_count !== null && row.redaction_count !== undefined
        ? Number(row.redaction_count)
        : undefined,
    clientAppVersion: row.client_app_version
      ? String(row.client_app_version)
      : undefined,
    clientPlatform: row.client_platform
      ? String(row.client_platform)
      : undefined,
  });
}

export class D1TelemetryStorage implements TelemetryStorage {
  private readonly db: D1DatabaseLike;

  constructor(db: unknown) {
    this.db = db as D1DatabaseLike;
  }

  async ensureTables(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS telemetry_events (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        device_id TEXT,
        event_type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        active_application_bundle_id TEXT,
        context_source TEXT,
        suggestion_length INTEGER,
        plan_id TEXT,
        model_id TEXT,
        latency_ms INTEGER,
        error_code TEXT,
        memory_eligible INTEGER,
        redaction_applied INTEGER,
        redaction_count INTEGER,
        client_app_version TEXT,
        client_platform TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_telemetry_events_user ON telemetry_events(user_id);
      CREATE INDEX IF NOT EXISTS idx_telemetry_events_request ON telemetry_events(request_id);
    `);
  }

  async recordEvent(event: TelemetryEvent): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO telemetry_events (
          id, request_id, user_id, device_id, event_type, timestamp,
          active_application_bundle_id, context_source, suggestion_length,
          plan_id, model_id, latency_ms, error_code, memory_eligible,
          redaction_applied, redaction_count, client_app_version, client_platform
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        event.id,
        event.requestId,
        event.userId,
        event.deviceId ?? null,
        event.eventType,
        event.timestamp,
        event.activeApplicationBundleId ?? null,
        event.contextSource ?? null,
        event.suggestionLength ?? null,
        event.planId ?? null,
        event.modelId ?? null,
        event.latencyMs ?? null,
        event.errorCode ?? null,
        event.memoryEligible === undefined ? null : event.memoryEligible ? 1 : 0,
        event.redactionApplied === undefined
          ? null
          : event.redactionApplied
            ? 1
            : 0,
        event.redactionCount ?? null,
        event.clientAppVersion ?? null,
        event.clientPlatform ?? null,
      )
      .run();
  }

  async listEvents(): Promise<readonly TelemetryEvent[]> {
    const result = (await this.db
      .prepare("SELECT * FROM telemetry_events ORDER BY timestamp")
      .bind()
      .all()) as { results: Record<string, unknown>[] };
    return result.results.map(rowToTelemetryEvent);
  }
}
