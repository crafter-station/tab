import { createElement } from "react";
import type { ReactNode } from "react";
import { ApiErrorResponseSchema } from "@tab/contracts";
import { ComponentReviewSurface } from "@tab/ui";
import {
  ForgotPasswordPage,
  LoginPage,
  ResetPasswordPage,
  SignupPage,
} from "./components/pages/auth.tsx";
import { BrandPage } from "./components/pages/brand.tsx";
import { DashboardPage, type DashboardSection } from "./components/pages/dashboard.tsx";
import { AboutPage, ContactPage, PrivacyPage, TermsPage } from "./components/pages/information.tsx";
import { DownloadPage, HomePage, PricingPage } from "./components/pages/marketing.tsx";
import { MessagePage, type AuthSearch, type User } from "./components/pages/shared.tsx";
import { env } from "./env.ts";
import { renderPage } from "./render-page.tsx";
import {
  apiRequest as requestApi,
  appendSetCookies,
  cookieHeaderFromSetCookie,
  parseBillingStatus,
  parseDeviceAuthorize,
  parseDevices,
  parseMemories,
  parseLocalSuggestionActivity,
  parseCheckout,
  parsePortal,
} from "./lib/api.ts";

export type WebAppConfig = {
  apiBaseUrl: string;
  fetch?: typeof globalThis.fetch;
  assets?: { fetch(request: Request): Promise<Response> };
  appName?: string;
  macDownloadUrl?: string;
  latestVersion?: string;
};

type SessionResult =
  | { ok: true; user: User }
  | { ok: false; response: Response };

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

function safeNextPath(next: string | null | undefined): string | undefined {
  if (!next?.startsWith("/") || next.startsWith("//")) return undefined;
  try {
    const url = new URL(next, "http://localhost");
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return undefined;
  }
}

function loginRedirect(next?: string): Response {
  const params = new URLSearchParams();
  const safeNext = safeNextPath(next);
  if (safeNext) params.set("next", safeNext);
  const query = params.toString();
  return redirect(`/login${query ? `?${query}` : ""}`);
}

