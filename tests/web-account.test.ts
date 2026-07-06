import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { createApp } from "../apps/api/src/index.ts";
import { createAuthInstance, migrateAuth } from "../apps/api/src/auth.ts";
import { DeviceTokenService } from "../apps/api/src/device-tokens.ts";
import { InMemoryPersonalMemoryStorage } from "../apps/api/src/personal-memory.ts";
import {
  BillingService,
  InMemoryBillingStorage,
  StubBillingCheckoutClient,
} from "../apps/api/src/billing.ts";
import { createWebApp, type WebApp } from "../apps/web/src/index.ts";
import type { Hono } from "hono";

const TEST_ORIGIN = "http://localhost:8787";
const WEB_ORIGIN = "http://localhost:3000";

async function createWebTestEnv() {
  const database = new Database(":memory:");
  const auth = createAuthInstance({ database, baseURL: TEST_ORIGIN });
  await migrateAuth(auth);

  const deviceTokenService = new DeviceTokenService();
  const personalMemoryStorage = new InMemoryPersonalMemoryStorage();
  const billingStorage = new InMemoryBillingStorage();
  const billingService = new BillingService({ storage: billingStorage });
  const billingCheckoutClient = new StubBillingCheckoutClient();

  const apiApp = createApp({
    auth,
    deviceTokenService,
    personalMemoryStorage,
    billingService,
    billingCheckoutClient,
  });

  const webApp = createWebApp({
    apiBaseUrl: TEST_ORIGIN,
    fetch: (input, init) => {
      const url = new URL(
        typeof input === "string" ? input : input.url,
        TEST_ORIGIN,
      );
      return apiApp.request(url.pathname + url.search, init);
    },
  });

  return {
    apiApp,
    webApp,
    auth,
    deviceTokenService,
    personalMemoryStorage,
    billingService,
  };
}

async function signUpUser(
  apiApp: Hono,
  email: string,
  password: string,
): Promise<{ cookie: string; userId: string }> {
  const signUpResponse = await apiApp.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: TEST_ORIGIN,
    },
    body: JSON.stringify({ name: "Test User", email, password }),
  });

  expect(signUpResponse.status).toBe(200);
  const signUpBody = (await signUpResponse.json()) as { user: { id: string } };

  const signInResponse = await apiApp.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: TEST_ORIGIN,
    },
    body: JSON.stringify({ email, password, rememberMe: true }),
  });

  expect(signInResponse.status).toBe(200);
  const cookie = signInResponse.headers.get("set-cookie");
  expect(cookie).toBeTruthy();
  return { cookie: cookie!, userId: signUpBody.user.id };
}

function webRequest(
  webApp: WebApp,
  pathname: string,
  init: RequestInit = {},
  cookie?: string,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie) {
    headers.set("cookie", cookie);
  }

  const request = new Request(`${WEB_ORIGIN}${pathname}`, {
    ...init,
    headers,
  });
  return webApp.fetch(request);
}

async function textIncludes(response: Response, text: string): Promise<string> {
  const body = await response.text();
  expect(body).toInclude(text);
  return body;
}

