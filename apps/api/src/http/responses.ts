import {
  ApiErrorResponseSchema,
  ApiSuccessResponseSchema,
  type ApiErrorCode,
  type Suggestion,
} from "@tab/contracts";

export function createErrorResponse(
  code: ApiErrorCode,
  message: string,
  details?: Record<string, unknown>,
) {
  return ApiErrorResponseSchema.parse({
    status: "error",
    error: { code, message, details },
  });
}

export function createSuccessResponse(suggestions: Suggestion[]) {
  return ApiSuccessResponseSchema.parse({
    status: "ok",
    data: { suggestions },
  });
}

export function formatValidationIssues(
  issues: Array<{ path: PropertyKey[]; message: string }>,
): string {
  return issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
}
