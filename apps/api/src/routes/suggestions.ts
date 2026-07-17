import { SuggestionRequestSchema } from "@tab/contracts";
import { detectSensitiveData } from "@tab/redaction";
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
  const requestWindows = new Map<string, { startedAt: number; count: number }>();
  app.post("/suggestions", async (c) => {
    const request = await readJsonRequest(c.req, SuggestionRequestSchema);
    if (!request.ok) {
      return c.json(
        createErrorResponse("invalid_request", request.message),
        400,
      );
    }
    if (request.data.mode === "rewrite") {
      const sensitive = detectSensitiveData(
        `${request.data.textBeforeSelection}\n${request.data.selectedText}\n${request.data.textAfterSelection}`,
      );
      if (request.data.redaction.applied || sensitive.hasSensitiveData) {
        return c.json(
          createErrorResponse("invalid_request", "Rewrite contains sensitive text."),
          400,
        );
      }
    }

    if (request.data.mode === "rewrite") {
      const now = Date.now();
      const key = c.get("device").deviceId;
      const current = requestWindows.get(key);
      const window = !current || now - current.startedAt >= 60_000
        ? { startedAt: now, count: 1 }
        : { ...current, count: current.count + 1 };
      requestWindows.set(key, window);
      if (window.count > 60) {
        return c.json(
          createErrorResponse("rate_limited", "Rewrite request rate limit exceeded."),
          429,
        );
      }
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