describe("Web account surface", () => {
  it("renders the marketing and download surface", async () => {
    const { webApp } = await createWebTestEnv();
    const response = await webRequest(webApp, "/");

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toInclude("Native autocomplete for macOS");
    expect(body).toInclude("Download for macOS");
  });

  it("displays pricing with accurate Free, Pro, and Max quotas and prices", async () => {
    const { webApp } = await createWebTestEnv();
    const response = await webRequest(webApp, "/pricing");

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toInclude("Free");
    expect(body).toInclude("Pro");
    expect(body).toInclude("Max");
    expect(body).toInclude("100");
    expect(body).toInclude("1,000");
    expect(body).toInclude("1,000,000");
    expect(body).toInclude("$10/mo");
    expect(body).toInclude("$100/mo");
  });

  it("renders the sign-in entry point", async () => {
    const { webApp } = await createWebTestEnv();
    const response = await webRequest(webApp, "/login");

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toInclude("Sign in");
    expect(body).toInclude('name="email"');
    expect(body).toInclude('name="password"');
  });

  it("signs in through the web form and reaches the account dashboard", async () => {
    const { apiApp, webApp } = await createWebTestEnv();
    const email = `user-${crypto.randomUUID()}@example.com`;
    const password = "password123456";
    await signUpUser(apiApp, email, password);

    const loginResponse = await webRequest(
      webApp,
      "/login",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ email, password }),
      },
    );

    expect(loginResponse.status).toBe(302);
    expect(loginResponse.headers.get("location")).toBe("/account");
    const setCookie = loginResponse.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();

    const accountResponse = await webRequest(webApp, "/account", {}, setCookie!);
    expect(accountResponse.status).toBe(200);
    const body = await accountResponse.text();
    expect(body).toInclude("Monthly usage");
    expect(body).toInclude("Free plan");
    expect(body).toInclude("Manage billing");
  });

  it("redirects to a Polar checkout URL for a paid plan", async () => {
    const { apiApp, webApp } = await createWebTestEnv();
    const email = `user-${crypto.randomUUID()}@example.com`;
    const password = "password123456";
    const { cookie } = await signUpUser(apiApp, email, password);

    const response = await webRequest(
      webApp,
      "/billing/checkout?plan=pro",
      {},
      cookie,
    );

    expect(response.status).toBe(302);
    const location = response.headers.get("location");
    expect(location).toBeTruthy();
    expect(location).toInclude("polar.sh/checkout/pro");
  });

  it("redirects to the Polar customer portal", async () => {
    const { apiApp, webApp } = await createWebTestEnv();
    const email = `user-${crypto.randomUUID()}@example.com`;
    const password = "password123456";
    const { cookie } = await signUpUser(apiApp, email, password);

    const response = await webRequest(webApp, "/billing/portal", {}, cookie);

    expect(response.status).toBe(302);
    const location = response.headers.get("location");
    expect(location).toBeTruthy();
    expect(location).toInclude("polar.sh/portal/");
  });

  it("lists and deletes Personal Memory from the account surface", async () => {
    const { apiApp, webApp, personalMemoryStorage } = await createWebTestEnv();
    const email = `user-${crypto.randomUUID()}@example.com`;
    const password = "password123456";
    const { cookie, userId } = await signUpUser(apiApp, email, password);

    const memory = await personalMemoryStorage.createMemory({
      userId,
      content: "Lives in Portland",
      category: "personal",
      source: "typed_text",
      sensitivity: "normal",
    });

    const accountBefore = await webRequest(webApp, "/account", {}, cookie);
    expect(accountBefore.status).toBe(200);
    await textIncludes(accountBefore, "Lives in Portland");

    const deleteResponse = await webRequest(
      webApp,
      `/account/memory/${memory.id}/delete`,
      { method: "POST" },
      cookie,
    );
    expect(deleteResponse.status).toBe(302);
    expect(deleteResponse.headers.get("location")).toBe(
      "/account?tab=memories",
    );

    const accountAfter = await webRequest(webApp, "/account", {}, cookie);
    expect(accountAfter.status).toBe(200);
    const bodyAfter = await accountAfter.text();
    expect(bodyAfter).not.toInclude("Lives in Portland");
  });

  it("lists and revokes native devices from the account surface", async () => {
    const { apiApp, webApp, deviceTokenService } = await createWebTestEnv();
    const email = `user-${crypto.randomUUID()}@example.com`;
    const password = "password123456";
    const { cookie, userId } = await signUpUser(apiApp, email, password);

    await deviceTokenService.createDeviceToken(userId, {
      deviceId: "macbook-pro-1",
      platform: "darwin",
      appVersion: "0.0.1",
    });

    const accountBefore = await webRequest(webApp, "/account", {}, cookie);
    expect(accountBefore.status).toBe(200);
    const bodyBefore = await accountBefore.text();
    expect(bodyBefore).toInclude("macbook-pro-1");
    expect(bodyBefore).toInclude("Active");

    const revokeResponse = await webRequest(
      webApp,
      "/account/devices/macbook-pro-1/revoke",
      { method: "POST" },
      cookie,
    );
    expect(revokeResponse.status).toBe(302);
    expect(revokeResponse.headers.get("location")).toBe(
      "/account?tab=devices",
    );

    const accountAfter = await webRequest(webApp, "/account", {}, cookie);
    expect(accountAfter.status).toBe(200);
    const bodyAfter = await accountAfter.text();
    expect(bodyAfter).toInclude("Revoked");
  });
});
