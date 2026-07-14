import {
  MemoryExtractionRequestSchema,
  type EntitlementErrorDetails,
  type MemoryExtractionCounts,
  type TelemetryEvent,
} from "@tab/contracts";
import { summarizeMemoryExtractionWindow } from "@tab/memory-policy";
import type { BillingService } from "./billing.ts";
import type { Device } from "./device-tokens.ts";
import {
  MEMORY_EXTRACTION_MODEL_ID,
  type MemoryExtractionService,
} from "./personal-memory-extraction.ts";
import type { TelemetryService } from "./telemetry.ts";

export type MemoryExtractionUseCaseDependencies = {
  readonly billingService: Pick<BillingService, "getStatus">;
  readonly memoryExtractionService: Pick<MemoryExtractionService, "extract">;
  readonly telemetryService: Pick<TelemetryService, "record">;
};

export type MemoryExtractionUseCaseResult =
  | { readonly ok: true; readonly counts: MemoryExtractionCounts }
  | {
      readonly ok: false;
      readonly status: 400 | 403;
      readonly code: "invalid_request" | "feature_unavailable";
      readonly message: string;
      readonly details?: EntitlementErrorDetails;
    };

export class MemoryExtractionUseCase {
  constructor(private readonly deps: MemoryExtractionUseCaseDependencies) {}

  async handle(
    device: Device,
    loadRequest: () => Promise<unknown>,
  ): Promise<MemoryExtractionUseCaseResult> {
    const entitlement = await this.deps.billingService.getStatus(device.userId);
    if (!entitlement.capabilities.continuousMemoryExtraction) {
      return {
        ok: false,
        status: 403,
        code: "feature_unavailable",
        message: "Continuous Memory Extraction requires a paid plan.",
        details: {
          capability: "memory_extraction",
          upgradeUrl: "/pricing",
        },
      };
    }

    let request: unknown;
    try {
      request = await loadRequest();
    } catch {
      return this.invalidRequest();
    }
    const parsed = MemoryExtractionRequestSchema.safeParse(request);
    if (!parsed.success) return this.invalidRequest();

    const extractionWindow = summarizeMemoryExtractionWindow(parsed.data.entries);
    if (!extractionWindow) return this.invalidRequest();

    const startedAt = performance.now();
    const telemetry = {
      contextSource: extractionWindow.contextSource,
      modelId: MEMORY_EXTRACTION_MODEL_ID,
      redactionApplied: extractionWindow.redaction.applied,
      redactionCount: extractionWindow.redaction.redactionCount,
      clientAppVersion: parsed.data.clientMetadata?.appVersion,
      clientPlatform: parsed.data.clientMetadata?.platform,
    };
    const recordEvent = async (
      event: Omit<TelemetryEvent, "id" | "requestId" | "userId" | "deviceId">,
    ): Promise<void> => {
      try {
        await this.deps.telemetryService.record({
          ...event,
          requestId: parsed.data.batchId,
          userId: device.userId,
          deviceId: device.deviceId,
        });
      } catch {
        // Extraction telemetry is best-effort and must not affect processing.
      }
    };

    await recordEvent({
      ...telemetry,
      eventType: "memory_extraction_attempted",
      timestamp: new Date().toISOString(),
    });

    let counts: MemoryExtractionCounts;
    try {
      counts = await this.deps.memoryExtractionService.extract(
        device.userId,
        parsed.data,
      );
    } catch (error) {
      await recordEvent({
        ...telemetry,
        eventType: "memory_extraction_failed",
        timestamp: new Date().toISOString(),
        latencyMs: Math.round(performance.now() - startedAt),
        errorCode: "provider_failure",
      });
      throw error;
    }

    await recordEvent({
      ...telemetry,
      eventType: "memory_extraction_succeeded",
      timestamp: new Date().toISOString(),
      latencyMs: Math.round(performance.now() - startedAt),
      memoryCreatedCount: counts.created,
      memoryUpdatedCount: counts.updated,
      memoryDeletedCount: counts.deleted,
      memoryRejectedCount: counts.rejected,
    });

    return { ok: true, counts };
  }

  private invalidRequest(): MemoryExtractionUseCaseResult {
    return {
      ok: false,
      status: 400,
      code: "invalid_request",
      message: "Extraction batch is invalid.",
    };
  }
}
