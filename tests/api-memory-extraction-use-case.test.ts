import { describe, expect, it } from "bun:test";
import type { TelemetryEvent } from "@tab/contracts";
import type { Device } from "../apps/api/src/device-tokens.ts";
import { MemoryExtractionUseCase } from "../apps/api/src/memory-extraction-use-case.ts";

const device: Device = {
  id: "device-record-1",
  userId: "user-1",
  deviceId: "device-1",
  tokenHash: "token-hash",
  platform: "darwin",
  appVersion: "0.1.0",
  createdAt: new Date("2026-07-14T00:00:00.000Z"),
  lastSeenAt: new Date("2026-07-14T00:00:00.000Z"),
  revoked: false,
};

const request = {
  batchId: "batch-1",
  entries: [
    {
      id: "entry-1",
      text: "I prefer concise architecture reports.",
      timestamp: "2026-07-14T00:00:00.000Z",
      contextSource: "typed_text" as const,
      activeApplication: { bundleId: "com.apple.TextEdit" },
      redaction: { applied: false, redactionCount: 0, kinds: [] },
    },
  ],
};

function createUseCase(options: {
  paid?: boolean;
  extract?: () => Promise<{
    created: number;
    updated: number;
    deleted: number;
    rejected: number;
  }>;
} = {}) {
  const events: TelemetryEvent[] = [];
  let requestLoads = 0;
  const useCase = new MemoryExtractionUseCase({
    billingService: {
      async getStatus() {
        return {
          capabilities: {
            continuousMemoryExtraction: options.paid ?? true,
          },
        } as Awaited<ReturnType<
          import("../apps/api/src/billing.ts").BillingService["getStatus"]
        >>;
      },
    },
    memoryExtractionService: {
      extract: options.extract ?? (async () => ({
        created: 1,
        updated: 2,
        deleted: 3,
        rejected: 4,
      })),
    },
    telemetryService: {
      async record(event) {
        const recorded = { ...event, id: crypto.randomUUID() } as TelemetryEvent;
        events.push(recorded);
        return recorded;
      },
    },
  });

  return {
    events,
    handle(body: unknown = request) {
      return useCase.handle(device, async () => {
        requestLoads += 1;
        return body;
      });
    },
    get requestLoads() {
      return requestLoads;
    },
  };
}

describe("MemoryExtractionUseCase", () => {
  it("owns entitlement ordering and does not read an unavailable request", async () => {
    const harness = createUseCase({ paid: false });

    expect(await harness.handle({ invalid: true })).toEqual({
      ok: false,
      status: 403,
      code: "feature_unavailable",
      message: "Continuous Memory Extraction requires a paid plan.",
      details: {
        capability: "memory_extraction",
        upgradeUrl: "/pricing",
      },
    });
    expect(harness.requestLoads).toBe(0);
    expect(harness.events).toEqual([]);
  });

  it("rejects invalid extraction windows before extraction or telemetry", async () => {
    const harness = createUseCase();

    expect(await harness.handle({ batchId: "batch-1", entries: [] })).toEqual({
      ok: false,
      status: 400,
      code: "invalid_request",
      message: "Extraction batch is invalid.",
    });
    expect(harness.events).toEqual([]);
  });

  it("records the complete successful extraction lifecycle", async () => {
    const harness = createUseCase();

    expect(await harness.handle()).toEqual({
      ok: true,
      counts: { created: 1, updated: 2, deleted: 3, rejected: 4 },
    });
    expect(harness.events.map((event) => event.eventType)).toEqual([
      "memory_extraction_attempted",
      "memory_extraction_succeeded",
    ]);
    expect(harness.events[1]).toMatchObject({
      requestId: "batch-1",
      userId: "user-1",
      deviceId: "device-1",
      memoryCreatedCount: 1,
      memoryUpdatedCount: 2,
      memoryDeletedCount: 3,
      memoryRejectedCount: 4,
    });
  });

  it("records provider failure and preserves the thrown error", async () => {
    const providerError = new Error("provider unavailable");
    const harness = createUseCase({
      extract: async () => {
        throw providerError;
      },
    });

    await expect(harness.handle()).rejects.toBe(providerError);
    expect(harness.events.map((event) => event.eventType)).toEqual([
      "memory_extraction_attempted",
      "memory_extraction_failed",
    ]);
    expect(harness.events[1]).toMatchObject({
      errorCode: "provider_failure",
      requestId: "batch-1",
    });
  });
});
