import { describe, expect, it } from "bun:test";
import { createApiClient, readApiError } from "../apps/web/src/lib/api.server.ts";
import {
  handleCheckout,
  handleDeviceRevoke,
  handleForgotPassword,
  handleLogin,
  handleLogout,
  handleMemoryBulkDelete,
  handleMemoryCreate,
  handleMemoryExport,
  handleResetPassword,
  handleResendVerification,
  handleSignup,
  handleVerifyEmail,
} from "../apps/web/src/lib/actions.server.ts";
import { loadDashboardData } from "../apps/web/src/lib/dashboard.server.ts";

const WEB_ORIGIN = "http://localhost:3000";
const API_ORIGIN = "http://localhost:8787";
const session = { user: { id: "user-1", name: "Test User", email: "test@example.com", emailVerified: true } };

function json(body: unknown, init: ResponseInit = {}) {
  return Response.json(body, init);
}

function createFakeApi(overrides: Record<string, (request: Request) => Response | Promise<Response>> = {}) {
  const requests: Request[] = [];
  const routes: Record<string, (request: Request) => Response | Promise<Response>> = {
    "GET /api/auth/get-session": () => json(session),
    "POST /api/auth/sign-in/email": () => json(session, { headers: { "set-cookie": "tab.session=abc; Path=/; HttpOnly" } }),
    "POST /api/auth/sign-out": () => json({ ok: true }, { headers: { "set-cookie": "tab.session=; Path=/; Max-Age=0" } }),
    "POST /api/auth/device/authorize": () => json({ code: "device-code" }),
    "GET /api/auth/verify-email": (request) => {
      const callbackURL = new URL(request.url).searchParams.get("callbackURL")!;
      return new Response(null, {
        status: 302,
        headers: { location: callbackURL, "set-cookie": "tab.session=verified; Path=/; HttpOnly" },
      });
    },
    "POST /api/auth/send-verification-email": () => json({ status: true }),
    "GET /api/billing/checkout?plan=pro&interval=monthly": () => json({ status: "ok", data: { url: "https://checkout.example/pro" } }),
    "POST /api/auth/device/revoke": () => json({ status: "ok" }),
    "POST /api/account/memory": () => json({ status: "ok" }),
    "DELETE /api/account/memory/memory-1": () => json({ status: "ok", data: { deleted: true } }),
    "GET /api/account/memory/export": () => json({ status: "ok", data: { exportedAt: "2026-07-13T00:00:00.000Z", memories: [] } }),
    "GET /api/billing/status": () => json({
      status: "ok",
      data: {
        planId: "free", entitlementSource: "free",
        capabilities: { localAcceptedWordsPerDay: 100, deepCompletesPerMonth: 10, personalDeviceLimit: 1, continuousMemoryExtraction: false, customWritingInstructions: false, modelCatalogAccess: false },
        trial: { active: false },
        localAcceptedWords: { used: 0, limit: 100, remaining: 100, resetAt: "2026-07-14T00:00:00.000Z", exhausted: false },
        deepCompletes: { used: 0, limit: 10, remaining: 10, resetAt: "2026-08-01T00:00:00.000Z", exhausted: false },
        devices: { active: 0, limit: 1, canLink: true },
      },
    }),
    "GET /api/auth/devices": () => json({ status: "ok", data: { devices: [] } }),
    "GET /api/account/memory": () => json({ status: "ok", data: { memories: [] } }),
    "GET /api/activity/local-suggestions": () => json({ status: "ok", data: { acceptedSuggestions: 0, acceptedWords: 0, acceptedCharacters: 0, activeWritingDays: 0, averageAcceptanceLatencyMs: null } }),
    ...overrides,
  };
  const api = createApiClient({
    apiBaseUrl: API_ORIGIN,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      const url = new URL(request.url);
      const route = routes[`${request.method} ${url.pathname}${url.search}`] ?? routes[`${request.method} ${url.pathname}`];
      return route ? route(request) : new Response("missing fake route", { status: 500 });
    },
  });
  return { api, requests };
}

function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("cookie")) headers.set("cookie", "tab.session=abc");
  return new Request(`${WEB_ORIGIN}${path}`, { ...init, headers });
}

