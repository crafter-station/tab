import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { ApiVariables } from "../apps/api/src/api-types.ts";
import type { AuthInstance, AuthSession } from "../apps/api/src/auth.ts";
import { createSessionAuthenticator } from "../apps/api/src/http/auth.ts";

function appWithSession(session: AuthSession | null) {
  const app = new Hono<{ Variables: ApiVariables }>();
  const auth = {
    api: {
      getSession: async () => session,
    },
  } as unknown as AuthInstance;
  app.use("/protected", createSessionAuthenticator(auth));
  app.get("/protected", (c) => c.json({ userId: c.get("session").user.id }));
  return app;
}

describe("API session authentication", () => {
  it("rejects requests before a protected handler runs", async () => {
    const response = await appWithSession(null).request("/protected");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      status: "error",
      error: { code: "unauthenticated", message: "Sign in required." },
    });
  });

  it("makes the verified session available to protected handlers", async () => {
    const session = {
      session: { id: "session-1" },
      user: { id: "user-1" },
    } as AuthSession;
    const response = await appWithSession(session).request("/protected");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ userId: "user-1" });
  });
});
