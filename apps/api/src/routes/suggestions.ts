import { SuggestionRequestSchema } from "@tabb/contracts";
import type { ApiApp } from "../api-types.ts";
import type { SuggestionUseCase } from "../suggestion-use-case.ts";
import { createErrorResponse, createSuccessResponse, formatValidationIssues } from "../http/responses.ts";

export function registerSuggestionRoutes(
  app: ApiApp,
  deps: { suggestionUseCase: SuggestionUseCase },
) {
  app.post("/suggestions", async (c) => {
    console.log("[suggestions] request received");
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      console.warn("[suggestions] invalid JSON body");
      return c.json(
        createErrorResponse("invalid_request", "Request body must be valid JSON."),
        400,
      );
    }

    const parseResult = SuggestionRequestSchema.safeParse(payload);
    if (!parseResult.success) {
      console.warn(
        "[suggestions] invalid request",
        formatValidationIssues(parseResult.error.issues),
      );
      return c.json(
        createErrorResponse(
          "invalid_request",
          formatValidationIssues(parseResult.error.issues),
        ),
        400,
      );
    }

    const result = await deps.suggestionUseCase.handle(c.get("device"), parseResult.data);

    if (!result.ok) {
      return c.json(
        createErrorResponse(result.code, result.message, result.details),
        result.status,
      );
    }

    return c.json(createSuccessResponse(result.suggestions), 200);
  });
}
