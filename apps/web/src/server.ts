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
import {
  apiRequest as requestApi,
  appendSetCookies,
  cookieHeaderFromSetCookie,
  parseBillingQuota,
  parseDeviceAuthorize,
  parseDevices,
  parseMemories,
  parseCheckout,
  parsePortal,
} from "./lib/api.ts";

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

function html(body: ReactNode, title: string, status = 200, user?: User): Response {
  return new Response(renderPage(title, body, user), {
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
      actionHref: action?.href,
      actionLabel: action?.label,
    }),
    title,
  );
}

function verifyEmailPage(): Response {
  return htmlErrorPage(
    "Check your email",
    "We sent you a verification link. Verify your email address before choosing a plan in Polar.",
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
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

function routeSegment(path: string, index: number): string | undefined {
  const segment = path.split("/")[index];
  return segment ? decodeURIComponent(segment) : undefined;
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

  async function homePage(cookieHeader: string | undefined): Promise<Response> {
    const user = await getOptionalUser(cookieHeader);
    return html(createElement(HomePage), `${appName} - Native autocomplete for macOS`, 200, user);
  }

  async function pricingPage(cookieHeader: string | undefined): Promise<Response> {
    const user = await getOptionalUser(cookieHeader);
    return html(
      createElement(PricingPage, { authenticated: Boolean(user) }),
      `${appName} Pricing`,
      200,
      user,
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

    if (authorizeResponse.status === 402) {
      const checkoutResponse = await apiRequest(
        "/api/billing/checkout?plan=free",
        {},
        cookieHeader,
      );

      if (checkoutResponse.status === 200) {
        const body = await parseCheckout(checkoutResponse);
        const response = redirect(body.data.url);
        if (sourceResponse) appendSetCookies(response, sourceResponse);
        return response;
      }

      const response = redirect("/billing/checkout?plan=free");
      if (sourceResponse) appendSetCookies(response, sourceResponse);
      return response;
    }

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
    const next = safeNextPath(String(formData.get("next") ?? ""));

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
      return verifyEmailPage();
    }

    if (signInResponse.status === 200) {
      const signedInCookieHeader = cookieHeaderFromSetCookie(signInResponse);
      if (signedInCookieHeader) {
        const session = await getSession(signedInCookieHeader);
        if (session.ok && !session.user.emailVerified) {
          const response = verifyEmailPage();
          appendSetCookies(response, signInResponse);
          return response;
        }
      }
    }

    if (deviceId && callback && signInResponse.status === 200) {
      const signedInCookieHeader = cookieHeaderFromSetCookie(signInResponse);
      if (signedInCookieHeader) {
        return authorizeDeviceRedirect(callback, signedInCookieHeader, signInResponse);
      }
    }

    if (next && signInResponse.status === 200) {
      const response = redirect(next);
      appendSetCookies(response, signInResponse);
      return response;
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
          const body = await parseCheckout(checkoutResponse);
          const response = redirect(body.data.url);
          appendSetCookies(response, signInResponse);
          return response;
        }

        const response = redirect("/billing/checkout?plan=free");
        appendSetCookies(response, signInResponse);
        return response;
      }
    }

    const response = redirect("/dashboard");
    appendSetCookies(response, signInResponse.status === 200 ? signInResponse : signUpResponse);
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

    if (quotaResponse.status === 402) {
      return redirect("/billing/checkout?plan=free");
    }

    const quota = await parseBillingQuota(quotaResponse);
    const deviceList = await parseDevices(devicesResponse);
    const memoryList = await parseMemories(memoriesResponse);
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
      200,
      sessionCheck.user,
    );
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
      `/api/billing/checkout?plan=${encodeURIComponent(plan)}`,
      {},
      cookieHeader,
    );

    if (response.status === 401) return loginRedirect(checkoutPath);
    if (response.status === 403) return verifyEmailPage();
    if (response.status !== 200) {
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
    return redirect("/dashboard?tab=memories");
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
    cookieHeader: string | undefined,
  ): Promise<Response> {
    const sessionCheck = await requireSession(cookieHeader);
    if (!sessionCheck.ok) return sessionCheck.response;

    const signOutResponse = await apiRequest("/api/auth/sign-out", { method: "POST" }, cookieHeader);
    const response = redirect("/");
    appendSetCookies(response, signOutResponse);
    return response;
  }

  async function downloadPage(cookieHeader: string | undefined): Promise<Response> {
    const user = await getOptionalUser(cookieHeader);
    return html(createElement(DownloadPage, { latestVersion }), `${appName} Download`, 200, user);
  }

  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const path = url.pathname;
      const cookieHeader = request.headers.get("cookie") ?? undefined;

      if (path === "/styles.css" && request.method === "GET") {
        return stylesheet();
      }

      if (path === "/" && request.method === "GET") {
        return homePage(cookieHeader);
      }

      if (path === "/pricing" && request.method === "GET") {
        return pricingPage(cookieHeader);
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

      if (path === "/account/memory/create" && request.method === "POST") {
        return createMemoryHandler(request, cookieHeader);
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
        path.endsWith("/edit") &&
        request.method === "POST"
      ) {
        const memoryId = routeSegment(path, 3);
        if (memoryId) {
          return editMemoryHandler(request, cookieHeader, memoryId);
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
        return downloadPage(cookieHeader);
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
