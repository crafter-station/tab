import { describe, it, expect } from "bun:test";
import { createApp } from "../apps/api/src/index.ts";
import type { SuggestionInput } from "../apps/api/src/index.ts";

function createTestApp(
  generateSuggestion: (input: SuggestionInput) => Promise<{ text: string } | null>,
) {
  return createApp({ generateSuggestion });
}

const validRequest = {
  requestId: "req-1",
  deviceId: "device-1",
  typingContext: "Hello",
  contextSource: "typed_text",
  redaction: { applied: false, redactionCount: 0, kinds: [] },
  activeApplication: { bundleId: "com.apple.TextEdit" },
  memoryEnabled: true,
  contextHash: "com.apple.TextEdit:Hello:false",
  clientMetadata: { appVersion: "0.0.1", platform: "darwin" },
} as const;

describe("Hono suggestion API", () => {
  it("returns one suggestion when the provider generates text", async () => {
    const app = createTestApp(async () => ({ text: " world" }));

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validRequest),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: "ok"; data: { suggestions: Array<{ id: string; text: string }> } };
    expect(body.status).toBe("ok");
    expect(body.data.suggestions).toHaveLength(1);
    expect(body.data.suggestions[0].text).toBe(" world");
    expect(body.data.suggestions[0].id).toContain("req-1");
  });

  it("returns an empty suggestions array when the provider returns no confident suggestion", async () => {
    const app = createTestApp(async () => null);

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validRequest),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: "ok"; data: { suggestions: [] } };
    expect(body.status).toBe("ok");
    expect(body.data.suggestions).toHaveLength(0);
  });

  it("returns an invalid_request error for a missing field", async () => {
    const app = createTestApp(async () => ({ text: " world" }));

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validRequest, typingContext: "" }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { status: "error"; error: { code: string } };
    expect(body.status).toBe("error");
    expect(body.error.code).toBe("invalid_request");
  });

  it("returns a provider_failure error when generation throws", async () => {
    const app = createTestApp(async () => {
      throw new Error("model timeout");
    });

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validRequest),
    });

    expect(response.status).toBe(503);
    const body = (await response.json()) as { status: "error"; error: { code: string; message: string } };
    expect(body.status).toBe("error");
    expect(body.error.code).toBe("provider_failure");
    expect(body.error.message).toContain("model timeout");
  });

  it("accepts context hash and client metadata", async () => {
    let capturedInput: SuggestionInput | null = null;
    const app = createTestApp(async (input) => {
      capturedInput = input;
      return { text: " there" };
    });

    const response = await app.request("/suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validRequest),
    });

    expect(response.status).toBe(200);
    expect(capturedInput).not.toBeNull();
    expect(capturedInput?.requestId).toBe("req-1");
    expect(capturedInput?.typingContext).toBe("Hello");
    expect(capturedInput?.activeApplication.bundleId).toBe("com.apple.TextEdit");
  });
});
