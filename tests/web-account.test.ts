import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import type { PlanId } from "@tab/billing";
import { createApp } from "../apps/api/src/index.ts";
import { createAuthInstance, migrateAuth } from "../apps/api/src/auth.ts";
import {
  DeviceTokenService,
  InMemoryDeviceTokenStorage,
} from "../apps/api/src/device-tokens.ts";
import { InMemoryPersonalMemoryStorage } from "../apps/api/src/personal-memory.ts";
import {
  type BillingCheckoutClient,
  BillingService,
  InMemoryBillingStorage,
} from "../apps/api/src/billing.ts";
import { InMemoryTelemetryStorage } from "../apps/api/src/telemetry.ts";
import { createWebApp, type WebApp } from "../apps/web/src/index.ts";
import type { Hono } from "hono";

const TEST_ORIGIN = "http://localhost:8787";
const WEB_ORIGIN = "http://localhost:3000";
const USED_SUGGESTION_COUNT = 1000;

class TestBillingCheckoutClient implements BillingCheckoutClient {
  readonly checkoutRequests: PlanId[] = [];
  readonly portalRequests: Array<{ userId: string; customerId?: string }> = [];
  failPortalRequests = false;

  async createCheckoutUrl(
    planId: PlanId,
    user: { id: string; email?: string; name?: string },
  ): Promise<string> {
    this.checkoutRequests.push(planId);
    const url = new URL(`https://checkout.test/${planId}`);
    url.searchParams.set("customer", user.id);
    if (user.email) url.searchParams.set("email", user.email);
    return url.toString();
  }

  async createPortalUrl(userId: string, customerId?: string): Promise<string> {
    this.portalRequests.push({ userId, customerId });
    if (this.failPortalRequests) {
      throw new Error("portal unavailable");
    }
    return `https://portal.test/${encodeURIComponent(customerId ?? userId)}`;
  }

}

