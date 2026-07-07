import { MemoryDeleteResponseSchema, MemoryListResponseSchema } from "@tabb/contracts";
import type { Context } from "hono";
import type { ApiApp, ApiBindings, ApiVariables } from "../api-types.ts";
import type { AuthInstance } from "../auth.ts";
import type { PersonalMemoryService } from "../personal-memory.ts";
import { requireSession } from "../http/auth.ts";
import { createErrorResponse } from "../http/responses.ts";

export function registerMemoryRoutes(
  app: ApiApp,
  deps: { auth: AuthInstance; personalMemoryService: PersonalMemoryService },
) {
  type MemoryContext = Context<{ Bindings: ApiBindings; Variables: ApiVariables }>;

  async function listMemories(c: MemoryContext, userId: string) {
    const memories = await deps.personalMemoryService.listMemories(userId);
    return c.json(
      MemoryListResponseSchema.parse({ status: "ok", data: { memories } }),
      200,
    );
  }

  async function deleteMemory(c: MemoryContext, userId: string) {
    const id = c.req.param("id");
    if (!id) {
      return c.json(createErrorResponse("invalid_request", "Memory id is required."), 400);
    }

    const deleted = await deps.personalMemoryService.deleteMemory(
      userId,
      id,
    );

    if (!deleted) {
      return c.json(createErrorResponse("invalid_request", "Memory not found."), 404);
    }

    return c.json(
      MemoryDeleteResponseSchema.parse({ status: "ok", data: { deleted: true } }),
      200,
    );
  }

  app.get("/api/memory", async (c) => listMemories(c, c.get("device").userId));
  app.delete("/api/memory/:id", async (c) => deleteMemory(c, c.get("device").userId));

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
}
