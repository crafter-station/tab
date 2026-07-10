import { describe, it, expect, spyOn } from "bun:test";
import type { CredentialGeneration } from "../apps/desktop/src/main/auth.ts";
import { createDesktopStatusService, type DesktopStatus } from "../apps/desktop/src/main/status.ts";

type StatusEvent = { type: "changed"; status: DesktopStatus };

function generation(value: number): CredentialGeneration {
  return value as CredentialGeneration;
}

function authorizationObservation(
  authorizationHeader: string | null,
  credentialGeneration = generation(1),
) {
  return { authorizationHeader, credentialGeneration };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

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
      getAuthorizationObservation: async () => authorizationObservation(null),
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
      getAuthorizationObservation: async () => authorizationObservation("Bearer token"),
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
      getAuthorizationObservation: async () => authorizationObservation("Bearer token"),
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
      getAuthorizationObservation: async () => authorizationObservation("Bearer token"),
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
      getAuthorizationObservation: async () => authorizationObservation("Bearer token"),
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
      getAuthorizationObservation: async () => authorizationObservation("Bearer token"),
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
      getAuthorizationObservation: async () => authorizationObservation("Bearer token"),
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

  it("contains authorization observation failures", async () => {
    const observationError = new Error("keychain unavailable");
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    const events: Array<{
      status: DesktopStatus;
      credentialGeneration: CredentialGeneration | null;
    }> = [];
    const service = createDesktopStatusService({
      apiBaseUrl: "http://localhost:8787",
      getAuthorizationObservation: async () => {
        throw observationError;
      },
      onChange: (status, credentialGeneration) => {
        events.push({ status, credentialGeneration });
      },
    });

    try {
      const status = await service.refresh();
      expect(status.connectivity).toBe("offline");
      expect(events).toHaveLength(1);
      expect(events[0].credentialGeneration).toBeNull();
      expect(errorLog).toHaveBeenCalledWith(
        "Failed to read desktop authorization:",
        observationError,
      );
    } finally {
      errorLog.mockRestore();
    }
  });

  it("carries the request credential generation separately from renderer status", async () => {
    const requestGeneration = generation(21);
    const replacementGeneration = generation(22);
    let currentObservation = authorizationObservation("Bearer token-a", requestGeneration);
    let requestAuthorization: string | null = null;
    const fetchStarted = createDeferred<void>();
    const response = createDeferred<Response>();
    const events: Array<{
      status: DesktopStatus;
      credentialGeneration: CredentialGeneration | null;
    }> = [];
    const service = createDesktopStatusService({
      apiBaseUrl: "http://localhost:8787",
      getAuthorizationObservation: async () => currentObservation,
      fetch: async (_input, init) => {
        requestAuthorization = new Headers(init?.headers).get("Authorization");
        fetchStarted.resolve();
        return response.promise;
      },
      onChange: (status, credentialGeneration) => {
        events.push({ status, credentialGeneration });
      },
    });

    const refresh = service.refresh();
    await fetchStarted.promise;
    currentObservation = authorizationObservation("Bearer token-b", replacementGeneration);
    response.resolve(Response.json({
      status: "ok",
      data: {
        authenticated: true,
        deviceRevoked: false,
      },
    }));
    await refresh;

    expect(requestAuthorization).toBe("Bearer token-a");
    expect(events).toHaveLength(1);
    expect(events[0].credentialGeneration).toBe(requestGeneration);
    expect(Object.keys(events[0].status).sort()).toEqual([
      "auth",
      "connectivity",
      "lastUpdatedAt",
      "overlay",
      "quota",
      "userId",
    ]);
  });
});
