import { describe, expect, it } from "bun:test";
import {
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

  it("receives development callbacks only on the loopback callback path", async () => {
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
});
