import { describe, expect, it } from "bun:test";
import { API_ERROR_CODES } from "../packages/contracts/src/index.ts";
import { createErrorResponse } from "../apps/api/src/http/responses.ts";

describe("API responses", () => {
  it("creates an error response for every shared contract code", () => {
    for (const code of API_ERROR_CODES) {
      expect(createErrorResponse(code, "message").error.code).toBe(code);
    }
  });
});
