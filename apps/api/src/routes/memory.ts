import {
  MemoryDeleteResponseSchema,
  MemoryExtractionRequestSchema,
  MemoryExtractionResponseSchema,
  MemoryListResponseSchema,
  MemoryWriteRequestSchema,
  MemoryWriteResponseSchema,
} from "@tabb/contracts";
import type { Context } from "hono";
import type { ApiApp, ApiBindings, ApiVariables } from "../api-types.ts";
import type { AuthInstance } from "../auth.ts";
import type { PersonalMemoryService } from "../personal-memory.ts";
import type { MemoryExtractionService } from "../memory-agent.ts";
import { requireSession } from "../http/auth.ts";
import { createErrorResponse } from "../http/responses.ts";

export function registerMemoryRoutes(
  app: ApiApp,
  deps: {
    auth: AuthInstance;
    personalMemoryService: PersonalMemoryService;
    memoryExtractionService: MemoryExtractionService;
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
    const body = await readMemoryExtractionBody(c);
    if (!body) {
      return c.json(
        createErrorResponse("invalid_request", "Extraction batch is invalid."),
        400,
      );
    }

    const counts = await deps.memoryExtractionService.extract(userId, body);
    return c.json(
      MemoryExtractionResponseSchema.parse({ status: "ok", data: { counts } }),
      200,
    );
  }

  app.get("/api/memory", async (c) => listMemories(c, c.get("device").userId));
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
