import { describe, expect, it } from "bun:test";
import { createApiClient, readApiError } from "../apps/web/src/lib/api.server.ts";
import {
  handleCheckout,
  handleDeviceRevoke,
  handleLogin,
  handleLogout,
  handleMemoryBulkDelete,
  handleMemoryCreate,
  handleMemoryExport,
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
      const route = routes[`${request.method} ${url.pathname}${url.search}`];
      return route ? route(request) : new Response("missing fake route", { status: 500 });
    },
  });
  return { api, requests };
}

function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cookie", "tab.session=abc");
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

  it("rejects unsafe next paths without putting passwords in redirect URLs", async () => {
    const { api } = createFakeApi();
    const response = await handleLogin(request("/login", {
      method: "POST",
      body: new URLSearchParams({ email: "test@example.com", password: "secret-password", next: "//evil.example" }),
    }), api);
    expect(response.headers.get("location")).toBe("/dashboard");
    expect(response.headers.get("location")).not.toContain("secret-password");
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
