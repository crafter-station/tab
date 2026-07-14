import { describe, it, expect, spyOn } from "bun:test";
import { BillingStatusDataSchema } from "@tab/contracts";
import {
  createDesktopAuthClient,
  type CredentialGeneration,
  type SynchronousCredentialPublication,
} from "../apps/desktop/src/main/auth.ts";
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

async function acceptCredentialGeneration(): Promise<boolean> {
  return true;
}

async function publishCredentialGeneration(
  _credentialGeneration: CredentialGeneration,
  publish: SynchronousCredentialPublication,
): Promise<boolean> {
  publish();
  return true;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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

function statusPayload(deepUsed: number) {
  return {
    authenticated: true,
    deviceRevoked: false,
    entitlement: {
      planId: "free",
      entitlementSource: "free",
      capabilities: {
        localAcceptedWordsPerDay: 100,
        deepCompletesPerMonth: 10,
        personalDeviceLimit: 1,
        continuousMemoryExtraction: false,
        customWritingInstructions: false,
        modelCatalogAccess: false,
      },
      trial: {
        active: false,
        startedAt: "2026-01-01T00:00:00.000Z",
        endsAt: "2026-01-31T00:00:00.000Z",
      },
      localAcceptedWords: {
        used: 0,
        limit: 100,
        remaining: 100,
        resetAt: "2026-07-13T00:00:00.000Z",
        exhausted: false,
      },
      deepCompletes: {
        used: deepUsed,
        limit: 10,
        remaining: Math.max(0, 10 - deepUsed),
        resetAt: "2026-08-01T00:00:00.000Z",
        exhausted: deepUsed >= 10,
      },
      devices: { active: 1, limit: 1, canLink: false },
      upgradeUrl: "/pricing",
    },
  };
}

describe("desktop status service", () => {
  it("reports sign_in_required when no authorization header is available", async () => {
    const events: StatusEvent[] = [];
    const service = createDesktopStatusService({
      apiBaseUrl: "http://localhost:8787",
      getAuthorizationObservation: async () => authorizationObservation(null),
      isCredentialGenerationCurrent: acceptCredentialGeneration,
      publishIfCredentialGenerationCurrent: publishCredentialGeneration,
      onChange: (status) => events.push({ type: "changed", status }),
    });

    await service.refresh();

    expect(events).toHaveLength(1);
    expect(events[0].status.auth).toBe("sign_in_required");
    expect(events[0].status.connectivity).toBe("online");
    expect(events[0].status.entitlement).toBeNull();
  });

  it("reports signed_in with independent allowances when the API returns status", async () => {
    const events: StatusEvent[] = [];
    const service = createDesktopStatusService({
      apiBaseUrl: "http://localhost:8787",
      getAuthorizationObservation: async () => authorizationObservation("Bearer token"),
      isCredentialGenerationCurrent: acceptCredentialGeneration,
      publishIfCredentialGenerationCurrent: publishCredentialGeneration,
      fetch: makeFetch([
        () =>
          new Response(
            JSON.stringify({
              status: "ok",
              data: statusPayload(5),
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
    expect(events[0].status.entitlement?.deepCompletes.used).toBe(5);
    expect(events[0].status.entitlement?.localAcceptedWords.used).toBe(0);
  });

  it("reports revoked_device when the API returns a revoked_device error", async () => {
    const events: StatusEvent[] = [];
    const service = createDesktopStatusService({
      apiBaseUrl: "http://localhost:8787",
      getAuthorizationObservation: async () => authorizationObservation("Bearer token"),
      isCredentialGenerationCurrent: acceptCredentialGeneration,
      publishIfCredentialGenerationCurrent: publishCredentialGeneration,
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
      isCredentialGenerationCurrent: acceptCredentialGeneration,
      publishIfCredentialGenerationCurrent: publishCredentialGeneration,
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

  it("reports Deep Complete exhaustion without a global status", async () => {
    const events: StatusEvent[] = [];
    const service = createDesktopStatusService({
      apiBaseUrl: "http://localhost:8787",
      getAuthorizationObservation: async () => authorizationObservation("Bearer token"),
      isCredentialGenerationCurrent: acceptCredentialGeneration,
      publishIfCredentialGenerationCurrent: publishCredentialGeneration,
      fetch: makeFetch([
        () =>
          new Response(
            JSON.stringify({
              status: "ok",
              data: statusPayload(10),
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ]),
      onChange: (status) => events.push({ type: "changed", status }),
    });

    await service.refresh();

    expect(events[0].status.auth).toBe("signed_in");
    expect(events[0].status.entitlement?.deepCompletes.exhausted).toBe(true);
    expect(events[0].status.entitlement?.localAcceptedWords.exhausted).toBe(false);
  });

  it("reports offline when the network request throws", async () => {
    const events: StatusEvent[] = [];
    const service = createDesktopStatusService({
      apiBaseUrl: "http://localhost:8787",
      getAuthorizationObservation: async () => authorizationObservation("Bearer token"),
      isCredentialGenerationCurrent: acceptCredentialGeneration,
      publishIfCredentialGenerationCurrent: publishCredentialGeneration,
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

  it("uses a cached Pro entitlement on an offline cold start", async () => {
    const events: StatusEvent[] = [];
    const cached = BillingStatusDataSchema.parse({
      ...statusPayload(0).entitlement,
      planId: "pro",
      entitlementSource: "trial",
      capabilities: {
        localAcceptedWordsPerDay: null,
        deepCompletesPerMonth: 300,
        personalDeviceLimit: 3,
        continuousMemoryExtraction: true,
        customWritingInstructions: true,
        modelCatalogAccess: true,
      },
      trial: {
        active: true,
        startedAt: "2026-07-01T00:00:00.000Z",
        endsAt: "2026-07-31T00:00:00.000Z",
      },
      localAcceptedWords: {
        ...statusPayload(0).entitlement.localAcceptedWords,
        limit: null,
        remaining: null,
      },
      deepCompletes: {
        ...statusPayload(0).entitlement.deepCompletes,
        limit: 300,
        remaining: 300,
      },
      devices: { active: 1, limit: 3, canLink: true },
      upgradeUrl: undefined,
    });
    const service = createDesktopStatusService({
      apiBaseUrl: "http://localhost:8787",
      now: () => new Date("2026-07-12T12:00:00.000Z"),
      getCachedEntitlement: () => ({ userId: "user-1", entitlement: cached }),
      getAuthorizationObservation: async () =>
        authorizationObservation("Bearer token"),
      isCredentialGenerationCurrent: acceptCredentialGeneration,
      publishIfCredentialGenerationCurrent: publishCredentialGeneration,
      fetch: async () => {
        throw new Error("offline");
      },
      onChange: (status) => events.push({ type: "changed", status }),
    });

    await service.refresh();

    expect(events[0].status.auth).toBe("signed_in");
    expect(events[0].status.connectivity).toBe("offline");
    expect(
      events[0].status.entitlement?.capabilities.localAcceptedWordsPerDay,
    ).toBeNull();
  });

  it("resets cached local usage when a new local day starts offline", async () => {
    let currentTime = new Date(2026, 6, 12, 12);
    const cached = BillingStatusDataSchema.parse({
      ...statusPayload(0).entitlement,
      localAcceptedWords: {
        period: "2026-07-12",
        used: 75,
        limit: 100,
        remaining: 25,
        resetAt: new Date(2026, 6, 13).toISOString(),
        exhausted: false,
      },
    });
    const service = createDesktopStatusService({
      apiBaseUrl: "http://localhost:8787",
      now: () => currentTime,
      getCachedEntitlement: () => ({ userId: "user-1", entitlement: cached }),
      getAuthorizationObservation: async () =>
        authorizationObservation("Bearer token"),
      isCredentialGenerationCurrent: acceptCredentialGeneration,
      publishIfCredentialGenerationCurrent: publishCredentialGeneration,
      fetch: async () => {
        throw new Error("offline");
      },
    });

    currentTime = new Date(2026, 6, 13, 12);
    const status = await service.refresh();

    expect(status.entitlement?.localAcceptedWords).toMatchObject({
      period: "2026-07-13",
      used: 0,
      limit: 100,
      remaining: 100,
      exhausted: false,
    });
    expect(status.entitlement?.localAcceptedWords.resetAt).toBe(
      new Date(2026, 6, 14).toISOString(),
    );
  });

  it("resets cached Deep Complete usage when a new UTC month starts offline", async () => {
    const cached = BillingStatusDataSchema.parse({
      ...statusPayload(0).entitlement,
      deepCompletes: {
        period: "2026-06",
        used: 10,
        limit: 10,
        remaining: 0,
        resetAt: "2026-07-01T00:00:00.000Z",
        exhausted: true,
      },
    });
    const service = createDesktopStatusService({
      apiBaseUrl: "http://localhost:8787",
      now: () => new Date("2026-07-01T00:30:00.000Z"),
      getCachedEntitlement: () => ({ userId: "user-1", entitlement: cached }),
      getAuthorizationObservation: async () =>
        authorizationObservation("Bearer token"),
      isCredentialGenerationCurrent: acceptCredentialGeneration,
      publishIfCredentialGenerationCurrent: publishCredentialGeneration,
      fetch: async () => {
        throw new Error("offline");
      },
    });

    const status = await service.refresh();

    expect(status.entitlement?.deepCompletes).toEqual({
      period: "2026-07",
      used: 0,
      limit: 10,
      remaining: 10,
      resetAt: "2026-08-01T00:00:00.000Z",
      exhausted: false,
    });
  });

  it("expires a cached Pro trial while offline", async () => {
    const cached = BillingStatusDataSchema.parse({
      ...statusPayload(0).entitlement,
      planId: "pro",
      entitlementSource: "trial",
      capabilities: {
        localAcceptedWordsPerDay: null,
        deepCompletesPerMonth: 300,
        personalDeviceLimit: 3,
        continuousMemoryExtraction: true,
        customWritingInstructions: true,
        modelCatalogAccess: true,
      },
      trial: {
        active: true,
        startedAt: "2026-06-01T00:00:00.000Z",
        endsAt: "2026-07-01T00:00:00.000Z",
      },
      localAcceptedWords: {
        ...statusPayload(0).entitlement.localAcceptedWords,
        limit: null,
        remaining: null,
      },
      deepCompletes: {
        ...statusPayload(0).entitlement.deepCompletes,
        limit: 300,
        remaining: 300,
      },
      devices: { active: 1, limit: 3, canLink: true },
      upgradeUrl: undefined,
    });
    const service = createDesktopStatusService({
      apiBaseUrl: "http://localhost:8787",
      now: () => new Date("2026-07-12T12:00:00.000Z"),
      getCachedEntitlement: () => ({ userId: "user-1", entitlement: cached }),
      getAuthorizationObservation: async () =>
        authorizationObservation("Bearer token"),
      isCredentialGenerationCurrent: acceptCredentialGeneration,
      publishIfCredentialGenerationCurrent: publishCredentialGeneration,
      fetch: async () => {
        throw new Error("offline");
      },
    });

    const status = await service.refresh();

    expect(status.entitlement?.planId).toBe("free");
    expect(status.entitlement?.entitlementSource).toBe("free");
    expect(status.entitlement?.localAcceptedWords.limit).toBe(100);
    expect(status.entitlement?.deepCompletes.limit).toBe(10);
  });

  it("does not surface transient failures in the overlay-focused status", async () => {
    const events: StatusEvent[] = [];
    const service = createDesktopStatusService({
      apiBaseUrl: "http://localhost:8787",
      getAuthorizationObservation: async () => authorizationObservation("Bearer token"),
      isCredentialGenerationCurrent: acceptCredentialGeneration,
      publishIfCredentialGenerationCurrent: publishCredentialGeneration,
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
      isCredentialGenerationCurrent: acceptCredentialGeneration,
      publishIfCredentialGenerationCurrent: publishCredentialGeneration,
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

  it("suppresses delayed results from a replaced credential generation", async () => {
    const requestGeneration = generation(21);
    const replacementGeneration = generation(22);
    const staleResponses = [
      () => Response.json(
        {
          status: "error",
          error: { code: "revoked_device", message: "This device has been revoked." },
        },
        { status: 401 },
      ),
      () => Response.json(
        {
          status: "error",
          error: { code: "unauthenticated", message: "Invalid device token." },
        },
        { status: 401 },
      ),
      () => new Response("unavailable", { status: 503 }),
      () => Response.json({
        status: "ok",
        data: { authenticated: true, deviceRevoked: false },
      }),
    ];

    for (const createResponse of staleResponses) {
      let currentGeneration = requestGeneration;
      let requestAuthorization: string | null = null;
      const fetchStarted = createDeferred<void>();
      const response = createDeferred<Response>();
      const events: DesktopStatus[] = [];
      const service = createDesktopStatusService({
        apiBaseUrl: "http://localhost:8787",
        getAuthorizationObservation: async () =>
          authorizationObservation("Bearer token-a", requestGeneration),
        isCredentialGenerationCurrent: async (observedGeneration) =>
          observedGeneration === currentGeneration,
        publishIfCredentialGenerationCurrent: async (observedGeneration, publish) => {
          if (observedGeneration !== currentGeneration) return false;
          publish();
          return true;
        },
        fetch: async (_input, init) => {
          requestAuthorization = new Headers(init?.headers).get("Authorization");
          fetchStarted.resolve();
          return response.promise;
        },
        onChange: (status) => events.push(status),
      });

      const refresh = service.refresh();
      await fetchStarted.promise;
      currentGeneration = replacementGeneration;
      response.resolve(createResponse());
      const status = await refresh;

      expect(requestAuthorization).toBe("Bearer token-a");
      expect(events).toHaveLength(0);
      expect(status).toBe(service.getCurrentStatus());
      expect(status.lastUpdatedAt).toBeNull();
    }
  });

  it("publishes token-A status before a token-B store queued behind its final guard", async () => {
    let token: string | null = "token-a";
    const operations: string[] = [];
    const exchangeBody = createDeferred<unknown>();
    const exchangeReadStarted = createDeferred<void>();
    const authClient = createDesktopAuthClient({
      apiBaseUrl: "http://localhost:8787",
      webBaseUrl: "http://localhost:3000",
      deviceId: "desktop-device-publication-order",
      appVersion: "0.0.1",
      platform: "darwin",
      keychain: {
        set: async (_service, _account, value) => {
          token = value;
          operations.push(`store:${value}`);
        },
        get: async () => token,
        remove: async () => {
          token = null;
        },
      },
      fetch: async () => ({
        ok: true,
        json: () => {
          exchangeReadStarted.resolve();
          return exchangeBody.promise;
        },
      }) as Response,
    });
    const replacement = authClient.handleCallback("tab://auth/callback?code=replace");
    await exchangeReadStarted.promise;
    const service = createDesktopStatusService({
      apiBaseUrl: "http://localhost:8787",
      getAuthorizationObservation: () => authClient.getAuthorizationObservation(),
      isCredentialGenerationCurrent: (credentialGeneration) =>
        authClient.isCredentialGenerationCurrent(credentialGeneration),
      publishIfCredentialGenerationCurrent: (credentialGeneration, publish) => {
        const publication = authClient.publishIfCredentialGenerationCurrent(
          credentialGeneration,
          publish,
        );
        exchangeBody.resolve({ token: "token-b" });
        return publication;
      },
      fetch: async () => Response.json(
        {
          status: "error",
          error: { code: "revoked_device", message: "This device has been revoked." },
        },
        { status: 401 },
      ),
      onChange: (status) => {
        operations.push(`publish:${token}:${status.auth}`);
      },
    });

    const status = await service.refresh();
    await replacement;

    expect(status.auth).toBe("revoked_device");
    expect(operations).toEqual([
      "publish:token-a:revoked_device",
      "store:token-b",
    ]);
    expect(await authClient.getToken()).toBe("token-b");
  });

  it("keeps a newer same-generation refresh when an older response arrives last", async () => {
    const credentialGeneration = generation(23);
    const firstFetchStarted = createDeferred<void>();
    const secondFetchStarted = createDeferred<void>();
    const firstResponse = createDeferred<Response>();
    const secondResponse = createDeferred<Response>();
    const events: Array<{
      status: DesktopStatus;
      credentialGeneration: CredentialGeneration | null;
    }> = [];
    let fetchCount = 0;
    const service = createDesktopStatusService({
      apiBaseUrl: "http://localhost:8787",
      getAuthorizationObservation: async () =>
        authorizationObservation("Bearer token", credentialGeneration),
      isCredentialGenerationCurrent: acceptCredentialGeneration,
      publishIfCredentialGenerationCurrent: publishCredentialGeneration,
      fetch: async () => {
        fetchCount += 1;
        if (fetchCount === 1) {
          firstFetchStarted.resolve();
          return firstResponse.promise;
        }
        secondFetchStarted.resolve();
        return secondResponse.promise;
      },
      onChange: (status, observedGeneration) => {
        events.push({ status, credentialGeneration: observedGeneration });
      },
    });

    const olderRefresh = service.refresh();
    await firstFetchStarted.promise;
    const newerRefresh = service.refresh();
    await secondFetchStarted.promise;
    secondResponse.resolve(Response.json({
      status: "ok",
       data: statusPayload(2),
    }));
    const newerStatus = await newerRefresh;
    firstResponse.resolve(Response.json({
      status: "ok",
       data: statusPayload(1),
    }));
    const olderStatus = await olderRefresh;

    expect(events).toHaveLength(1);
    expect(events[0].credentialGeneration).toBe(credentialGeneration);
    expect(events[0].status.entitlement?.deepCompletes.used).toBe(2);
    expect(olderStatus).toBe(newerStatus);
    expect(service.getCurrentStatus()).toBe(newerStatus);
    expect(Object.keys(events[0].status).sort()).toEqual([
      "auth",
      "connectivity",
      "entitlement",
      "lastUpdatedAt",
      "overlay",
      "userId",
    ]);
  });

  it("does not emit an observation error from a superseded refresh", async () => {
    const credentialGeneration = generation(24);
    const firstObservation = createDeferred<ReturnType<typeof authorizationObservation>>();
    const observationError = new Error("keychain unavailable");
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    const events: DesktopStatus[] = [];
    let observationCount = 0;
    const service = createDesktopStatusService({
      apiBaseUrl: "http://localhost:8787",
      getAuthorizationObservation: async () => {
        observationCount += 1;
        if (observationCount === 1) return firstObservation.promise;
        return authorizationObservation(null, credentialGeneration);
      },
      isCredentialGenerationCurrent: acceptCredentialGeneration,
      publishIfCredentialGenerationCurrent: publishCredentialGeneration,
      onChange: (status) => events.push(status),
    });

    try {
      const olderRefresh = service.refresh();
      const newerStatus = await service.refresh();
      firstObservation.reject(observationError);
      const olderStatus = await olderRefresh;

      expect(events).toEqual([newerStatus]);
      expect(olderStatus).toBe(newerStatus);
      expect(errorLog).not.toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }
  });
});
