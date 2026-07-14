import { SuggestionRequestSchema } from "@tab/contracts";
import type { Context } from "hono";
import type { ApiApp, ApiBindings, ApiVariables } from "../api-types.ts";
import type { SuggestionUseCase } from "../suggestion-use-case.ts";
import { readJsonRequest } from "../http/request.ts";
import { createErrorResponse, createSuccessResponse } from "../http/responses.ts";

function getWaitUntil(
  c: Context<{ Bindings: ApiBindings; Variables: ApiVariables }>,
) {
  try {
    const executionCtx = c.executionCtx;
    return (promise: Promise<unknown>) => executionCtx.waitUntil(promise);
  } catch {
    return undefined;
  }
}

export function registerSuggestionRoutes(
  app: ApiApp,
  deps: { suggestionUseCase: SuggestionUseCase },
) {
  app.post("/suggestions", async (c) => {
    const request = await readJsonRequest(c.req, SuggestionRequestSchema);
    if (!request.ok) {
      return c.json(
        createErrorResponse("invalid_request", request.message),
        400,
      );
    }

    const result = await deps.suggestionUseCase.handle(
      c.get("device"),
      request.data,
      { waitUntil: getWaitUntil(c) },
    );

    if (!result.ok) {
      return c.json(
        createErrorResponse(result.code, result.message, result.details),
        result.status,
      );
    }

    return c.json(createSuccessResponse(result.suggestions), 200);
  });
}
