import {
  MemoryDeleteResponseSchema,
  MemoryExtractionResponseSchema,
  MemoryExportResponseSchema,
  MemoryListResponseSchema,
  MemoryWriteRequestSchema,
  MemoryWriteResponseSchema,
} from "@tab/contracts";
import type { Context } from "hono";
import type { ApiApp, ApiBindings, ApiVariables } from "../api-types.ts";
import type { MemoryExtractionUseCase } from "../memory-extraction-use-case.ts";
import type { PersonalMemoryService } from "../personal-memory.ts";
import { createErrorResponse } from "../http/responses.ts";

export function registerMemoryRoutes(
  app: ApiApp,
  deps: {
    personalMemoryService: PersonalMemoryService;
    memoryExtractionUseCase: MemoryExtractionUseCase;
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

  async function extractMemory(c: MemoryContext) {
    const device = c.get("device");
    const result = await deps.memoryExtractionUseCase.handle(
      device,
      () => c.req.json(),
    );
    if (!result.ok) {
      return c.json(
        createErrorResponse(result.code, result.message, result.details),
        result.status,
      );
    }

    return c.json(
      MemoryExtractionResponseSchema.parse({
        status: "ok",
        data: { counts: result.counts },
      }),
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
  app.post("/api/memory/extract", extractMemory);
  app.post("/api/memory", async (c) => createMemory(c, c.get("device").userId));
  app.patch("/api/memory/:id", async (c) =>
    updateMemory(c, c.get("device").userId),
  );
  app.delete("/api/memory/:id", async (c) =>
    deleteMemory(c, c.get("device").userId),
  );

  app.get("/api/account/memory", async (c) => {
    return listMemories(c, c.get("session").user.id);
  });

  app.get("/api/account/memory/export", async (c) => {
    const memories = await deps.personalMemoryService.listMemories(
      c.get("session").user.id,
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
    return deleteMemory(c, c.get("session").user.id);
  });

  app.post("/api/account/memory", async (c) => {
    return createMemory(c, c.get("session").user.id);
  });

  app.patch("/api/account/memory/:id", async (c) => {
    return updateMemory(c, c.get("session").user.id);
  });
}