async function createWebTestEnv() {
  const database = new Database(":memory:");
  const auth = createAuthInstance({
    database,
    baseURL: TEST_ORIGIN,
    requireEmailVerification: false,
  });
  await migrateAuth(auth);

  const deviceTokenStorage = new InMemoryDeviceTokenStorage();
  const deviceTokenService = new DeviceTokenService({ storage: deviceTokenStorage });
  const personalMemoryStorage = new InMemoryPersonalMemoryStorage();
  const billingStorage = new InMemoryBillingStorage();
  const billingService = new BillingService({ storage: billingStorage });
  const billingCheckoutClient = new TestBillingCheckoutClient();

  const apiApp = createApp({
    auth,
    deviceTokenService,
    personalMemoryStorage,
    billingService,
    billingCheckoutClient,
    telemetryStorage: new InMemoryTelemetryStorage(),
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
    database,
    apiApp,
    webApp,
    auth,
    deviceTokenService,
    personalMemoryStorage,
    billingService,
    billingCheckoutClient,
  };
}

async function signUpUser(
  apiApp: Hono,
  database: Database,
  email: string,
  password: string,
  options: { emailVerified?: boolean } = {},
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

  if (options.emailVerified ?? true) {
    database
      .query("UPDATE user SET emailVerified = 1 WHERE id = ?")
      .run(signUpBody.user.id);
  }

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

async function activateFreePlan(billingService: BillingService, userId: string) {
  await billingService.applyEntitlement({
    userId,
    planId: "free",
    polarCustomerId: "polar-customer-free",
    polarSubscriptionId: "polar-sub-free",
    status: "active",
    cachedAt: new Date(),
  });
}

async function activatePaidPlan(
  billingService: BillingService,
  userId: string,
  planId: Exclude<PlanId, "free">,
) {
  await billingService.applyEntitlement({
    userId,
    planId,
    polarCustomerId: `polar-customer-${planId}`,
    polarSubscriptionId: `polar-sub-${planId}`,
    status: "active",
    cachedAt: new Date(),
  });
}

async function consumeSuggestions(
  billingService: BillingService,
  userId: string,
  count: number,
) {
  for (let i = 0; i < count; i++) {
    await billingService.consumeSuggestion(userId);
  }
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
    expect(body).toInclude("Autocomplete for your Mac");
    expect(body).toInclude("Autocomplete that works anywhere you write on your Mac");
    expect(body).toInclude("Download for macOS");
    expect(body).toInclude("data-theme-choice=\"system\"");
    expect(body).toInclude("Saved memories");
    expect(body).toInclude("Recent typing");
  });

  it("renders redesigned auth handoff forms without dropping desktop fields", async () => {
    const { webApp } = await createWebTestEnv();
    const response = await webRequest(
      webApp,
      "/login?device_id=desktop-device-1&callback=tab%3A%2F%2Fauth%2Fcallback&next=%2Fdashboard",
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toInclude("Mac sign-in");
    expect(body).toInclude("name=\"device_id\" value=\"desktop-device-1\"");
    expect(body).toInclude("name=\"callback\" value=\"tab://auth/callback\"");
    expect(body).toInclude("name=\"next\" value=\"/dashboard\"");
    expect(body).toInclude(
      'href="/signup?device_id=desktop-device-1&amp;callback=tab%3A%2F%2Fauth%2Fcallback&amp;next=%2Fdashboard"',
    );
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
    expect(body).toInclude("Simple pricing");
    expect(body).toInclude("Monthly suggestions");
    expect(body).toInclude("Saved memories");
    expect(body).toInclude("Sign in to choose this plan");
    expect(body).toInclude("Start free");
    expect(body).toInclude(
      'href="/login?next=%2Fbilling%2Fcheckout%3Fplan%3Dpro"',
    );
    expect(body).not.toInclude('href="/billing/checkout?plan=pro"');
  });

  it("exposes light and dark theme controls on pricing and dashboard surfaces", async () => {
    const { apiApp, billingService, database, webApp } = await createWebTestEnv();
    const email = `user-${crypto.randomUUID()}@example.com`;
    const password = "password123456";
    const { cookie, userId } = await signUpUser(apiApp, database, email, password);
    await activateFreePlan(billingService, userId);

    const pricingResponse = await webRequest(webApp, "/pricing");
    const dashboardResponse = await webRequest(webApp, "/dashboard", {}, cookie);

    expect(pricingResponse.status).toBe(200);
    expect(dashboardResponse.status).toBe(200);

    for (const body of [await pricingResponse.text(), await dashboardResponse.text()]) {
      expect(body).toInclude('aria-label="Theme selection"');
      expect(body).toInclude('data-theme-choice="light"');
      expect(body).toInclude('data-theme-choice="dark"');
    }
  });

  it("serves the shared component review surface in light and dark modes", async () => {
    const { webApp } = await createWebTestEnv();
    const response = await webRequest(webApp, "/components");

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toInclude("Tab components");
    expect(body).toInclude('data-theme="light"');
    expect(body).toInclude('data-theme="dark"');
    expect(body).toInclude("Status rows");
    expect(body).toInclude("Settings navigation");
  });

  it("shows dashboard navigation and direct checkout links on pricing when signed in", async () => {
    const { apiApp, database, webApp } = await createWebTestEnv();
    const email = `user-${crypto.randomUUID()}@example.com`;
    const password = "password123456";
    const { cookie } = await signUpUser(apiApp, database, email, password);

    const response = await webRequest(webApp, "/pricing", {}, cookie);

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toInclude('href="/dashboard"');
    expect(body).toInclude("Dashboard");
    expect(body).not.toInclude('href="/login">Sign in</a>');
    expect(body).toInclude('href="/billing/checkout?plan=pro"');
    expect(body).not.toInclude(
      'href="/login?next=%2Fbilling%2Fcheckout%3Fplan%3Dpro"',
    );
  });

  it("asks a new web signup to verify email before checkout", async () => {
    const { webApp } = await createWebTestEnv();
    const email = `user-${crypto.randomUUID()}@example.com`;
    const password = "password123456";

    const response = await webRequest(webApp, "/signup", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ name: "Test User", email, password }),
    });

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toInclude("Check your email");
    expect(body).toInclude("Verify your email address before choosing a plan.");
    expect(response.headers.get("set-cookie")).toBeTruthy();
  });

  it("redirects signed-in users without a Polar entitlement to the free checkout", async () => {
    const { apiApp, database, webApp } = await createWebTestEnv();
    const email = `user-${crypto.randomUUID()}@example.com`;
    const password = "password123456";
    const { cookie } = await signUpUser(apiApp, database, email, password);

    const response = await webRequest(webApp, "/dashboard", {}, cookie);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/billing/checkout?plan=free");
  });

  it("renders the sign-in entry point", async () => {
    const { webApp } = await createWebTestEnv();
    const response = await webRequest(webApp, "/login");

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toInclude("Sign in");
    expect(body).toInclude('href="/styles.css"');
    expect(body).toInclude('name="email"');
    expect(body).toInclude('name="password"');
  });

  it("signs in through the web form and reaches the account dashboard", async () => {
    const { apiApp, billingService, database, webApp } = await createWebTestEnv();
    const email = `user-${crypto.randomUUID()}@example.com`;
    const password = "password123456";
    const { userId } = await signUpUser(apiApp, database, email, password);
    await activateFreePlan(billingService, userId);

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
    expect(loginResponse.headers.get("location")).toBe("/dashboard");
    const setCookie = loginResponse.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();

    const accountResponse = await webRequest(webApp, "/dashboard", {}, setCookie!);
    expect(accountResponse.status).toBe(200);
    const body = await accountResponse.text();
    expect(body).toInclude('href="/dashboard/account"');
    expect(body).toInclude('href="/dashboard/usage"');
    expect(body).toInclude('href="/dashboard/devices"');
    expect(body).toInclude('href="/dashboard/memories"');
    expect(body).toInclude('href="/dashboard"');
    expect(body).toInclude("Dashboard");
    expect(body).not.toInclude('href="/login">Sign in</a>');

    const usageResponse = await webRequest(webApp, "/dashboard/usage", {}, setCookie!);
    expect(usageResponse.status).toBe(200);
    const usageBody = await usageResponse.text();
    expect(usageBody).toInclude("Monthly usage");
    expect(usageBody).toInclude("Free plan");
    expect(usageBody).toInclude("Monthly suggestions");
    expect(usageBody).toInclude("Suggestions available");
    expect(usageBody).toInclude("Billing actions");
    expect(usageBody).toInclude("Upgrade to Pro");
    expect(usageBody).toInclude("Upgrade to Max");
    expect(usageBody).toInclude("Manage billing");

    const configResponse = await webRequest(webApp, "/dashboard/account", {}, setCookie!);
    expect(configResponse.status).toBe(200);
    const configBody = await configResponse.text();
    expect(configBody).toInclude("Account status");
    expect(configBody).toInclude("Signed in");
    expect(configBody).toInclude('action="/logout"');
    expect(configBody).toInclude("Sign out");

    const devicesResponse = await webRequest(webApp, "/dashboard/devices", {}, setCookie!);
    expect(devicesResponse.status).toBe(200);
    await textIncludes(devicesResponse, "No Macs are connected yet");

    const memoriesResponse = await webRequest(webApp, "/dashboard/memories", {}, setCookie!);
    expect(memoriesResponse.status).toBe(200);
    await textIncludes(memoriesResponse, "No saved memories yet");
  });

  it("redirects to a checkout URL for a paid plan", async () => {
    const { apiApp, database, webApp } = await createWebTestEnv();
    const email = `user-${crypto.randomUUID()}@example.com`;
    const password = "password123456";
    const { cookie } = await signUpUser(apiApp, database, email, password);

    const response = await webRequest(
      webApp,
      "/billing/checkout?plan=pro",
      {},
      cookie,
    );

    expect(response.status).toBe(302);
    const location = response.headers.get("location");
    expect(location).toBeTruthy();
    expect(location).toInclude("checkout.test/pro");
  });

  it("sends active Pro subscribers choosing Max to billing management", async () => {
    const { apiApp, billingCheckoutClient, billingService, database, webApp } =
      await createWebTestEnv();
    const email = `user-${crypto.randomUUID()}@example.com`;
    const password = "password123456";
    const { cookie, userId } = await signUpUser(apiApp, database, email, password);
    await activatePaidPlan(billingService, userId, "pro");
    await consumeSuggestions(billingService, userId, USED_SUGGESTION_COUNT);

    const response = await webRequest(
      webApp,
      "/billing/checkout?plan=max",
      {},
      cookie,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://portal.test/polar-customer-pro",
    );
    expect(billingCheckoutClient.checkoutRequests).toEqual([]);
    expect(billingCheckoutClient.portalRequests).toEqual([
      { userId, customerId: "polar-customer-pro" },
    ]);

    const entitlement = await billingService.getEntitlement(userId);
    expect(entitlement.planId).toBe("pro");
    expect(entitlement.polarCustomerId).toBe("polar-customer-pro");
    expect(entitlement.polarSubscriptionId).toBe("polar-sub-pro");

    const quota = await billingService.checkQuota(userId);
    expect(quota.ok).toBe(false);
    expect(quota.quota).toBe(1_000);
    expect(quota.usage).toBe(USED_SUGGESTION_COUNT);
  });

  it("treats active paid subscribers choosing their current plan as a no-op", async () => {
    const { apiApp, billingCheckoutClient, billingService, database, webApp } =
      await createWebTestEnv();
    const email = `user-${crypto.randomUUID()}@example.com`;
    const password = "password123456";
    const { cookie, userId } = await signUpUser(apiApp, database, email, password);
    await activatePaidPlan(billingService, userId, "pro");

    const response = await webRequest(
      webApp,
      "/billing/checkout?plan=pro",
      {},
      cookie,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/dashboard");
    expect(billingCheckoutClient.checkoutRequests).toEqual([]);
    expect(billingCheckoutClient.portalRequests).toEqual([]);
  });

  it("sends active Max subscribers choosing Pro to billing management", async () => {
    const { apiApp, billingCheckoutClient, billingService, database, webApp } =
      await createWebTestEnv();
    const email = `user-${crypto.randomUUID()}@example.com`;
    const password = "password123456";
    const { cookie, userId } = await signUpUser(apiApp, database, email, password);
    await activatePaidPlan(billingService, userId, "max");
    await consumeSuggestions(billingService, userId, USED_SUGGESTION_COUNT);

    const response = await webRequest(
      webApp,
      "/billing/checkout?plan=pro",
      {},
      cookie,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://portal.test/polar-customer-max",
    );
    expect(billingCheckoutClient.checkoutRequests).toEqual([]);
    expect(billingCheckoutClient.portalRequests).toEqual([
      { userId, customerId: "polar-customer-max" },
    ]);

    const entitlement = await billingService.getEntitlement(userId);
    expect(entitlement.planId).toBe("max");
    expect(entitlement.status).toBe("active");
    expect(entitlement.polarCustomerId).toBe("polar-customer-max");
    expect(entitlement.polarSubscriptionId).toBe("polar-sub-max");

    const quota = await billingService.checkQuota(userId);
    expect(quota.ok).toBe(true);
    expect(quota.quota).toBe(1_000_000);
    expect(quota.usage).toBe(USED_SUGGESTION_COUNT);
  });

  it("falls back to the local billing management route for paid plan portal failures", async () => {
    const { apiApp, billingCheckoutClient, billingService, database, webApp } =
      await createWebTestEnv();
    const email = `user-${crypto.randomUUID()}@example.com`;
    const password = "password123456";
    const { cookie, userId } = await signUpUser(apiApp, database, email, password);
    await activatePaidPlan(billingService, userId, "pro");
    billingCheckoutClient.failPortalRequests = true;

    const response = await webRequest(
      webApp,
      "/billing/checkout?plan=max",
      {},
      cookie,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/billing/portal");
    expect(billingCheckoutClient.checkoutRequests).toEqual([]);
    expect(billingCheckoutClient.portalRequests).toEqual([
      { userId, customerId: "polar-customer-pro" },
    ]);

    const entitlement = await billingService.getEntitlement(userId);
    expect(entitlement.planId).toBe("pro");
    expect(entitlement.polarCustomerId).toBe("polar-customer-pro");
    expect(entitlement.polarSubscriptionId).toBe("polar-sub-pro");
  });

  it("sends active paid subscribers choosing Free to billing management", async () => {
    const { apiApp, billingCheckoutClient, billingService, database, webApp } =
      await createWebTestEnv();
    const email = `user-${crypto.randomUUID()}@example.com`;
    const password = "password123456";
    const { cookie, userId } = await signUpUser(apiApp, database, email, password);
    await activatePaidPlan(billingService, userId, "pro");

    const response = await webRequest(
      webApp,
      "/billing/checkout?plan=free",
      {},
      cookie,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://portal.test/polar-customer-pro",
    );
    expect(billingCheckoutClient.checkoutRequests).toEqual([]);
    expect(billingCheckoutClient.portalRequests).toEqual([
      { userId, customerId: "polar-customer-pro" },
    ]);
    const entitlement = await billingService.getEntitlement(userId);
    expect(entitlement.planId).toBe("pro");
    expect(entitlement.status).toBe("active");
    expect(entitlement.polarCustomerId).toBe("polar-customer-pro");
    expect(entitlement.polarSubscriptionId).toBe("polar-sub-pro");
  });

  it("falls back to the local billing management route for paid-to-free portal failures", async () => {
    const { apiApp, billingCheckoutClient, billingService, database, webApp } =
      await createWebTestEnv();
    const email = `user-${crypto.randomUUID()}@example.com`;
    const password = "password123456";
    const { cookie, userId } = await signUpUser(apiApp, database, email, password);
    await activatePaidPlan(billingService, userId, "max");
    billingCheckoutClient.failPortalRequests = true;

    const response = await webRequest(
      webApp,
      "/billing/checkout?plan=free",
      {},
      cookie,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/billing/portal");
    expect(billingCheckoutClient.checkoutRequests).toEqual([]);
    expect(billingCheckoutClient.portalRequests).toEqual([
      { userId, customerId: "polar-customer-max" },
    ]);
    const entitlement = await billingService.getEntitlement(userId);
    expect(entitlement.planId).toBe("max");
    expect(entitlement.status).toBe("active");
  });

  it("blocks checkout until the signed-in user verifies email", async () => {
    const { apiApp, database, webApp } = await createWebTestEnv();
    const email = `user-${crypto.randomUUID()}@example.com`;
    const password = "password123456";
    const { cookie } = await signUpUser(apiApp, database, email, password, {
      emailVerified: false,
    });

    const response = await webRequest(
      webApp,
      "/billing/checkout?plan=pro",
      {},
      cookie,
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toInclude("Check your email");
    expect(body).toInclude("Verify your email address before choosing a plan.");
  });

  it("redirects unauthenticated checkout requests to login before checkout", async () => {
    const { webApp } = await createWebTestEnv();

    const response = await webRequest(webApp, "/billing/checkout?plan=pro");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "/login?next=%2Fbilling%2Fcheckout%3Fplan%3Dpro",
    );
  });

  it("resumes paid checkout after login", async () => {
    const { apiApp, database, webApp } = await createWebTestEnv();
    const email = `user-${crypto.randomUUID()}@example.com`;
    const password = "password123456";
    await signUpUser(apiApp, database, email, password);

    const loginPageResponse = await webRequest(
      webApp,
      "/login?next=%2Fbilling%2Fcheckout%3Fplan%3Dmax",
    );
    expect(loginPageResponse.status).toBe(200);
    const loginPageBody = await loginPageResponse.text();
    expect(loginPageBody).toInclude('name="next"');
    expect(loginPageBody).toInclude('/billing/checkout?plan=max');

    const loginResponse = await webRequest(webApp, "/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        email,
        password,
        next: "/billing/checkout?plan=max",
      }),
    });

    expect(loginResponse.status).toBe(302);
    expect(loginResponse.headers.get("location")).toBe(
      "/billing/checkout?plan=max",
    );

    const checkoutResponse = await webRequest(
      webApp,
      "/billing/checkout?plan=max",
      {},
      loginResponse.headers.get("set-cookie")!,
    );
    expect(checkoutResponse.status).toBe(302);
    expect(checkoutResponse.headers.get("location")).toInclude("checkout.test/max");
  });

  it("redirects authenticated login and signup page visits to the dashboard", async () => {
    const { apiApp, database, webApp } = await createWebTestEnv();
    const email = `user-${crypto.randomUUID()}@example.com`;
    const password = "password123456";
    const { cookie } = await signUpUser(apiApp, database, email, password);

    const loginResponse = await webRequest(
      webApp,
      "/login?next=%2Fbilling%2Fcheckout%3Fplan%3Dpro",
      {},
      cookie,
    );
    const signupResponse = await webRequest(webApp, "/signup", {}, cookie);

    expect(loginResponse.status).toBe(302);
    expect(loginResponse.headers.get("location")).toBe("/dashboard");
    expect(signupResponse.status).toBe(302);
    expect(signupResponse.headers.get("location")).toBe("/dashboard");
  });

  it("redirects to the customer portal", async () => {
    const { apiApp, database, webApp } = await createWebTestEnv();
    const email = `user-${crypto.randomUUID()}@example.com`;
    const password = "password123456";
    const { cookie } = await signUpUser(apiApp, database, email, password);

    const response = await webRequest(webApp, "/billing/portal", {}, cookie);

    expect(response.status).toBe(302);
    const location = response.headers.get("location");
    expect(location).toBeTruthy();
    expect(location).toInclude("portal.test/");
  });

  it("lists and deletes Personal Memory from the account surface", async () => {
    const { apiApp, billingService, database, webApp, personalMemoryStorage } = await createWebTestEnv();
    const email = `user-${crypto.randomUUID()}@example.com`;
    const password = "password123456";
    const { cookie, userId } = await signUpUser(apiApp, database, email, password);
    await activateFreePlan(billingService, userId);

    const memory = await personalMemoryStorage.createMemory({
      userId,
      content: "Lives in Portland",
      createdBy: "system",
    });

    const accountBefore = await webRequest(webApp, "/dashboard/memories", {}, cookie);
    expect(accountBefore.status).toBe(200);
    const bodyBefore = await accountBefore.text();
    expect(bodyBefore).toInclude("Lives in Portland");
    expect(bodyBefore).toInclude("Edit memory");
    expect(bodyBefore).toInclude("Delete saved detail");

    const unconfirmedDeleteResponse = await webRequest(
      webApp,
      `/dashboard/memories/${memory.id}/delete`,
      { method: "POST", body: new FormData() },
      cookie,
    );
    expect(unconfirmedDeleteResponse.status).toBe(302);
    expect(unconfirmedDeleteResponse.headers.get("location")).toBe(
      "/dashboard/memories",
    );
    expect(await personalMemoryStorage.findMemoryById(memory.id)).toBeTruthy();

    const deleteForm = new FormData();
    deleteForm.set("confirm", "delete-memory");
    const deleteResponse = await webRequest(
      webApp,
      `/dashboard/memories/${memory.id}/delete`,
      { method: "POST", body: deleteForm },
      cookie,
    );
    expect(deleteResponse.status).toBe(302);
    expect(deleteResponse.headers.get("location")).toBe(
      "/dashboard/memories",
    );

    const accountAfter = await webRequest(webApp, "/dashboard/memories", {}, cookie);
    expect(accountAfter.status).toBe(200);
    const bodyAfter = await accountAfter.text();
    expect(bodyAfter).not.toInclude("Lives in Portland");
  });

  it("creates and edits Personal Memory from the account surface", async () => {
    const { apiApp, billingService, database, webApp, personalMemoryStorage } = await createWebTestEnv();
    const email = `user-${crypto.randomUUID()}@example.com`;
    const password = "password123456";
    const { cookie, userId } = await signUpUser(apiApp, database, email, password);
    await activateFreePlan(billingService, userId);

    const createForm = new FormData();
    createForm.set("content", "Prefers concise summaries");
    const createResponse = await webRequest(
      webApp,
      "/dashboard/memories/create",
      { method: "POST", body: createForm },
      cookie,
    );

    expect(createResponse.status).toBe(302);
    expect(createResponse.headers.get("location")).toBe(
      "/dashboard/memories",
    );

    const memoriesAfterCreate = await personalMemoryStorage.listMemoriesByUser(userId);
    expect(memoriesAfterCreate).toHaveLength(1);
    expect(memoriesAfterCreate[0]?.content).toBe("Prefers concise summaries");
    expect(memoriesAfterCreate[0]?.createdBy).toBe("user");

    const systemMemory = await personalMemoryStorage.createMemory({
      userId,
      content: "Works at Acme",
      createdBy: "system",
    });
    const editForm = new FormData();
    editForm.set("content", "Works at Acme Robotics");

    const editResponse = await webRequest(
      webApp,
      `/dashboard/memories/${systemMemory.id}/edit`,
      { method: "POST", body: editForm },
      cookie,
    );

    expect(editResponse.status).toBe(302);
    expect(editResponse.headers.get("location")).toBe(
      "/dashboard/memories",
    );

    const editedMemory = await personalMemoryStorage.findMemoryById(systemMemory.id);
    expect(editedMemory?.content).toBe("Works at Acme Robotics");
    expect(editedMemory?.createdBy).toBe("user");

    const accountPage = await webRequest(webApp, "/dashboard/memories", {}, cookie);
    expect(accountPage.status).toBe(200);
    const body = await accountPage.text();
    expect(body).toInclude("Prefers concise summaries");
    expect(body).toInclude("Works at Acme Robotics");
    expect(body).toInclude("Add a memory");
  });

  it("lists and revokes native devices from the account surface", async () => {
    const { apiApp, billingService, database, webApp, deviceTokenService } = await createWebTestEnv();
    const email = `user-${crypto.randomUUID()}@example.com`;
    const password = "password123456";
    const { cookie, userId } = await signUpUser(apiApp, database, email, password);
    await activateFreePlan(billingService, userId);

    await deviceTokenService.createDeviceToken(userId, {
      deviceId: "macbook-pro-1",
      platform: "darwin",
      appVersion: "0.0.1",
    });

    const accountBefore = await webRequest(webApp, "/dashboard/devices", {}, cookie);
    expect(accountBefore.status).toBe(200);
    const bodyBefore = await accountBefore.text();
    expect(bodyBefore).toInclude("macbook-pro-1");
    expect(bodyBefore).toInclude("Connected");
    expect(bodyBefore).toInclude("Remove access");

    const revokeForm = new FormData();
    revokeForm.set("confirm", "macbook-pro-1");
    const revokeResponse = await webRequest(
      webApp,
      "/dashboard/devices/macbook-pro-1/revoke",
      { method: "POST", body: revokeForm },
      cookie,
    );
    expect(revokeResponse.status).toBe(302);
    expect(revokeResponse.headers.get("location")).toBe(
      "/dashboard/devices",
    );

    const accountAfter = await webRequest(webApp, "/dashboard/devices", {}, cookie);
    expect(accountAfter.status).toBe(200);
    const bodyAfter = await accountAfter.text();
    expect(bodyAfter).toInclude("Access removed");
  });
});
