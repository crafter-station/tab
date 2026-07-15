import { describe, expect, it } from "bun:test";
import {
  createPackagedAuthCallback,
  createLoopbackAuthCallback,
  findAuthCallbackUrl,
  isAuthCallbackUrl,
  startLoopbackAuthCallbackServer,
} from "../apps/desktop/src/main/auth-callback.ts";

describe("desktop auth callback delivery", () => {
  it("matches only the expected packaged callback", () => {
    const expected = "tab://auth/callback";
    const callback = "tab://auth/callback?code=one-time";

    expect(isAuthCallbackUrl(callback, expected)).toBe(true);
    expect(isAuthCallbackUrl("tab://other/callback?code=one-time", expected)).toBe(false);
    expect(isAuthCallbackUrl("tab://auth/other?code=one-time", expected)).toBe(false);
    expect(isAuthCallbackUrl("tab://auth/callback", expected)).toBe(false);
    expect(findAuthCallbackUrl(["electron", "--flag", callback], expected)).toBe(callback);
  });

  it("queues, deduplicates, and recovers packaged callbacks through activation", () => {
    const expected = "tab://auth/callback";
    const queued = "tab://auth/callback?code=queued";
    const startup = "tab://auth/callback?code=startup";
    const received: string[] = [];
    const callback = createPackagedAuthCallback({
      expectedCallbackUrl: expected,
      onCallback: async (url) => {
        received.push(url);
      },
    });

    expect(callback.dispatch("tab://auth/other?code=ignored")).toBe(false);
    expect(callback.dispatch(queued)).toBe(true);
    expect(callback.dispatch(queued)).toBe(true);
    expect(received).toEqual([]);

    callback.activate(["Tab", startup]);

    expect(received).toEqual([startup, queued]);
    expect(callback.dispatch(startup)).toBe(true);
    expect(received).toEqual([startup, queued]);
  });

  it("routes packaged callback failures through the adapter", async () => {
    const errors: unknown[] = [];
    const callback = createPackagedAuthCallback({
      expectedCallbackUrl: "tab://auth/callback",
      onCallback: async () => {
        throw new Error("exchange failed");
      },
      onError: (error) => errors.push(error),
    });
    callback.activate([]);

    callback.dispatch("tab://auth/callback?code=one-time");
    await Promise.resolve();

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
  });

  it("receives callbacks only on the loopback callback path", async () => {
    const received: string[] = [];
    const server = await startLoopbackAuthCallbackServer({
      onCallback: async (url) => {
        received.push(url);
      },
    });

    try {
      expect(server.callbackUrl).toStartWith("http://127.0.0.1:");
      expect((await fetch(new URL("/other", server.callbackUrl))).status).toBe(404);
      expect((await fetch(server.callbackUrl)).status).toBe(400);

      const response = await fetch(`${server.callbackUrl}?code=one-time`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("Signed in to Tab");
      expect(received).toEqual([`${server.callbackUrl}?code=one-time`]);
    } finally {
      await server.close();
    }
  });

  it("provides one reusable loopback callback for desktop sign-in", async () => {
    const received: string[] = [];
    const callback = createLoopbackAuthCallback({
      onCallback: async (url) => {
        received.push(url);
      },
    });

    try {
      const callbackUrl = await callback.getCallbackUrl();
      expect(callbackUrl).toStartWith("http://127.0.0.1:");
      expect(await callback.getCallbackUrl()).toBe(callbackUrl);

      const response = await fetch(`${callbackUrl}?code=packaged-sign-in`);
      expect(response.status).toBe(200);
      expect(received).toEqual([`${callbackUrl}?code=packaged-sign-in`]);
    } finally {
      await callback.close();
    }
  });
});