function html(body: ReactNode, title: string, status = 200, user?: User, description?: string, siteShell = true): Response {
  return new Response(renderPage(title, body, user, description, siteShell), {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function htmlErrorPage(
  title: string,
  message: string,
  action?: { href: string; label: string },
): Response {
  return html(
    createElement(MessagePage, {
      title,
      message,
      action,
    }),
    title,
  );
}

async function parseApiErrorMessage(response: Response): Promise<string | undefined> {
  try {
    return ApiErrorResponseSchema.parse(await response.json()).error.message;
  } catch {
    return undefined;
  }
}

function verifyEmailPage(): Response {
  return htmlErrorPage(
    "Check your email",
    "We sent you a verification link. Verify your email address before choosing a plan.",
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function isPublicAsset(path: string): boolean {
  return path === "/styles.css" ||
    path === "/marketing-demo.js" ||
    path.startsWith("/assets/") ||
    path.startsWith("/brand/") ||
    path.startsWith("/files/") ||
    path.startsWith("/logos/");
}

async function stylesheet(): Promise<Response> {
  const file = Bun.file(new URL("./generated/styles.css", import.meta.url));
  if (!(await file.exists())) {
    return new Response("Run `bun run --cwd apps/web styles:build` to generate Tailwind CSS.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(file, {
    headers: {
      "cache-control": "no-cache",
      "content-type": "text/css; charset=utf-8",
    },
  });
}

async function publicAsset(path: string): Promise<Response | undefined> {
  const isMarketingScript = path === "/marketing-demo.js";
  const isLogo = /^\/logos\/[a-z0-9-]+\.svg$/.test(path);
  const isBrandAsset = /^\/brand\/tab-(?:mark|lockup)(?:-(?:light|dark))?\.(?:svg|png|jpg|webp)$/.test(path);
  const isBrandBundle = path === "/brand/tab-brand-assets.zip";
  const fontFile = path.match(/^\/files\/(geist|space-grotesk)-[a-z0-9-]+\.woff2$/)?.[0].slice(7);

  if (fontFile) {
    const fontPackage = fontFile.startsWith("geist-")
      ? "@fontsource-variable/geist"
      : "@fontsource-variable/space-grotesk";
    const file = Bun.file(new URL(import.meta.resolve(`${fontPackage}/files/${fontFile}`)));

    if (!(await file.exists())) return undefined;

    return new Response(file, {
      headers: {
        "cache-control": "public, max-age=31536000, immutable",
        "content-type": "font/woff2",
      },
    });
  }

  if (!isMarketingScript && !isLogo && !isBrandAsset && !isBrandBundle) return undefined;

  const file = Bun.file(new URL(`../public${path}`, import.meta.url));
  if (!(await file.exists())) return undefined;

  const contentType = isMarketingScript
    ? "text/javascript; charset=utf-8"
    : isBrandBundle
      ? "application/zip"
      : path.endsWith(".svg")
        ? "image/svg+xml"
        : path.endsWith(".png")
          ? "image/png"
          : path.endsWith(".webp")
            ? "image/webp"
            : "image/jpeg";

  return new Response(file, {
    headers: {
      "cache-control": "public, max-age=86400",
      "content-type": contentType,
    },
  });
}

function routeSegment(path: string, index: number): string | undefined {
  const segment = path.split("/")[index];
  return segment ? decodeURIComponent(segment) : undefined;
}

export function createWebApp(config: WebAppConfig) {
  const baseUrl = config.apiBaseUrl.replace(/\/$/, "");
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const appName = config.appName ?? "Tab";
  const macDownloadUrl = config.macDownloadUrl ?? env.TAB_MAC_DOWNLOAD_URL;
  const latestVersion = config.latestVersion ?? env.TAB_DESKTOP_LATEST_VERSION;

  async function apiRequest(
    path: string,
    init: RequestInit = {},
    cookieHeader?: string,
  ): Promise<Response> {
    return requestApi(path, {
      ...init,
      apiBaseUrl: baseUrl,
      cookie: cookieHeader,
      fetch: fetchImpl,
    });
  }

  async function getSession(
    cookieHeader: string | undefined,
  ): Promise<SessionResult> {
    const response = await apiRequest("/api/auth/get-session", {}, cookieHeader);
    if (response.status !== 200) {
      return {
        ok: false,
        response: loginRedirect(),
      };
    }

    const body = (await response.json()) as { user?: User } | null;
    if (!body?.user?.id) {
      return {
        ok: false,
        response: loginRedirect(),
      };
    }

    return { ok: true, user: body.user };
  }

  async function getOptionalUser(cookieHeader: string | undefined): Promise<User | undefined> {
    let response: Response;
    try {
      response = await apiRequest("/api/auth/get-session", {}, cookieHeader);
    } catch {
      return undefined;
    }

    if (response.status !== 200) return undefined;

    const body = (await response.json()) as { user?: User } | null;
    return body?.user?.id ? body.user : undefined;
  }

  async function requireSession(
    cookieHeader: string | undefined,
  ): Promise<SessionResult> {
    return getSession(cookieHeader);
  }

  async function publicPage(
    cookieHeader: string | undefined,
    body: ReactNode,
    title: string,
    description?: string,
    status = 200,
  ): Promise<Response> {
    const user = await getOptionalUser(cookieHeader);
    return html(body, title, status, user, description);
  }

  async function homePage(cookieHeader: string | undefined): Promise<Response> {
    return publicPage(
      cookieHeader,
      createElement(HomePage),
      `${appName} - Native autocomplete for your Mac`,
      "Private Local Suggestions as you type, explicit Deep Complete for harder writing, and autocomplete across the Mac apps where you already work.",
    );
  }

  async function pricingPage(cookieHeader: string | undefined): Promise<Response> {
    const user = await getOptionalUser(cookieHeader);
    return html(
      createElement(PricingPage, { authenticated: Boolean(user) }),
      `Pricing - ${appName}`,
      200,
      user,
      "Compare Tab Free, Pro, and Max, including one month free on paid plans, monthly pricing, Local Suggestion and Deep Complete allowances, and cancellation.",
    );
  }

  async function authorizeDeviceRedirect(
    callback: string,
    cookieHeader: string,
    sourceResponse?: Response,
  ): Promise<Response> {
    const authorizeResponse = await apiRequest(
      "/api/auth/device/authorize",
      { method: "POST" },
      cookieHeader,
    );

    if (authorizeResponse.status !== 200) {
      return loginPage("Signed in, but failed to authorize this device.");
    }

    const authorize = await parseDeviceAuthorize(authorizeResponse);
    const callbackUrl = new URL(callback);
    callbackUrl.searchParams.set("code", authorize.code);
    const response = redirect(callbackUrl.toString());
    if (sourceResponse) appendSetCookies(response, sourceResponse);
    return response;
  }

  function authSearchFromParams(searchParams: URLSearchParams): AuthSearch {
    return {
      device_id: searchParams.get("device_id") ?? undefined,
      callback: searchParams.get("callback") ?? undefined,
      next: safeNextPath(searchParams.get("next")),
    };
  }

  function authSearchParams(deviceId: string, callback: string, next?: string): URLSearchParams {
    const searchParams = new URLSearchParams();
    if (deviceId) searchParams.set("device_id", deviceId);
    if (callback) searchParams.set("callback", callback);
    if (next) searchParams.set("next", next);
    return searchParams;
  }

  async function loginPage(
    error?: string,
    _path = "/login",
    searchParams = new URLSearchParams(),
    cookieHeader?: string,
  ): Promise<Response> {
    const deviceId = searchParams.get("device_id") ?? "";
    const callback = searchParams.get("callback") ?? "";
    if (!error && deviceId && callback && cookieHeader) {
      const session = await getSession(cookieHeader);
      if (session.ok) {
        return authorizeDeviceRedirect(callback, cookieHeader);
      }
    }

    if (!error && cookieHeader) {
      const session = await getSession(cookieHeader);
      if (session.ok) return redirect("/dashboard");
    }

    return html(
      createElement(LoginPage, { search: authSearchFromParams(searchParams), error }),
      `Sign in - ${appName}`,
    );
  }

  async function signupPage(
    error?: string,
    _path = "/signup",
    searchParams = new URLSearchParams(),
    cookieHeader?: string,
  ): Promise<Response> {
    if (!error && cookieHeader) {
      const session = await getSession(cookieHeader);
      if (session.ok) return redirect("/dashboard");
    }

    return html(
      createElement(SignupPage, { search: authSearchFromParams(searchParams), error }),
      `Sign up - ${appName}`,
    );
  }

  function forgotPasswordPage(cookieHeader: string | undefined, error?: string, sent = false): Promise<Response> {
    return publicPage(
      cookieHeader,
      createElement(ForgotPasswordPage, { error, sent }),
      `Reset password - ${appName}`,
    );
  }

  function resetPasswordPage(cookieHeader: string | undefined, error?: string, token?: string): Promise<Response> {
    return publicPage(
      cookieHeader,
      createElement(ResetPasswordPage, { error, token }),
      `Choose a new password - ${appName}`,
    );
  }

  async function loginHandler(request: Request, cookieHeader?: string): Promise<Response> {
    let formData;
    try {
      formData = await request.formData();
    } catch {
      return loginPage("Invalid form submission.");
    }

    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    const deviceId = String(formData.get("device_id") ?? "");
    const callback = String(formData.get("callback") ?? "");
    const next = safeNextPath(String(formData.get("next") ?? ""));
    const searchParams = authSearchParams(deviceId, callback, next);

    const signInResponse = await apiRequest(
      "/api/auth/sign-in/email",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: new URL(request.url).origin,
        },
        body: JSON.stringify({ email, password, rememberMe: true }),
      },
      cookieHeader,
    );

    if (signInResponse.status !== 200) {
      if (signInResponse.status === 403) {
        return loginPage("Check your email to verify your account before signing in.", "/login", searchParams);
      }
      return loginPage("Invalid email or password.", "/login", searchParams);
    }

    if (deviceId && callback) {
      const signedInCookieHeader = cookieHeaderFromSetCookie(signInResponse);
      if (!signedInCookieHeader) {
        return loginPage("We could not connect this Mac. Try signing in again.", "/login", searchParams);
      }
      return authorizeDeviceRedirect(callback, signedInCookieHeader, signInResponse);
    }

    const response = redirect(next ?? "/dashboard");
    appendSetCookies(response, signInResponse);
    return response;
  }

  async function signupHandler(request: Request, cookieHeader?: string): Promise<Response> {
    let formData;
    try {
      formData = await request.formData();
    } catch {
      return signupPage("Invalid form submission.");
    }

    const name = String(formData.get("name") ?? "");
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    const deviceId = String(formData.get("device_id") ?? "");
    const callback = String(formData.get("callback") ?? "");
    const next = safeNextPath(String(formData.get("next") ?? ""));
    const searchParams = authSearchParams(deviceId, callback, next);

    const signUpResponse = await apiRequest(
      "/api/auth/sign-up/email",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: new URL(request.url).origin,
        },
        body: JSON.stringify({
          name,
          email,
          password,
          callbackURL: new URL("/dashboard", request.url).toString(),
        }),
      },
      cookieHeader,
    );

    if (signUpResponse.status !== 200) {
      return signupPage("We could not create that account. Check the details and try again.", "/signup", searchParams);
    }

    const signedInCookieHeader = cookieHeaderFromSetCookie(signUpResponse);
    if (!signedInCookieHeader) return verifyEmailPage();

    const session = await getSession(signedInCookieHeader);
    if (session.ok && !session.user.emailVerified) {
      const response = verifyEmailPage();
      appendSetCookies(response, signUpResponse);
      return response;
    }

    if (deviceId && callback) {
      return authorizeDeviceRedirect(callback, signedInCookieHeader, signUpResponse);
    }

    if (next) {
      const response = redirect(next);
      appendSetCookies(response, signUpResponse);
      return response;
    }

    const response = redirect("/dashboard");
    appendSetCookies(response, signUpResponse);
    return response;
  }

  async function forgotPasswordHandler(request: Request, cookieHeader: string | undefined): Promise<Response> {
    let formData;
    try {
      formData = await request.formData();
    } catch {
      return forgotPasswordPage(cookieHeader, "Invalid form submission.");
    }

    const email = String(formData.get("email") ?? "");
    const redirectTo = new URL("/reset-password", request.url).toString();
    const response = await apiRequest("/api/auth/request-password-reset", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: new URL(request.url).origin,
      },
      body: JSON.stringify({ email, redirectTo }),
    });

    if (response.status !== 200) {
      return forgotPasswordPage(cookieHeader, "Could not send a reset link. Please try again.");
    }

    return forgotPasswordPage(cookieHeader, undefined, true);
  }

  async function resetPasswordHandler(request: Request, cookieHeader: string | undefined): Promise<Response> {
    let formData;
    try {
      formData = await request.formData();
    } catch {
      return resetPasswordPage(cookieHeader, "Invalid form submission.");
    }

    const token = String(formData.get("token") ?? "");
    const newPassword = String(formData.get("password") ?? "");
    const response = await apiRequest("/api/auth/reset-password", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: new URL(request.url).origin,
      },
      body: JSON.stringify({ token, newPassword }),
    });

    if (response.status !== 200) {
      return resetPasswordPage(cookieHeader, "Could not update your password. Request a new reset link and try again.", token);
    }

    return redirect("/login");
  }

  async function accountPage(
    cookieHeader: string | undefined,
    _path: string,
    _searchParams: URLSearchParams,
    section: DashboardSection = "overview",
  ): Promise<Response> {
    const sessionCheck = await requireSession(cookieHeader);
    if (!sessionCheck.ok) return sessionCheck.response;

    const [billingResponse, devicesResponse, memoriesResponse, localActivityResponse] = await Promise.all([
      apiRequest("/api/billing/status", {}, cookieHeader),
      apiRequest("/api/auth/devices", {}, cookieHeader),
      apiRequest("/api/account/memory", {}, cookieHeader),
      apiRequest("/api/activity/local-suggestions", {}, cookieHeader),
    ]);

    if (billingResponse.status === 401) {
      return redirect("/login");
    }

    const billing = await parseBillingStatus(billingResponse);
    const deviceList = await parseDevices(devicesResponse);
    const memoryList = await parseMemories(memoriesResponse);
    const localActivity = await parseLocalSuggestionActivity(localActivityResponse);
    return html(
      createElement(DashboardPage, {
        section,
        data: {
          user: sessionCheck.user,
          billing: billing.data,
          devices: deviceList.data.devices,
          memories: memoryList.data.memories,
          localSuggestionActivity: localActivity.data,
        },
      }),
      `${section === "overview" ? "Dashboard" : `Dashboard ${section}`} - ${appName}`,
      200,
      sessionCheck.user,
      undefined,
      false,
    );
  }

  async function memoryExport(
    cookieHeader: string | undefined,
  ): Promise<Response> {
    const sessionCheck = await requireSession(cookieHeader);
    if (!sessionCheck.ok) return sessionCheck.response;
    const response = await apiRequest(
      "/api/account/memory/export",
      {},
      cookieHeader,
    );
    if (!response.ok) {
      return htmlErrorPage("Export failed", "Could not export Personal Memory.");
    }
    return new Response(response.body, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": 'attachment; filename="tab-personal-memory.json"',
      },
    });
  }

  async function checkoutRedirect(
    cookieHeader: string | undefined,
    searchParams: URLSearchParams,
  ): Promise<Response> {
    const sessionCheck = await requireSession(cookieHeader);
    const plan = searchParams.get("plan") ?? "pro";
    const checkoutPath = `/billing/checkout?plan=${encodeURIComponent(plan)}`;
    if (!sessionCheck.ok) return loginRedirect(checkoutPath);

    const response = await apiRequest(
      `/api/billing/checkout?plan=${encodeURIComponent(plan)}&interval=monthly`,
      {},
      cookieHeader,
    );

    if (response.status === 401) return loginRedirect(checkoutPath);
    if (response.status === 403) return verifyEmailPage();
    if (response.status !== 200) {
      const errorMessage = await parseApiErrorMessage(response);
      if (errorMessage?.startsWith("Plan Change failed:")) {
        return htmlErrorPage(
          "Billing error",
          errorMessage,
          { href: "/billing/portal", label: "Manage billing" },
        );
      }

      return htmlErrorPage(
        "Billing error",
        "Could not update billing. Manage billing or try again later.",
        { href: "/billing/portal", label: "Manage billing" },
      );
    }

    const body = await parseCheckout(response);
    return redirect(body.data.url);
  }

  async function portalRedirect(
    cookieHeader: string | undefined,
  ): Promise<Response> {
    const sessionCheck = await requireSession(cookieHeader);
    if (!sessionCheck.ok) return sessionCheck.response;

    const response = await apiRequest("/api/billing/portal", {}, cookieHeader);
    if (response.status === 401) return redirect("/login");
    if (response.status !== 200) {
      return htmlErrorPage(
        "Billing error",
        "Could not open billing portal. Please try again.",
      );
    }

    const body = await parsePortal(response);
    return redirect(body.data.url);
  }

  async function revokeDeviceHandler(
    request: Request,
    cookieHeader: string | undefined,
    deviceId: string,
  ): Promise<Response> {
    const sessionCheck = await requireSession(cookieHeader);
    if (!sessionCheck.ok) return sessionCheck.response;

    const form = await request.formData();
    if (String(form.get("confirm") ?? "") !== deviceId) {
      return redirect("/dashboard/devices");
    }

    const response = await apiRequest(
      "/api/auth/device/revoke",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId }),
      },
      cookieHeader,
    );

    if (response.status === 401) return redirect("/login");
    return redirect("/dashboard/devices");
  }

  async function deleteMemoryHandler(
    request: Request,
    cookieHeader: string | undefined,
    memoryId: string,
  ): Promise<Response> {
    const sessionCheck = await requireSession(cookieHeader);
    if (!sessionCheck.ok) return sessionCheck.response;

    const form = await request.formData();
    if (String(form.get("confirm") ?? "") !== "delete-memory") {
      return redirect("/dashboard/memories");
    }

    const response = await apiRequest(
      `/api/account/memory/${encodeURIComponent(memoryId)}`,
      { method: "DELETE" },
      cookieHeader,
    );

    if (response.status === 401) return redirect("/login");
    return redirect("/dashboard/memories");
  }

  async function deleteSelectedMemoriesHandler(
    request: Request,
    cookieHeader: string | undefined,
  ): Promise<Response> {
    const sessionCheck = await requireSession(cookieHeader);
    if (!sessionCheck.ok) return sessionCheck.response;

    const form = await request.formData();
    if (String(form.get("confirm") ?? "") !== "delete-selected-memories") {
      return redirect("/dashboard/memories");
    }

    const memoryIds = [...new Set(form.getAll("memoryId").map((value) => String(value)).filter(Boolean))];
    for (const memoryId of memoryIds) {
      const response = await apiRequest(
        `/api/account/memory/${encodeURIComponent(memoryId)}`,
        { method: "DELETE" },
        cookieHeader,
      );
      if (response.status === 401) return redirect("/login");
    }

    return redirect("/dashboard/memories");
  }

  async function submitMemoryForm(
    request: Request,
    cookieHeader: string | undefined,
    path: string,
    method: "POST" | "PATCH",
  ): Promise<Response> {
    const sessionCheck = await requireSession(cookieHeader);
    if (!sessionCheck.ok) return sessionCheck.response;

    const form = await request.formData();
    const content = String(form.get("content") ?? "");
    const response = await apiRequest(
      path,
      {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      },
      cookieHeader,
    );

    if (response.status === 401) return redirect("/login");
    return redirect("/dashboard/memories");
  }

  async function createMemoryHandler(
    request: Request,
    cookieHeader: string | undefined,
  ): Promise<Response> {
    return submitMemoryForm(request, cookieHeader, "/api/account/memory", "POST");
  }

  async function editMemoryHandler(
    request: Request,
    cookieHeader: string | undefined,
    memoryId: string,
  ): Promise<Response> {
    return submitMemoryForm(
      request,
      cookieHeader,
      `/api/account/memory/${encodeURIComponent(memoryId)}`,
      "PATCH",
    );
  }

  async function logoutHandler(
    request: Request,
    cookieHeader: string | undefined,
  ): Promise<Response> {
    const sessionCheck = await requireSession(cookieHeader);
    if (!sessionCheck.ok) return sessionCheck.response;

    const signOutResponse = await apiRequest(
      "/api/auth/sign-out",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: new URL(request.url).origin,
        },
        body: JSON.stringify({}),
      },
      cookieHeader,
    );
    const response = redirect("/");
    appendSetCookies(response, signOutResponse);
    return response;
  }

  async function downloadPage(cookieHeader: string | undefined): Promise<Response> {
    return publicPage(cookieHeader, createElement(DownloadPage, { latestVersion }), `${appName} Download`);
  }

  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const path = url.pathname;
      const cookieHeader = request.headers.get("cookie") ?? undefined;

      if (request.method === "GET" && config.assets && isPublicAsset(path)) {
        return config.assets.fetch(request);
      }

      if (path === "/styles.css" && request.method === "GET") {
        return stylesheet();
      }

      if (request.method === "GET") {
        const assetResponse = await publicAsset(path);
        if (assetResponse) return assetResponse;
      }

      if (path === "/" && request.method === "GET") {
        return homePage(cookieHeader);
      }

      if (path === "/pricing" && request.method === "GET") {
        return pricingPage(cookieHeader);
      }

      if (path === "/brand" && request.method === "GET") {
        return publicPage(
          cookieHeader,
          createElement(BrandPage),
          "Tab Brand Assets - Logos, colors, and usage",
          "Download the Tab mark and lockup in SVG, PNG, WebP, and JPG, with light and dark variants, brand colors, typography, and usage guidance.",
        );
      }

      if (path === "/about" && request.method === "GET") {
        return publicPage(
          cookieHeader,
          createElement(AboutPage),
          `About ${appName} - Native autocomplete for macOS`,
          "Why Tab brings deliberate, controllable autocomplete to the Mac apps where you already write.",
        );
      }

      if (path === "/contact" && request.method === "GET") {
        return publicPage(
          cookieHeader,
          createElement(ContactPage),
          `Contact ${appName}`,
          "Contact Tab for setup, privacy, billing, account help, or technical product feedback.",
        );
      }

      if (path === "/privacy" && request.method === "GET") {
        return publicPage(
          cookieHeader,
          createElement(PrivacyPage),
          `Privacy Policy - ${appName}`,
          "How Tab keeps Automatic Suggestions local and processes explicit Deep Complete requests, Personal Memory, telemetry, account, device, and billing data.",
        );
      }

      if (path === "/terms" && request.method === "GET") {
        return publicPage(
          cookieHeader,
          createElement(TermsPage),
          `Terms of Service - ${appName}`,
          "Terms governing Tab Free, Pro, and Max, paid-plan trials, billing, renewal, cancellation, and use of the native macOS app.",
        );
      }

      if (path === "/components" && request.method === "GET") {
        return publicPage(cookieHeader, createElement(ComponentReviewSurface), `${appName} Component Review`);
      }

      if (path === "/login") {
        if (request.method === "GET") return loginPage(undefined, path, url.searchParams, cookieHeader);
        if (request.method === "POST") return loginHandler(request, cookieHeader);
      }

      if (path === "/signup") {
        if (request.method === "GET") return signupPage(undefined, path, url.searchParams, cookieHeader);
        if (request.method === "POST") return signupHandler(request, cookieHeader);
      }

      if (path === "/forgot-password") {
        if (request.method === "GET") return forgotPasswordPage(cookieHeader);
        if (request.method === "POST") return forgotPasswordHandler(request, cookieHeader);
      }

      if (path === "/reset-password") {
        if (request.method === "GET") {
          const error = url.searchParams.get("error") === "INVALID_TOKEN"
            ? "This reset link is invalid or expired."
            : undefined;
          return resetPasswordPage(cookieHeader, error, url.searchParams.get("token") ?? undefined);
        }
        if (request.method === "POST") return resetPasswordHandler(request, cookieHeader);
      }

      if (path === "/logout" && request.method === "POST") {
        return logoutHandler(request, cookieHeader);
      }

      if (path === "/account" && request.method === "GET") {
        return redirect("/dashboard/account");
      }

      if (path === "/dashboard" && request.method === "GET") {
        return accountPage(cookieHeader, path, url.searchParams);
      }

      if (path === "/dashboard/account" && request.method === "GET") {
        return accountPage(cookieHeader, path, url.searchParams, "account");
      }

      if (path === "/dashboard/usage" && request.method === "GET") {
        return accountPage(cookieHeader, path, url.searchParams, "usage");
      }

      if (path === "/dashboard/devices" && request.method === "GET") {
        return accountPage(cookieHeader, path, url.searchParams, "devices");
      }

      if (path === "/dashboard/memories" && request.method === "GET") {
        return accountPage(cookieHeader, path, url.searchParams, "memories");
      }

      if (path === "/dashboard/memories/export" && request.method === "GET") {
        return memoryExport(cookieHeader);
      }

      if ((path === "/account/memory/create" || path === "/dashboard/memories/create") && request.method === "POST") {
        return createMemoryHandler(request, cookieHeader);
      }

      if (path === "/dashboard/memories/delete-selected" && request.method === "POST") {
        return deleteSelectedMemoriesHandler(request, cookieHeader);
      }

      if (path === "/billing/checkout" && request.method === "GET") {
        return checkoutRedirect(cookieHeader, url.searchParams);
      }

      if (path === "/billing/portal" && request.method === "GET") {
        return portalRedirect(cookieHeader);
      }

      if (
        (path.startsWith("/account/devices/") || path.startsWith("/dashboard/devices/")) &&
        path.endsWith("/revoke") &&
        request.method === "POST"
      ) {
        const deviceId = routeSegment(path, 3);
        if (deviceId) {
          return revokeDeviceHandler(request, cookieHeader, deviceId);
        }
      }

      if (
        (path.startsWith("/account/memory/") || path.startsWith("/dashboard/memories/")) &&
        path.endsWith("/edit") &&
        request.method === "POST"
      ) {
        const memoryId = routeSegment(path, 3);
        if (memoryId) {
          return editMemoryHandler(request, cookieHeader, memoryId);
        }
      }

      if (
        (path.startsWith("/account/memory/") || path.startsWith("/dashboard/memories/")) &&
        path.endsWith("/delete") &&
        request.method === "POST"
      ) {
        const memoryId = routeSegment(path, 3);
        if (memoryId) {
          return deleteMemoryHandler(request, cookieHeader, memoryId);
        }
      }

      if (path === "/download" && request.method === "GET") {
        return downloadPage(cookieHeader);
      }

      if (path === "/download/tab.dmg" && request.method === "GET") {
        return redirect(macDownloadUrl);
      }

      if (path === "/download/latest.json" && request.method === "GET") {
        return json({
          version: latestVersion,
          url: macDownloadUrl,
          notes: "",
        });
      }

      return publicPage(
        cookieHeader,
        createElement(MessagePage, { title: "Not found", message: `The page ${path} does not exist.` }),
        "Not found",
        undefined,
        404,
      );
    },
  };
}

export type WebApp = ReturnType<typeof createWebApp>;

export default {
  fetch(request: Request, runtimeEnv?: { ASSETS?: { fetch(request: Request): Promise<Response> }; TAB_API_BASE_URL?: string }) {
    return createWebApp({
      apiBaseUrl: runtimeEnv?.TAB_API_BASE_URL ?? env.TAB_API_BASE_URL,
      assets: runtimeEnv?.ASSETS,
    }).fetch(request);
  },
};
