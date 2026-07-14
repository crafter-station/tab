import { describe, expect, it } from "bun:test";
import { createDeviceApiClient } from "../apps/desktop/src/main/device-api-client.ts";

describe("desktop device API client", () => {
  it("resolves paths and owns current authorization and response headers", async () => {
    let captured: Request | undefined;
    const api = createDeviceApiClient({
      apiBaseUrl: "https://api.example.com",
      getAuthorizationHeader: async () => "Bearer current-token",
      fetch: async (input, init) => {
        captured = new Request(input, init);
        return Response.json({ status: "ok" });
      },
    });

    await api.request("/api/memory", {
      headers: {
        Authorization: "Bearer stale-token",
        "Content-Type": "application/json",
      },
    });

    expect(captured?.url).toBe("https://api.example.com/api/memory");
    expect(captured?.headers.get("authorization")).toBe("Bearer current-token");
    expect(captured?.headers.get("accept")).toBe("application/json");
    expect(captured?.headers.get("content-type")).toBe("application/json");
  });

  it("does not issue an authorized request without a device credential", async () => {
    let requestCount = 0;
    const api = createDeviceApiClient({
      apiBaseUrl: "https://api.example.com",
      getAuthorizationHeader: async () => null,
      fetch: async () => {
        requestCount += 1;
        return Response.json({ status: "ok" });
      },
    });

    expect(await api.requestAuthorized("/api/memory")).toBeNull();
    expect(requestCount).toBe(0);
  });
});
