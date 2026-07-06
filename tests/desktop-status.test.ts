import { describe, it, expect } from "bun:test";
import { createDesktopStatusService, type DesktopStatus } from "../apps/desktop/src/status.ts";

type StatusEvent = { type: "changed"; status: DesktopStatus };

function makeFetch(responses: Array<() => Response>) {
  let index = 0;
  return async () => {
    const response = responses[index];
    if (!response) {
      throw new Error("Unexpected fetch call");
    }
    index++;
    return response();
  };
}

describe("desktop status service", () => {
  it("reports sign_in_required when no authorization header is available", async () => {
    const events: StatusEvent[] = [];
    const service = createDesktopStatusService({
      apiBaseUrl: "http://localhost:8787",
      getAuthorizationHeader: async () => null,
      onChange: (status) => events.push({ type: "changed", status }),
    });

    await service.refresh();

    expect(events).toHaveLength(1);
    expect(events[0].status.auth).toBe("sign_in_required");
    expect(events[0].status.connectivity).toBe("online");
    expect(events[0].status.quota).toBeNull();
  });

  it("reports signed_in with quota when the API returns status", async () => {
    const events: StatusEvent[] = [];
    const service = createDesktopStatusService({
      apiBaseUrl: "http://localhost:8787",
      getAuthorizationHeader: async () => "Bearer token",
      fetch: makeFetch([
        () =>
          new Response(
            JSON.stringify({
              status: "ok",
              data: {
                authenticated: true,
                deviceRevoked: false,
                planId: "free",
                quota: 100,
                usage: 5,
                resetAt: "2026-08-01T00:00:00.000Z",
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ]),
      onChange: (status) => events.push({ type: "changed", status }),
    });

    await service.refresh();

    expect(events).toHaveLength(1);
    expect(events[0].status.auth).toBe("signed_in");
    expect(events[0].status.connectivity).toBe("online");
    expect(events[0].status.quota).toEqual({
      planId: "free",
      quota: 100,
      usage: 5,
      resetAt: "2026-08-01T00:00:00.000Z",
      exhausted: false,
    });
  });

  it("reports revoked_device when the API returns a revoked_device error", async () => {
    const events: StatusEvent[] = [];
    const service = createDesktopStatusService({
      apiBaseUrl: "http://localhost:8787",
      getAuthorizationHeader: async () => "Bearer token",
      fetch: makeFetch([
        () =>
          new Response(
            JSON.stringify({
              status: "error",
              error: { code: "revoked_device", message: "This device has been revoked." },
            }),
            { status: 401, headers: { "Content-Type": "application/json" } },
          ),
      ]),
      onChange: (status) => events.push({ type: "changed", status }),
    });

    await service.refresh();

    expect(events).toHaveLength(1);
    expect(events[0].status.auth).toBe("revoked_device");
    expect(events[0].status.connectivity).toBe("online");
  });

  it("reports sign_in_required when the API returns an unauthenticated error", async () => {
    const events: StatusEvent[] = [];
    const service = createDesktopStatusService({
      apiBaseUrl: "http://localhost:8787",
      getAuthorizationHeader: async () => "Bearer token",
      fetch: makeFetch([
        () =>
          new Response(
            JSON.stringify({
              status: "error",
              error: { code: "unauthenticated", message: "Invalid device token." },
            }),
            { status: 401, headers: { "Content-Type": "application/json" } },
          ),
      ]),
      onChange: (status) => events.push({ type: "changed", status }),
    });

    await service.refresh();

    expect(events).toHaveLength(1);
    expect(events[0].status.auth).toBe("sign_in_required");
  });

  it("reports quota_exhausted when usage reaches the quota", async () => {
    const events: StatusEvent[] = [];
    const service = createDesktopStatusService({
      apiBaseUrl: "http://localhost:8787",
      getAuthorizationHeader: async () => "Bearer token",
      fetch: makeFetch([
        () =>
          new Response(
            JSON.stringify({
              status: "ok",
              data: {
                authenticated: true,
                deviceRevoked: false,
                planId: "free",
                quota: 100,
                usage: 100,
                resetAt: "2026-08-01T00:00:00.000Z",
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ]),
      onChange: (status) => events.push({ type: "changed", status }),
    });

    await service.refresh();

    expect(events[0].status.auth).toBe("signed_in");
    expect(events[0].status.quota?.exhausted).toBe(true);
    expect(events[0].status.quota?.usage).toBe(100);
  });

  it("reports offline when the network request throws", async () => {
    const events: StatusEvent[] = [];
    const service = createDesktopStatusService({
      apiBaseUrl: "http://localhost:8787",
      getAuthorizationHeader: async () => "Bearer token",
      fetch: makeFetch([
        () => {
          throw new Error("network unreachable");
        },
      ]),
      onChange: (status) => events.push({ type: "changed", status }),
    });

    await service.refresh();

    expect(events).toHaveLength(1);
    expect(events[0].status.auth).toBe("signed_in"); // previous/assumed state kept
    expect(events[0].status.connectivity).toBe("offline");
  });

  it("does not surface transient failures in the overlay-focused status", async () => {
    const events: StatusEvent[] = [];
    const service = createDesktopStatusService({
      apiBaseUrl: "http://localhost:8787",
      getAuthorizationHeader: async () => "Bearer token",
      fetch: makeFetch([
        () => {
          throw new Error("network unreachable");
        },
      ]),
      onChange: (status) => events.push({ type: "changed", status }),
    });

    await service.refresh();

    // The overlay should not receive error notifications; status UI handles them.
    expect(events[0].status.overlay).toBe("hidden");
  });
});
