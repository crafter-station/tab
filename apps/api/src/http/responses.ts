import {
  ApiErrorResponseSchema,
  ApiSuccessResponseSchema,
  type Suggestion,
} from "@tab/contracts";

export const ERROR_CODES = [
  "invalid_request",
  "unauthenticated",
  "email_unverified",
  "revoked_device",
  "billing_required",
  "plan_change_required",
  "quota_exhausted",
  "rate_limited",
  "provider_failure",
] as const;

export function createErrorResponse(
  code: (typeof ERROR_CODES)[number],
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