describe("TanStack Start web BFF module contracts", () => {
  it("forwards the web origin and relays all sign-in cookies with 303 PRG", async () => {
    const { api, requests } = createFakeApi();
    const response = await handleLogin(request("/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: "test@example.com", password: "password123", next: "/dashboard/usage" }),
    }), api);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/dashboard/usage");
    expect(response.headers.get("set-cookie")).toContain("tab.session=abc");
    expect(requests.at(-1)?.headers.get("origin")).toBe(WEB_ORIGIN);
  });

  it("preserves the intended destination when sign-in resends verification", async () => {
    const { api, requests } = createFakeApi({
      "POST /api/auth/sign-in/email": () => json(
        { code: "EMAIL_NOT_VERIFIED", message: "Email not verified" },
        { status: 403 },
      ),
    });
    const response = await handleLogin(request("/login", {
      method: "POST",
      body: new URLSearchParams({
        email: "test@example.com",
        password: "password123",
        next: "/dashboard/usage",
      }),
    }), api);

    const callbackURL = new URL(String((await requests.at(-1)?.json() as { callbackURL: string }).callbackURL));
    expect(callbackURL.origin).toBe(WEB_ORIGIN);
    expect(callbackURL.pathname).toBe("/login");
    expect(callbackURL.searchParams.get("next")).toBe("/dashboard/usage");
    expect(callbackURL.searchParams.get("verification_state")).toBeTruthy();
    expect(response.headers.get("location")).toContain("/verify-email?status=sent");
  });

  it("relays automatic sign-in cookies from email verification", async () => {
    const { api } = createFakeApi();
    const callbackURL = `${WEB_ORIGIN}/signup?next=%2Fdashboard%2Fusage&verification_state=test-state`;
    const response = await handleVerifyEmail(request(`/verify-email/confirm?${new URLSearchParams({
      token: "verification-token",
      callbackURL,
    })}`, { headers: { cookie: "tab.verification_state=test-state" } }), api);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/signup?next=%2Fdashboard%2Fusage");
    expect(response.headers.get("set-cookie")).toContain("tab.session=verified");
    expect(response.headers.get("set-cookie")).toContain("tab.verification_state=");
  });

  it("does not auto-sign in a different browser that opens the verification link", async () => {
    const { api } = createFakeApi();
    const callbackURL = `${WEB_ORIGIN}/signup?verification_state=originating-browser`;
    const response = await handleVerifyEmail(request(`/verify-email/confirm?${new URLSearchParams({
      token: "forwarded-token",
      callbackURL,
    })}`), api);

    expect(response.headers.get("location")).toBe("/login?status=email_verified");
    expect(response.headers.get("set-cookie") ?? "").not.toContain("tab.session=verified");
  });

  it("turns expired verification links into a recoverable resend flow", async () => {
    const callbackURL = `${WEB_ORIGIN}/login?device_id=mac-1&callback=${encodeURIComponent("tab://auth/callback")}&verification_state=expired-state`;
    const { api } = createFakeApi({
      "GET /api/auth/verify-email": (upstreamRequest) => {
        const callback = new URL(upstreamRequest.url).searchParams.get("callbackURL")!;
        return new Response(null, { status: 302, headers: { location: `${callback}&error=token_expired` } });
      },
    });
    const response = await handleVerifyEmail(request(`/verify-email/confirm?${new URLSearchParams({
      token: "expired-token",
      callbackURL,
    })}`), api);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("/verify-email?error=expired");
    expect(response.headers.get("location")).toContain("callbackURL=");
  });

  it("falls back to the canonical sign-in when verification cannot create a session", async () => {
    const callbackURL = `${WEB_ORIGIN}/signup?device_id=mac-1&callback=${encodeURIComponent("tab://auth/callback")}&verification_state=used-state`;
    const { api } = createFakeApi({
      "GET /api/auth/verify-email": () => new Response(null, { status: 302, headers: { location: callbackURL } }),
    });
    const response = await handleVerifyEmail(request(`/verify-email/confirm?${new URLSearchParams({
      token: "already-used-token",
      callbackURL,
    })}`), api);

    expect(response.headers.get("location")).toBe("/login?device_id=mac-1&callback=tab%3A%2F%2Fauth%2Fcallback&status=email_verified");
  });

  it("keeps desktop handoff context when authorization fails after verification", async () => {
    const callbackURL = `${WEB_ORIGIN}/signup?device_id=mac-1&callback=${encodeURIComponent("tab://auth/callback")}&verification_state=desktop-state`;
    const { api } = createFakeApi({
      "POST /api/auth/device/authorize": () => json({ error: "unavailable" }, { status: 503 }),
    });
    const response = await handleVerifyEmail(request(`/verify-email/confirm?${new URLSearchParams({
      token: "verification-token",
      callbackURL,
    })}`, { headers: { cookie: "tab.verification_state=desktop-state" } }), api);

    expect(response.headers.get("location")).toContain("/verify-email?error=device_failed");
    expect(response.headers.get("location")).toContain("callbackURL=");
  });

  it("resends verification through Better Auth without losing continuation state", async () => {
    const callbackURL = `${WEB_ORIGIN}/login?next=%2Fdashboard%2Fusage`;
    const { api, requests } = createFakeApi();
    const response = await handleResendVerification(request("/verify-email", {
      method: "POST",
      body: new URLSearchParams({ email: "test@example.com", callbackURL }),
    }), api);

    const body = await requests.at(-1)?.json() as { email: string; callbackURL: string };
    const statefulCallback = new URL(body.callbackURL);
    expect(body.email).toBe("test@example.com");
    expect(statefulCallback.pathname).toBe("/login");
    expect(statefulCallback.searchParams.get("next")).toBe("/dashboard/usage");
    expect(statefulCallback.searchParams.get("verification_state")).toBeTruthy();
    expect(response.headers.get("location")).toContain("/verify-email?status=sent");
    expect(response.headers.get("set-cookie")).toContain("tab.verification_state=");
  });

  it("rejects unsafe next paths without putting passwords in redirect URLs", async () => {
    const { api } = createFakeApi();
    const response = await handleLogin(request("/login", {
      method: "POST",
      body: new URLSearchParams({ email: "test@example.com", password: "secret-password", next: "//evil.example" }),
    }), api);
    expect(response.headers.get("location")).toBe("/dashboard");
    expect(response.headers.get("location")).not.toContain("secret-password");
  });

  it("relays cookies from failed auth and password-reset outcomes", async () => {
    const cookie = (name: string) => {
      const headers = new Headers();
      headers.append("set-cookie", `${name}=value; Path=/; HttpOnly`);
      headers.append("set-cookie", `${name}.csrf=value; Path=/; SameSite=Lax`);
      return json(
        { status: "error", error: { code: "failed", message: "Failed" } },
        { status: 400, headers },
      );
    };
    const { api } = createFakeApi({
      "POST /api/auth/sign-in/email": () => cookie("login.failure"),
      "POST /api/auth/sign-up/email": () => cookie("signup.failure"),
      "POST /api/auth/request-password-reset": () => cookie("forgot.failure"),
      "POST /api/auth/reset-password": () => cookie("reset.failure"),
    });

    const login = await handleLogin(request("/login", {
      method: "POST",
      body: new URLSearchParams({ email: "test@example.com", password: "wrong" }),
    }), api);
    const signup = await handleSignup(request("/signup", {
      method: "POST",
      body: new URLSearchParams({ name: "Test", email: "test@example.com", password: "password123" }),
    }), api);
    const forgot = await handleForgotPassword(request("/forgot-password", {
      method: "POST",
      body: new URLSearchParams({ email: "test@example.com" }),
    }), api);
    const reset = await handleResetPassword(request("/reset-password", {
      method: "POST",
      body: new URLSearchParams({ token: "reset-token", password: "password123" }),
    }), api);

    expect(login.headers.get("set-cookie")).toContain("login.failure=value");
    expect(login.headers.get("set-cookie")).toContain("login.failure.csrf=value");
    expect(signup.headers.get("set-cookie")).toContain("signup.failure=value");
    expect(signup.headers.get("set-cookie")).toContain("signup.failure.csrf=value");
    expect(forgot.headers.get("set-cookie")).toContain("forgot.failure=value");
    expect(forgot.headers.get("set-cookie")).toContain("forgot.failure.csrf=value");
    expect(reset.headers.get("set-cookie")).toContain("reset.failure=value");
    expect(reset.headers.get("set-cookie")).toContain("reset.failure.csrf=value");
  });

  it("preserves the desktop handoff and returns the authorization code", async () => {
    const { api } = createFakeApi();
    const response = await handleLogin(request("/login", {
      method: "POST",
      body: new URLSearchParams({ email: "test@example.com", password: "password123", device_id: "mac-1", callback: "tab://auth/callback" }),
    }), api);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("tab://auth/callback?code=device-code");
  });

  it("returns development desktop handoffs to the loopback callback server", async () => {
    const { api } = createFakeApi();
    const callback = "http://127.0.0.1:43123/auth/callback";
    const response = await handleLogin(request("/login", {
      method: "POST",
      body: new URLSearchParams({
        email: "test@example.com",
        password: "password123",
        device_id: "mac-1",
        callback,
      }),
    }), api);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${callback}?code=device-code`);
  });

  it("rejects non-loopback HTTP desktop callbacks", async () => {
    const { api } = createFakeApi();
    const response = await handleLogin(request("/login", {
      method: "POST",
      body: new URLSearchParams({
        email: "test@example.com",
        password: "password123",
        device_id: "mac-1",
        callback: "http://example.com/auth/callback",
      }),
    }), api);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?error=device_failed");
  });

  it("relays sign-in and device cookies when device authorization fails", async () => {
    const { api } = createFakeApi({
      "POST /api/auth/device/authorize": () => json(
        { status: "error", error: { code: "device_failed", message: "Failed" } },
        { status: 503, headers: { "set-cookie": "device.failure=value; Path=/; HttpOnly" } },
      ),
    });
    const response = await handleLogin(request("/login", {
      method: "POST",
      body: new URLSearchParams({ email: "test@example.com", password: "password123", device_id: "mac-1", callback: "tab://auth/callback" }),
    }), api);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?error=device_failed");
    expect(response.headers.get("set-cookie")).toContain("tab.session=abc");
    expect(response.headers.get("set-cookie")).toContain("device.failure=value");
  });

  it("normalizes checkout to monthly and forwards the session cookie", async () => {
    const { api, requests } = createFakeApi();
    const response = await handleCheckout(request("/billing/checkout?plan=pro&interval=annual"), api);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://checkout.example/pro");
    expect(requests.at(-1)?.url).toContain("interval=monthly");
    expect(requests.at(-1)?.headers.get("cookie")).toBe("tab.session=abc");
  });

  it("surfaces Plan Change failures without starting another checkout", async () => {
    const { api } = createFakeApi({
      "GET /api/billing/checkout?plan=max&interval=monthly": () => json({
        status: "error",
        error: { code: "plan_change_required", message: "Use the existing subscription controls." },
      }, { status: 502 }),
    });
    const response = await handleCheckout(request("/billing/checkout?plan=max"), api);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/billing/error?code=plan_change");
  });

  it("preserves structured Worker errors", async () => {
    expect(await readApiError(json({
      status: "error",
      error: { code: "plan_change_required", message: "Change the existing plan." },
    }, { status: 409 }))).toEqual({
      code: "plan_change_required",
      message: "Change the existing plan.",
    });
  });

  it("loads and validates the complete dashboard payload in parallel", async () => {
    const { api } = createFakeApi();
    const data = await loadDashboardData(request("/dashboard"), api);
    expect(data.user.id).toBe("user-1");
    expect(data.billing.planId).toBe("free");
    expect(data.devices).toEqual([]);
    expect(data.memories).toEqual([]);
  });

  it("validates memory writes and uses 303 redirects", async () => {
    const { api, requests } = createFakeApi();
    const response = await handleMemoryCreate(request("/dashboard/memories/create", {
      method: "POST",
      body: new URLSearchParams({ content: "Prefers concise summaries" }),
    }), api);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/dashboard/memories");
    expect(await requests.at(-1)?.json()).toEqual({ content: "Prefers concise summaries" });
  });

  it("requires confirmations for device and bulk-memory deletion", async () => {
    let revokeCalls = 0;
    let deleteCalls = 0;
    const { api } = createFakeApi({
      "POST /api/auth/device/revoke": () => { revokeCalls += 1; return json({ status: "ok" }); },
      "DELETE /api/account/memory/memory-1": () => { deleteCalls += 1; return json({ status: "ok", data: { deleted: true } }); },
    });
    await handleDeviceRevoke(request("/dashboard/devices/mac-1/revoke", { method: "POST", body: new URLSearchParams({ confirm: "wrong" }) }), api, "mac-1");
    await handleMemoryBulkDelete(request("/dashboard/memories/delete-selected", { method: "POST", body: new URLSearchParams({ confirm: "wrong", memoryId: "memory-1" }) }), api);
    expect(revokeCalls).toBe(0);
    expect(deleteCalls).toBe(0);
  });

  it("returns an error for failed mutations and stops bulk delete at the first failure", async () => {
    const deleted: string[] = [];
    const { api } = createFakeApi({
      "POST /api/account/memory": () => json(
        { status: "error", error: { code: "write_failed", message: "Failed" } },
        { status: 503, headers: { "set-cookie": "mutation.failure=value; Path=/" } },
      ),
      "DELETE /api/account/memory/memory-1": () => {
        deleted.push("memory-1");
        return json({ status: "error", error: { code: "delete_failed", message: "Failed" } }, { status: 503 });
      },
      "DELETE /api/account/memory/memory-2": () => {
        deleted.push("memory-2");
        return json({ status: "ok", data: { deleted: true } });
      },
    });
    const createResponse = await handleMemoryCreate(request("/dashboard/memories/create", {
      method: "POST",
      body: new URLSearchParams({ content: "Remember this" }),
    }), api);
    const bulkResponse = await handleMemoryBulkDelete(request("/dashboard/memories/delete-selected", {
      method: "POST",
      body: new URLSearchParams([
        ["confirm", "delete-selected-memories"],
        ["memoryId", "memory-1"],
        ["memoryId", "memory-2"],
      ]),
    }), api);

    expect(createResponse.status).toBe(502);
    expect(createResponse.headers.get("set-cookie")).toContain("mutation.failure=value");
    expect(bulkResponse.status).toBe(502);
    expect(deleted).toEqual(["memory-1"]);
  });

  it("does not report failed device revocation as success", async () => {
    const { api } = createFakeApi({
      "POST /api/auth/device/revoke": () => json(
        { status: "error", error: { code: "revoke_failed", message: "Failed" } },
        { status: 503, headers: { "set-cookie": "device.revoke.failure=value; Path=/" } },
      ),
    });
    const response = await handleDeviceRevoke(request("/dashboard/devices/mac-1/revoke", {
      method: "POST",
      body: new URLSearchParams({ confirm: "mac-1" }),
    }), api, "mac-1");

    expect(response.status).toBe(502);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toContain("device.revoke.failure=value");
  });

  it("preserves each protected action's login redirect and auth cookie", async () => {
    const { api, requests } = createFakeApi({
      "GET /api/auth/get-session": () => json(null, {
        status: 401,
        headers: { "set-cookie": "tab.session=; Path=/; Max-Age=0" },
      }),
    });
    const mutation = await handleMemoryCreate(request("/dashboard/memories/create", {
      method: "POST",
      body: new URLSearchParams({ content: "Remember this" }),
    }), api);
    const checkout = await handleCheckout(request("/billing/checkout?plan=max"), api);

    expect(mutation.status).toBe(303);
    expect(mutation.headers.get("location")).toBe("/login");
    expect(mutation.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(checkout.headers.get("location")).toBe("/login?next=%2Fbilling%2Fcheckout%3Fplan%3Dmax");
    expect(checkout.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(requests.map((upstream) => new URL(upstream.url).pathname)).toEqual([
      "/api/auth/get-session",
      "/api/auth/get-session",
    ]);
  });

  it("returns validated exports with private download headers", async () => {
    const { api } = createFakeApi();
    const response = await handleMemoryExport(request("/dashboard/memories/export"), api);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain("tab-personal-memory.json");
  });

  it("relays the session-clearing cookie on logout", async () => {
    const { api } = createFakeApi();
    const response = await handleLogout(request("/logout", { method: "POST" }), api);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
