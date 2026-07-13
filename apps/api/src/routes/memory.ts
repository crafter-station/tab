import {
  MemoryDeleteResponseSchema,
  MemoryExtractionRequestSchema,
  MemoryExtractionResponseSchema,
  MemoryExportResponseSchema,
  MemoryListResponseSchema,
  MemoryWriteRequestSchema,
  MemoryWriteResponseSchema,
  type MemoryExtractionCounts,
  type TelemetryEvent,
} from "@tab/contracts";
import { summarizeMemoryExtractionWindow } from "@tab/memory-policy";
import type { Context } from "hono";
import type { ApiApp, ApiBindings, ApiVariables } from "../api-types.ts";
import type { AuthInstance } from "../auth.ts";
import type { BillingService } from "../billing.ts";
import type { PersonalMemoryService } from "../personal-memory.ts";
import {
  MEMORY_EXTRACTION_MODEL_ID,
  type MemoryExtractionService,
} from "../memory-agent.ts";
import { requireSession } from "../http/auth.ts";
import { createErrorResponse } from "../http/responses.ts";
import type { TelemetryService } from "../telemetry.ts";

export function registerMemoryRoutes(
  app: ApiApp,
  deps: {
    auth: AuthInstance;
    personalMemoryService: PersonalMemoryService;
    memoryExtractionService: MemoryExtractionService;
    telemetryService: TelemetryService;
    billingService: BillingService;
  },
) {
  type MemoryContext = Context<{ Bindings: ApiBindings; Variables: ApiVariables }>;

  async function listMemories(c: MemoryContext, userId: string) {
    const memories = await deps.personalMemoryService.listMemories(userId);
    return c.json(
      MemoryListResponseSchema.parse({ status: "ok", data: { memories } }),
      200,
    );
  }

  async function readMemoryWriteBody(c: MemoryContext) {
    try {
      const parsed = MemoryWriteRequestSchema.safeParse(await c.req.json());
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async function readMemoryExtractionBody(c: MemoryContext) {
    try {
      const parsed = MemoryExtractionRequestSchema.safeParse(await c.req.json());
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async function createMemory(c: MemoryContext, userId: string) {
    const body = await readMemoryWriteBody(c);
    if (!body) {
      return c.json(
        createErrorResponse("invalid_request", "Memory content is required."),
        400,
      );
    }

    const memory = await deps.personalMemoryService.createMemory({
      userId,
      content: body.content,
      createdBy: "user",
    });

    return c.json(
      MemoryWriteResponseSchema.parse({ status: "ok", data: { memory } }),
      200,
    );
  }

  async function updateMemory(c: MemoryContext, userId: string) {
    const id = c.req.param("id");
    if (!id) {
      return c.json(
        createErrorResponse("invalid_request", "Memory id is required."),
        400,
      );
    }

    const body = await readMemoryWriteBody(c);
    if (!body) {
      return c.json(
        createErrorResponse("invalid_request", "Memory content is required."),
        400,
      );
    }

    const memory = await deps.personalMemoryService.updateMemoryForUser(userId, id, {
      content: body.content,
    });

    if (!memory) {
      return c.json(
        createErrorResponse("invalid_request", "Memory not found."),
        404,
      );
    }

    return c.json(
      MemoryWriteResponseSchema.parse({ status: "ok", data: { memory } }),
      200,
    );
  }

  async function deleteMemory(c: MemoryContext, userId: string) {
    const id = c.req.param("id");
    if (!id) {
      return c.json(
        createErrorResponse("invalid_request", "Memory id is required."),
        400,
      );
    }

    const deleted = await deps.personalMemoryService.deleteMemory(userId, id);

    if (!deleted) {
      return c.json(
        createErrorResponse("invalid_request", "Memory not found."),
        404,
      );
    }

    return c.json(
      MemoryDeleteResponseSchema.parse({ status: "ok", data: { deleted: true } }),
      200,
    );
  }

  async function extractMemory(c: MemoryContext, userId: string) {
    const entitlement = await deps.billingService.getStatus(userId);
    if (!entitlement.capabilities.continuousMemoryExtraction) {
      return c.json(
        createErrorResponse(
          "feature_unavailable",
          "Continuous Memory Extraction requires Pro.",
          {
            capability: "memory_extraction",
            upgradeUrl: "/pricing",
          },
        ),
        403,
      );
    }

    const body = await readMemoryExtractionBody(c);
    if (!body) {
      return c.json(
        createErrorResponse("invalid_request", "Extraction batch is invalid."),
        400,
      );
    }

    const extractionWindow = summarizeMemoryExtractionWindow(body.entries);
    if (!extractionWindow) {
      return c.json(
        createErrorResponse("invalid_request", "Extraction batch is invalid."),
        400,
      );
    }
    const device = c.get("device");
    const startedAt = performance.now();
    const extractionTelemetry = {
      contextSource: extractionWindow.contextSource,
      modelId: MEMORY_EXTRACTION_MODEL_ID,
      redactionApplied: extractionWindow.redaction.applied,
      redactionCount: extractionWindow.redaction.redactionCount,
      clientAppVersion: body.clientMetadata?.appVersion,
      clientPlatform: body.clientMetadata?.platform,
    };
    const recordExtractionEvent = async (
      event: Omit<TelemetryEvent, "id" | "requestId" | "userId" | "deviceId">,
    ): Promise<void> => {
      try {
        await deps.telemetryService.record({
          ...event,
          requestId: body.batchId,
          userId,
          deviceId: device.deviceId,
        });
      } catch {
        // Extraction telemetry is best-effort and must not affect processing.
      }
    };

    await recordExtractionEvent({
      ...extractionTelemetry,
      eventType: "memory_extraction_attempted",
      timestamp: new Date().toISOString(),
    });

    let counts: MemoryExtractionCounts;
    try {
      counts = await deps.memoryExtractionService.extract(userId, body);
    } catch (error) {
      await recordExtractionEvent({
        ...extractionTelemetry,
        eventType: "memory_extraction_failed",
        timestamp: new Date().toISOString(),
        latencyMs: Math.round(performance.now() - startedAt),
        errorCode: "provider_failure",
      });
      throw error;
    }

    await recordExtractionEvent({
      ...extractionTelemetry,
      eventType: "memory_extraction_succeeded",
      timestamp: new Date().toISOString(),
      latencyMs: Math.round(performance.now() - startedAt),
      memoryCreatedCount: counts.created,
      memoryUpdatedCount: counts.updated,
      memoryDeletedCount: counts.deleted,
      memoryRejectedCount: counts.rejected,
    });

    return c.json(
      MemoryExtractionResponseSchema.parse({ status: "ok", data: { counts } }),
      200,
    );
  }

  app.get("/api/memory", async (c) => listMemories(c, c.get("device").userId));
  app.get("/api/memory/export", async (c) => {
    const memories = await deps.personalMemoryService.listMemories(
      c.get("device").userId,
    );
    return c.json(
      MemoryExportResponseSchema.parse({
        status: "ok",
        data: { exportedAt: new Date().toISOString(), memories },
      }),
      200,
    );
  });
  app.post("/api/memory/extract", async (c) =>
    extractMemory(c, c.get("device").userId),
  );
  app.post("/api/memory", async (c) => createMemory(c, c.get("device").userId));
  app.patch("/api/memory/:id", async (c) =>
    updateMemory(c, c.get("device").userId),
  );
  app.delete("/api/memory/:id", async (c) =>
    deleteMemory(c, c.get("device").userId),
  );

  app.get("/api/account/memory", async (c) => {
    const sessionCheck = await requireSession(c, deps.auth);
    if (!sessionCheck.ok) return sessionCheck.response;
    return listMemories(c, sessionCheck.session.user.id);
  });

  app.get("/api/account/memory/export", async (c) => {
    const sessionCheck = await requireSession(c, deps.auth);
    if (!sessionCheck.ok) return sessionCheck.response;
    const memories = await deps.personalMemoryService.listMemories(
      sessionCheck.session.user.id,
    );
    return c.json(
      MemoryExportResponseSchema.parse({
        status: "ok",
        data: { exportedAt: new Date().toISOString(), memories },
      }),
      200,
    );
  });

  app.delete("/api/account/memory/:id", async (c) => {
    const sessionCheck = await requireSession(c, deps.auth);
    if (!sessionCheck.ok) return sessionCheck.response;
    return deleteMemory(c, sessionCheck.session.user.id);
  });

  app.post("/api/account/memory", async (c) => {
    const sessionCheck = await requireSession(c, deps.auth);
    if (!sessionCheck.ok) return sessionCheck.response;
    return createMemory(c, sessionCheck.session.user.id);
  });

  app.patch("/api/account/memory/:id", async (c) => {
    const sessionCheck = await requireSession(c, deps.auth);
    if (!sessionCheck.ok) return sessionCheck.response;
    return updateMemory(c, sessionCheck.session.user.id);
  });
}
