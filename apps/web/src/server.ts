import {
  BillingQuotaResponseSchema,
  DeviceAuthorizeResponseSchema,
  DeviceListResponseSchema,
  MemoryListResponseSchema,
} from "@tabb/contracts";
import { createElement } from "react";
import type { ReactNode } from "react";
import {
  DashboardPage,
  DownloadPage,
  ForgotPasswordPage,
  HomePage,
  LoginPage,
  MessagePage,
  PricingPage,
  ResetPasswordPage,
  SignupPage,
  type AuthSearch,
  type User,
} from "./components/web-pages.tsx";
import { env } from "./env.ts";
import { renderPage } from "./render-page.tsx";

export type WebAppConfig = {
  apiBaseUrl: string;
  fetch?: typeof globalThis.fetch;
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

function html(body: ReactNode, title: string, status = 200): Response {
  return new Response(renderPage(title, body), {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function htmlErrorPage(
  title: string,
  message: string,
): Response {
  return html(createElement(MessagePage, { title, message }), title);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function routeSegment(path: string, index: number): string | undefined {
  const segment = path.split("/")[index];
  return segment ? decodeURIComponent(segment) : undefined;
}

function setCookies(response: Response, source: Response): void {
  const cookies = source.headers.getSetCookie?.() ?? [];
  for (const cookie of cookies) {
    response.headers.append("set-cookie", cookie);
  }
}

function cookieHeaderFromSetCookie(source: Response): string | undefined {
  const cookies = source.headers.getSetCookie?.() ?? [];
  const pairs = cookies
    .map((cookie) => cookie.split(";", 1)[0] ?? "")
    .filter((cookie) => cookie.length > 0);
  return pairs.length > 0 ? pairs.join("; ") : undefined;
}

export function createWebApp(config: WebAppConfig) {
  const baseUrl = config.apiBaseUrl.replace(/\/$/, "");
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const appName = config.appName ?? "Tabb";
  const macDownloadUrl = config.macDownloadUrl ?? env.TABB_MAC_DOWNLOAD_URL;
  const latestVersion = config.latestVersion ?? env.TABB_DESKTOP_LATEST_VERSION;

  async function apiRequest(
    path: string,
    init: RequestInit = {},
    cookieHeader?: string,
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    if (cookieHeader) {
      headers.set("cookie", cookieHeader);
    }
    if (!headers.has("origin")) {
      headers.set("origin", baseUrl);
    }

    const url = `${baseUrl}${path}`;
    return fetchImpl(url, { ...init, headers });
  }

  async function getSession(
    cookieHeader: string | undefined,
  ): Promise<SessionResult> {
    const response = await apiRequest("/api/auth/get-session", {}, cookieHeader);
    if (response.status !== 200) {
      return {
        ok: false,
        response: redirect("/login"),
      };
    }

    const body = (await response.json()) as { user?: User };
    if (!body.user?.id) {
      return {
        ok: false,
        response: redirect("/login"),
      };
    }

    return { ok: true, user: body.user };
  }

  async function requireSession(
    cookieHeader: string | undefined,
  ): Promise<SessionResult> {
    return getSession(cookieHeader);
  }

  function homePage(): Response {
    return html(createElement(HomePage), `${appName} - Native autocomplete for macOS`);
  }

  function pricingPage(): Response {
    return html(createElement(PricingPage), `${appName} Pricing`);
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

    const authorize = DeviceAuthorizeResponseSchema.parse(await authorizeResponse.json());
    const callbackUrl = new URL(callback);
    callbackUrl.searchParams.set("code", authorize.code);
    const response = redirect(callbackUrl.toString());
    if (sourceResponse) setCookies(response, sourceResponse);
    return response;
  }

  function authSearchFromParams(searchParams: URLSearchParams): AuthSearch {
    return {
      device_id: searchParams.get("device_id") ?? undefined,
      callback: searchParams.get("callback") ?? undefined,
    };
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

    return html(
      createElement(LoginPage, { search: authSearchFromParams(searchParams), error }),
      `Sign in - ${appName}`,
    );
  }

  function signupPage(error?: string, _path = "/signup", searchParams = new URLSearchParams()): Response {
    return html(
      createElement(SignupPage, { search: authSearchFromParams(searchParams), error }),
      `Sign up - ${appName}`,
    );
  }

  function forgotPasswordPage(error?: string, sent = false): Response {
    return html(
      createElement(ForgotPasswordPage, { error, sent }),
      `Reset password - ${appName}`,
    );
  }

  function resetPasswordPage(error?: string, token?: string): Response {
    return html(
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

    const signInResponse = await apiRequest(
      "/api/auth/sign-in/email",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, rememberMe: true }),
      },
      cookieHeader,
    );

    if (signInResponse.status !== 200) {
      if (signInResponse.status === 403) {
        return loginPage("Check your email to verify your account before signing in.");
      }
      return loginPage("Invalid email or password.");
    }

    if (deviceId && callback) {
      const signedInCookieHeader = cookieHeaderFromSetCookie(signInResponse);
      if (!signedInCookieHeader) {
        return loginPage("Signed in, but failed to authorize this device.");
      }
      return authorizeDeviceRedirect(callback, signedInCookieHeader, signInResponse);
    }

    const response = redirect("/dashboard");
    setCookies(response, signInResponse);
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

    const signUpResponse = await apiRequest(
      "/api/auth/sign-up/email",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      },
      cookieHeader,
    );

    if (signUpResponse.status !== 200) {
      return signupPage("Could not create that account.");
    }

    const signInResponse = await apiRequest(
      "/api/auth/sign-in/email",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, rememberMe: true }),
      },
      cookieHeader,
    );

    if (signInResponse.status === 403) {
      return htmlErrorPage(
        "Check your email",
        "We sent you a verification link. Verify your email address before signing in to Tabb.",
      );
    }

    if (deviceId && callback && signInResponse.status === 200) {
      const signedInCookieHeader = cookieHeaderFromSetCookie(signInResponse);
      if (signedInCookieHeader) {
        return authorizeDeviceRedirect(callback, signedInCookieHeader, signInResponse);
      }
    }

    if (signInResponse.status === 200) {
      const signedInCookieHeader = cookieHeaderFromSetCookie(signInResponse);
      if (signedInCookieHeader) {
        const checkoutResponse = await apiRequest(
          "/api/billing/checkout?plan=free",
          {},
          signedInCookieHeader,
        );

        if (checkoutResponse.status === 200) {
          const body = (await checkoutResponse.json()) as { data: { url: string } };
          const response = redirect(body.data.url);
          setCookies(response, signInResponse);
          return response;
        }

        const response = redirect("/billing/checkout?plan=free");
        setCookies(response, signInResponse);
        return response;
      }
    }

    const response = redirect("/dashboard");
    setCookies(response, signInResponse.status === 200 ? signInResponse : signUpResponse);
    return response;
  }

  async function forgotPasswordHandler(request: Request): Promise<Response> {
    let formData;
    try {
      formData = await request.formData();
    } catch {
      return forgotPasswordPage("Invalid form submission.");
    }

    const email = String(formData.get("email") ?? "");
    const redirectTo = new URL("/reset-password", request.url).toString();
    const response = await apiRequest("/api/auth/request-password-reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, redirectTo }),
    });

    if (response.status !== 200) {
      return forgotPasswordPage("Could not send a reset link. Please try again.");
    }

    return forgotPasswordPage(undefined, true);
  }

  async function resetPasswordHandler(request: Request): Promise<Response> {
    let formData;
    try {
      formData = await request.formData();
    } catch {
      return resetPasswordPage("Invalid form submission.");
    }

    const token = String(formData.get("token") ?? "");
    const newPassword = String(formData.get("password") ?? "");
    const response = await apiRequest("/api/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, newPassword }),
    });

    if (response.status !== 200) {
      return resetPasswordPage("Could not update your password. Request a new reset link and try again.", token);
    }

    return redirect("/login");
  }

  async function accountPage(
    cookieHeader: string | undefined,
    _path: string,
    _searchParams: URLSearchParams,
  ): Promise<Response> {
    const sessionCheck = await requireSession(cookieHeader);
    if (!sessionCheck.ok) return sessionCheck.response;

    const [quotaResponse, devicesResponse, memoriesResponse] = await Promise.all([
      apiRequest("/api/billing/quota", {}, cookieHeader),
      apiRequest("/api/auth/devices", {}, cookieHeader),
      apiRequest("/api/account/memory", {}, cookieHeader),
    ]);

    if (quotaResponse.status === 401) {
      return redirect("/login");
    }

    const quota = BillingQuotaResponseSchema.parse(await quotaResponse.json());
    const deviceList = DeviceListResponseSchema.parse(await devicesResponse.json());
    const memoryList = MemoryListResponseSchema.parse(await memoriesResponse.json());
    return html(
      createElement(DashboardPage, {
        data: {
          user: sessionCheck.user,
          quota: quota.data,
          devices: deviceList.data.devices,
          memories: memoryList.data.memories,
        },
      }),
      `Dashboard - ${appName}`,
    );
  }

  async function checkoutRedirect(
    cookieHeader: string | undefined,
    searchParams: URLSearchParams,
  ): Promise<Response> {
    const sessionCheck = await requireSession(cookieHeader);
    if (!sessionCheck.ok) return sessionCheck.response;

    const plan = searchParams.get("plan") ?? "pro";
    const response = await apiRequest(
      `/api/billing/checkout?plan=${encodeURIComponent(plan)}`,
      {},
      cookieHeader,
    );

    if (response.status === 401) return redirect("/login");
    if (response.status !== 200) {
      return htmlErrorPage(
        "Checkout error",
        "Could not start checkout. Please try again.",
      );
    }

    const body = (await response.json()) as { data: { url: string } };
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

    const body = (await response.json()) as { data: { url: string } };
    return redirect(body.data.url);
  }

  async function revokeDeviceHandler(
    cookieHeader: string | undefined,
    deviceId: string,
  ): Promise<Response> {
    const sessionCheck = await requireSession(cookieHeader);
    if (!sessionCheck.ok) return sessionCheck.response;

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
    return redirect("/dashboard?tab=devices");
  }

  async function deleteMemoryHandler(
    cookieHeader: string | undefined,
    memoryId: string,
  ): Promise<Response> {
    const sessionCheck = await requireSession(cookieHeader);
    if (!sessionCheck.ok) return sessionCheck.response;

    const response = await apiRequest(
      `/api/account/memory/${encodeURIComponent(memoryId)}`,
      { method: "DELETE" },
      cookieHeader,
    );

    if (response.status === 401) return redirect("/login");
    return redirect("/dashboard?tab=memories");
  }

  async function logoutHandler(
    cookieHeader: string | undefined,
  ): Promise<Response> {
    const sessionCheck = await requireSession(cookieHeader);
    if (!sessionCheck.ok) return sessionCheck.response;

    const signOutResponse = await apiRequest("/api/auth/sign-out", { method: "POST" }, cookieHeader);
    const response = redirect("/");
    setCookies(response, signOutResponse);
    return response;
  }

  function downloadPage(): Response {
    return html(createElement(DownloadPage, { latestVersion }), `${appName} Download`);
  }

  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const path = url.pathname;
      const cookieHeader = request.headers.get("cookie") ?? undefined;

      if (path === "/" && request.method === "GET") {
        return homePage();
      }

      if (path === "/pricing" && request.method === "GET") {
        return pricingPage();
      }

      if (path === "/login") {
        if (request.method === "GET") return loginPage(undefined, path, url.searchParams, cookieHeader);
        if (request.method === "POST") return loginHandler(request, cookieHeader);
      }

      if (path === "/signup") {
        if (request.method === "GET") return signupPage(undefined, path, url.searchParams);
        if (request.method === "POST") return signupHandler(request, cookieHeader);
      }

      if (path === "/forgot-password") {
        if (request.method === "GET") return forgotPasswordPage();
        if (request.method === "POST") return forgotPasswordHandler(request);
      }

      if (path === "/reset-password") {
        if (request.method === "GET") {
          const error = url.searchParams.get("error") === "INVALID_TOKEN"
            ? "This reset link is invalid or expired."
            : undefined;
          return resetPasswordPage(error, url.searchParams.get("token") ?? undefined);
        }
        if (request.method === "POST") return resetPasswordHandler(request);
      }

      if (path === "/logout" && request.method === "POST") {
        return logoutHandler(cookieHeader);
      }

      if (path === "/account" && request.method === "GET") {
        return redirect("/dashboard");
      }

      if (path === "/dashboard" && request.method === "GET") {
        return accountPage(cookieHeader, path, url.searchParams);
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
          return revokeDeviceHandler(cookieHeader, deviceId);
        }
      }

      if (
        (path.startsWith("/account/memory/") || path.startsWith("/dashboard/memory/")) &&
        path.endsWith("/delete") &&
        request.method === "POST"
      ) {
        const memoryId = routeSegment(path, 3);
        if (memoryId) {
          return deleteMemoryHandler(cookieHeader, memoryId);
        }
      }

      if (path === "/download" && request.method === "GET") {
        return downloadPage();
      }

      if (path === "/download/tabb.dmg" && request.method === "GET") {
        return redirect(macDownloadUrl);
      }

      if (path === "/download/latest.json" && request.method === "GET") {
        return json({
          version: latestVersion,
          url: macDownloadUrl,
          notes: "",
        });
      }

      return html(
        createElement(MessagePage, { title: "Not found", message: `The page ${path} does not exist.` }),
        "Not found",
        404,
      );
    },
  };
}

export type WebApp = ReturnType<typeof createWebApp>;

const devServerApp = createWebApp({
  apiBaseUrl: env.TABB_API_BASE_URL,
});

export default {
  fetch: devServerApp.fetch,
};
