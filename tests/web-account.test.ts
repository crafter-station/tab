import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import type { BillingInterval, PlanId } from "@tab/billing";
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
class TestBillingCheckoutClient implements BillingCheckoutClient {
  readonly checkoutRequests: Array<{
    planId: PlanId;
    interval: BillingInterval;
    userId: string;
  }> = [];
  readonly portalRequests: Array<{ userId: string; customerId?: string }> = [];
  failPortalRequests = false;

  async createCheckoutUrl(
    planId: PlanId,
    interval: BillingInterval,
    user: { id: string; email?: string; name?: string },
  ): Promise<string> {
    this.checkoutRequests.push({ planId, interval, userId: user.id });
    const url = new URL(`https://checkout.test/${planId}`);
    url.searchParams.set("interval", interval);
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
  billingInterval: BillingInterval = "monthly",
) {
  await billingService.applyEntitlement({
    userId,
    planId,
    polarCustomerId: `polar-customer-${planId}`,
    polarSubscriptionId: `polar-sub-${planId}`,
    status: "active",
    billingInterval,
    cachedAt: new Date(),
  });
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
    expect(body).toInclude("Download Tab free");
    expect(body).toInclude("data-theme-choice=\"system\"");
    expect(body).toInclude("Saved memories");
    expect(body).toInclude("Recent typing");
    expect(body).toInclude("Start free. Upgrade when Tab becomes a habit.");
    expect(body).toInclude("100 Accepted Words from Local Suggestions each day");
    expect(body).toInclude("No card is required for the trial.");
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

  it("displays accurate Free and Pro allowances and prices", async () => {
    const { webApp } = await createWebTestEnv();
    const response = await webRequest(webApp, "/pricing");

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toInclude("Free");
    expect(body).toInclude("Pro");
    expect(body).not.toInclude("Max");
    expect(body).toInclude("100 Accepted Words/day");
    expect(body).toInclude("10 Deep Completes");
    expect(body).toInclude("300 Deep Completes");
    expect(body).toInclude("$10/mo");
    expect(body).toInclude("$96/year");
    expect(body).toInclude("Free and Pro");
    expect(body).toInclude("Tab counts value you receive.");
    expect(body).toInclude("Continuous Memory Extraction");
    expect(body).toInclude("Custom writing instructions");
    expect(body).toInclude("Supported model catalog");
    expect(body).toInclude("No automatic overages");
    expect(body).toInclude("Sign in, then continue to secure checkout");
    expect(body).toInclude("Start 30-day Pro trial");
    expect(body).toInclude('href="/signup"');
    expect(body).toInclude(
      'href="/login?next=%2Fbilling%2Fcheckout%3Fplan%3Dpro%26interval%3Dmonthly"',
    );
    expect(body).toInclude(
      'href="/login?next=%2Fbilling%2Fcheckout%3Fplan%3Dpro%26interval%3Dannual"',
    );
    expect(body).not.toInclude('href="/billing/checkout?plan=pro&amp;interval=monthly"');
    expect(body).not.toInclude('href="/billing/checkout?plan=pro&amp;interval=annual"');
  });

  it("explains local processing, billing, cancellation, and retained data controls", async () => {
    const { webApp } = await createWebTestEnv();
    const [termsResponse, privacyResponse] = await Promise.all([
      webRequest(webApp, "/terms"),
      webRequest(webApp, "/privacy"),
    ]);

    expect(termsResponse.status).toBe(200);
    expect(privacyResponse.status).toBe(200);

    const terms = await termsResponse.text();
    expect(terms).toInclude("Updated July 13, 2026");
    expect(terms).toInclude("one 30-day Pro trial without a payment card");
    expect(terms).toInclude("does not charge automatic usage overages");
    expect(terms).toInclude("paid benefits remain active through the end of the current paid period");
    expect(terms).toInclude('href="/billing/portal"');
    expect(terms).toInclude('href="/pricing"');
    expect(terms).toInclude('href="/privacy"');

    const privacy = await privacyResponse.text();
    expect(privacy).toInclude("Updated July 13, 2026");
    expect(privacy).toInclude("Automatic Suggestions use local inference on your Mac");
    expect(privacy).toInclude("pasted text does not create Personal Memory by default");
    expect(privacy).toInclude("This telemetry excludes raw Typing Context");
    expect(privacy).toInclude("view, edit, export, and delete existing Personal Memory");
    expect(privacy).toInclude('href="/terms"');
    expect(privacy).toInclude('href="/pricing"');
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
    expect(body).toInclude('href="/billing/checkout?plan=pro&amp;interval=monthly"');
    expect(body).toInclude('href="/billing/checkout?plan=pro&amp;interval=annual"');
    expect(body).not.toInclude(
      'href="/login?next=%2Fbilling%2Fcheckout%3Fplan%3Dpro%26interval%3Dmonthly"',
    );
    expect(body).not.toInclude(
      'href="/login?next=%2Fbilling%2Fcheckout%3Fplan%3Dpro%26interval%3Dannual"',
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

  it("starts signed-in users without a Polar entitlement on a Pro trial", async () => {
    const { apiApp, database, webApp } = await createWebTestEnv();
    const email = `user-${crypto.randomUUID()}@example.com`;
    const password = "password123456";
    const { cookie } = await signUpUser(apiApp, database, email, password);

    const response = await webRequest(webApp, "/dashboard", {}, cookie);

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toInclude("Trial ends");
    expect(body).toInclude("0 of 300");
    expect(body).toInclude("Deep Completes this month");
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
    expect(usageBody).toInclude("Usage and billing");
    expect(usageBody).toInclude("Current plan");
    expect(usageBody).toInclude("Local Accepted Words today");
    expect(usageBody).toInclude("Deep Completes this month");
    expect(usageBody).toInclude("Change plan");
    expect(usageBody).toInclude("Pro monthly");
    expect(usageBody).toInclude("Pro annual");
    expect(usageBody).toInclude("Manage billing");

    const configResponse = await webRequest(webApp, "/dashboard/account", {}, setCookie!);
    expect(configResponse.status).toBe(200);
    const configBody = await configResponse.text();
    expect(configBody).toInclude("Signed-in account");
    expect(configBody).toInclude("Email verified");
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
    expect(location).toInclude("interval=monthly");
  });

  it("sends active monthly Pro subscribers choosing annual to billing management", async () => {
    const { apiApp, billingCheckoutClient, billingService, database, webApp } =
      await createWebTestEnv();
    const email = `user-${crypto.randomUUID()}@example.com`;
    const password = "password123456";
    const { cookie, userId } = await signUpUser(apiApp, database, email, password);
    await activatePaidPlan(billingService, userId, "pro");

    const response = await webRequest(
      webApp,
      "/billing/checkout?plan=pro&interval=annual",
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
    expect(entitlement.billingInterval).toBe("monthly");
    expect(entitlement.polarCustomerId).toBe("polar-customer-pro");
    expect(entitlement.polarSubscriptionId).toBe("polar-sub-pro");
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

  it("falls back to the local billing management route for interval-change portal failures", async () => {
    const { apiApp, billingCheckoutClient, billingService, database, webApp } =
      await createWebTestEnv();
    const email = `user-${crypto.randomUUID()}@example.com`;
    const password = "password123456";
    const { cookie, userId } = await signUpUser(apiApp, database, email, password);
    await activatePaidPlan(billingService, userId, "pro");
    billingCheckoutClient.failPortalRequests = true;

    const response = await webRequest(
      webApp,
      "/billing/checkout?plan=pro&interval=annual",
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

  it("rejects retired plan checkout requests", async () => {
    const { apiApp, billingCheckoutClient, database, webApp } =
      await createWebTestEnv();
    const email = `user-${crypto.randomUUID()}@example.com`;
    const password = "password123456";
    const { cookie } = await signUpUser(apiApp, database, email, password);

    for (const plan of ["free", "max"]) {
      const response = await webRequest(
        webApp,
        `/billing/checkout?plan=${plan}`,
        {},
        cookie,
      );

      expect(response.status).toBe(200);
      expect(await response.text()).toInclude("Billing error");
    }
    expect(billingCheckoutClient.checkoutRequests).toEqual([]);
    expect(billingCheckoutClient.portalRequests).toEqual([]);
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
      "/login?next=%2Fbilling%2Fcheckout%3Fplan%3Dpro%26interval%3Dmonthly",
    );
  });

  it("resumes paid checkout after login", async () => {
    const { apiApp, database, webApp } = await createWebTestEnv();
    const email = `user-${crypto.randomUUID()}@example.com`;
    const password = "password123456";
    await signUpUser(apiApp, database, email, password);

    const loginPageResponse = await webRequest(
      webApp,
      "/login?next=%2Fbilling%2Fcheckout%3Fplan%3Dpro%26interval%3Dannual",
    );
    expect(loginPageResponse.status).toBe(200);
    const loginPageBody = await loginPageResponse.text();
    expect(loginPageBody).toInclude('name="next"');
    expect(loginPageBody).toInclude('/billing/checkout?plan=pro&amp;interval=annual');

    const loginResponse = await webRequest(webApp, "/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        email,
        password,
        next: "/billing/checkout?plan=pro&interval=annual",
      }),
    });

    expect(loginResponse.status).toBe(302);
    expect(loginResponse.headers.get("location")).toBe(
      "/billing/checkout?plan=pro&interval=annual",
    );

    const checkoutResponse = await webRequest(
      webApp,
      "/billing/checkout?plan=pro&interval=annual",
      {},
      loginResponse.headers.get("set-cookie")!,
    );
    expect(checkoutResponse.status).toBe(302);
    expect(checkoutResponse.headers.get("location")).toInclude("checkout.test/pro");
    expect(checkoutResponse.headers.get("location")).toInclude("interval=annual");
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
    expect(bodyBefore).toInclude("Memory library");
    expect(bodyBefore).toInclude("Delete selected");
    expect(bodyBefore).toInclude("Actions for memory updated");
    expect(bodyBefore).toInclude("Update Memory");
    expect(bodyBefore).toInclude("Delete Memory");

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
    expect(
      await personalMemoryStorage.findMemoryById(memory.userId, memory.id),
    ).toBeTruthy();

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

    const editedMemory = await personalMemoryStorage.findMemoryById(
      systemMemory.userId,
      systemMemory.id,
    );
    expect(editedMemory?.content).toBe("Works at Acme Robotics");
    expect(editedMemory?.createdBy).toBe("user");

    const accountPage = await webRequest(webApp, "/dashboard/memories", {}, cookie);
    expect(accountPage.status).toBe(200);
    const body = await accountPage.text();
    expect(body).toInclude("Prefers concise summaries");
    expect(body).toInclude("Works at Acme Robotics");
    expect(body).toInclude("Add a memory");
  });

  it("deletes selected Personal Memories from the dashboard table", async () => {
    const { apiApp, billingService, database, webApp, personalMemoryStorage } = await createWebTestEnv();
    const email = `user-${crypto.randomUUID()}@example.com`;
    const password = "password123456";
    const { cookie, userId } = await signUpUser(apiApp, database, email, password);
    await activateFreePlan(billingService, userId);

    const firstMemory = await personalMemoryStorage.createMemory({
      userId,
      content: "Likes weekly recaps",
      createdBy: "user",
    });
    const secondMemory = await personalMemoryStorage.createMemory({
      userId,
      content: "Uses short bullet points",
      createdBy: "system",
    });
    const remainingMemory = await personalMemoryStorage.createMemory({
      userId,
      content: "Prefers Monday planning",
      createdBy: "system",
    });

    const deleteSelectedForm = new FormData();
    deleteSelectedForm.set("confirm", "delete-selected-memories");
    deleteSelectedForm.append("memoryId", firstMemory.id);
    deleteSelectedForm.append("memoryId", secondMemory.id);

    const deleteSelectedResponse = await webRequest(
      webApp,
      "/dashboard/memories/delete-selected",
      { method: "POST", body: deleteSelectedForm },
      cookie,
    );

    expect(deleteSelectedResponse.status).toBe(302);
    expect(deleteSelectedResponse.headers.get("location")).toBe(
      "/dashboard/memories",
    );
    expect(
      await personalMemoryStorage.findMemoryById(
        firstMemory.userId,
        firstMemory.id,
      ),
    ).toBeNull();
    expect(
      await personalMemoryStorage.findMemoryById(
        secondMemory.userId,
        secondMemory.id,
      ),
    ).toBeNull();
    expect(
      await personalMemoryStorage.findMemoryById(
        remainingMemory.userId,
        remainingMemory.id,
      ),
    ).toBeTruthy();
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
    expect(bodyBefore).toInclude("Actions for macbook-pro-1");
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
