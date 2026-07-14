import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { readJsonRequest } from "../apps/api/src/http/request.ts";

describe("API JSON requests", () => {
  it("returns schema-validated request data", async () => {
    const result = await readJsonRequest(
      { json: async () => ({ name: "Tab" }) },
      z.object({ name: z.string() }),
    );

    expect(result).toEqual({ ok: true, data: { name: "Tab" } });
  });

  it("distinguishes malformed JSON from schema validation failures", async () => {
    const malformed = await readJsonRequest(
      { json: async () => { throw new SyntaxError("invalid JSON"); } },
      z.object({ name: z.string() }),
    );
    const invalid = await readJsonRequest(
      { json: async () => ({ name: 42 }) },
      z.object({ name: z.string() }),
    );

    expect(malformed).toEqual({
      ok: false,
      message: "Request body must be valid JSON.",
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.message).toContain("name:");
  });
});
