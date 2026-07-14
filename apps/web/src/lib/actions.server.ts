import { MemoryWriteRequestSchema } from "@tab/contracts";
import { z } from "zod";
import {
  apiSchemas,
  appendSetCookies,
  cookieHeaderFromSetCookie,
  readApiError,
  type ApiClient,
} from "./api.server.ts";
import { safeNextPath } from "./search.ts";
import { optionalSession, requireSession } from "./session-api.server.ts";
import { parseDesktopAuthCallback } from "./desktop-auth-callback.ts";

const EmailSchema = z.email();
const LoginFormSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(1_000),
  device_id: z.string().max(500).optional(),
  callback: z.string().max(2_000).optional(),
  next: z.string().max(2_000).optional(),
});
const SignupFormSchema = LoginFormSchema.extend({ name: z.string().trim().min(1).max(200) });
const ForgotFormSchema = z.object({ email: EmailSchema });
const ResetFormSchema = z.object({ token: z.string().min(1).max(2_000), password: z.string().min(8).max(1_000) });
const VerifyEmailFormSchema = z.object({
  email: EmailSchema,
  callbackURL: z.string().max(4_000).optional(),
});
const IdSchema = z.string().min(1).max(500);
const VerificationStateCookie = "tab.verification_state";

function redirectResponse(location: string, headers = new Headers()): Response {
  headers.set("location", location);
  return new Response(null, { status: 303, headers });
}

function responseHeaders(...responses: Response[]): Headers {
  const headers = new Headers();
  for (const response of responses) appendSetCookies(headers, response);
  return headers;
}

function upstreamFailure(headers: Headers): Response {
  return new Response("Upstream request failed", { status: 502, headers });
}

function loginLocation(next?: string): string {
  const safeNext = safeNextPath(next);
  return safeNext ? `/login?next=${encodeURIComponent(safeNext)}` : "/login";
}

async function formObject(request: Request): Promise<Record<string, string>> {
  const form = await request.formData();
  return Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)]));
}

function authFailureLocation(path: "/login" | "/signup", values: Record<string, string>, error: string): string {
  const query = new URLSearchParams({ error });
  for (const key of ["device_id", "callback"] as const) if (values[key]) query.set(key, values[key]);
  const next = safeNextPath(values.next);
  if (next) query.set("next", next);
  return `${path}?${query}`;
}

function authContinuation(path: "/login" | "/signup", request: Request, values: {
  device_id?: string;
  callback?: string;
  next?: string;
}): URL {
  const continuation = new URL(path, request.url);
  if (values.device_id) continuation.searchParams.set("device_id", values.device_id);
  if (values.callback) continuation.searchParams.set("callback", values.callback);
  const next = safeNextPath(values.next);
  if (next) continuation.searchParams.set("next", next);
  return continuation;
}

function safeAuthContinuation(value: string | null | undefined, request: Request): URL {
  const fallback = new URL("/login", request.url);
  if (!value) return fallback;
  try {
    const continuation = new URL(value);
    if (continuation.origin !== fallback.origin || !["/login", "/signup"].includes(continuation.pathname)) return fallback;
    return continuation;
  } catch {
    return fallback;
  }
}

function verificationLocation(params: { status?: "sent"; error?: "expired" | "invalid" | "request_failed" | "device_failed" }, callbackURL: URL): string {
  const location = new URL("/verify-email", callbackURL.origin);
  if (params.status) location.searchParams.set("status", params.status);
  if (params.error) location.searchParams.set("error", params.error);
  location.searchParams.set("callbackURL", callbackURL.toString());
  return `${location.pathname}${location.search}`;
}

function verificationStateCookie(request: Request, value: string, maxAge = 60 * 60): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${VerificationStateCookie}=${encodeURIComponent(value)}; Path=/verify-email; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function requestCookie(request: Request, name: string): string | undefined {
  for (const part of request.headers.get("cookie")?.split(";") ?? []) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(value.join("="));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function withVerificationState(callbackURL: URL): { callbackURL: URL; state: string } {
  const state = crypto.randomUUID();
  callbackURL.searchParams.set("verification_state", state);
  return { callbackURL, state };
}

function loginAfterVerification(callbackURL: URL): string {
  const location = new URL("/login", callbackURL.origin);
  for (const key of ["device_id", "callback", "next"] as const) {
    const value = callbackURL.searchParams.get(key);
    if (value) location.searchParams.set(key, value);
  }
  location.searchParams.set("status", "email_verified");
  return `${location.pathname}${location.search}`;
}

function requestWithCookie(request: Request, cookie: string): Request {
  const headers = new Headers(request.headers);
  headers.set("cookie", cookie);
  return new Request(request.url, { headers });
}

async function authorizeDevice(
  request: Request,
  api: ApiClient,
  callback: string,
  sources: Response[],
  failureLocation = "/login?error=device_failed",
): Promise<Response> {
  const callbackUrl = parseDesktopAuthCallback(callback);
  if (!callbackUrl) {
    return redirectResponse(failureLocation, responseHeaders(...sources));
  }
  const cookie = cookieHeaderFromSetCookie(sources[0]!);
  if (!cookie) return redirectResponse(failureLocation, responseHeaders(...sources));
  const response = await api.request("/api/auth/device/authorize", requestWithCookie(request, cookie), { method: "POST" });
  if (!response.ok) return redirectResponse(failureLocation, responseHeaders(...sources, response));
  const body = apiSchemas.deviceAuthorize.parse(await response.json());
  callbackUrl.searchParams.set("code", body.code);
  const headers = new Headers();
  for (const source of sources) appendSetCookies(headers, source);
  appendSetCookies(headers, response);
  return redirectResponse(callbackUrl.toString(), headers);
}

export async function handleLogin(request: Request, api: ApiClient): Promise<Response> {
  let values: Record<string, string> = {};
  try {
    values = await formObject(request);
  } catch {
    return redirectResponse("/login?error=invalid_form");
  }
  const parsed = LoginFormSchema.safeParse(values);
  if (!parsed.success) return redirectResponse(authFailureLocation("/login", values, "invalid_form"));
  const { callbackURL: continuation, state: verificationState } = withVerificationState(authContinuation("/login", request, parsed.data));
  const response = await api.request("/api/auth/sign-in/email", request, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: parsed.data.email,
      password: parsed.data.password,
      rememberMe: true,
      callbackURL: continuation.toString(),
    }),
  });
  if (!response.ok) {
    if (response.status === 403) {
      const headers = responseHeaders(response);
      headers.append("set-cookie", verificationStateCookie(request, verificationState));
      return redirectResponse(verificationLocation({ status: "sent" }, continuation), headers);
    }
    return redirectResponse(
      authFailureLocation("/login", values, "invalid_credentials"),
      responseHeaders(response),
    );
  }
  if (parsed.data.device_id && parsed.data.callback) return authorizeDevice(request, api, parsed.data.callback, [response]);
  const headers = new Headers();
  appendSetCookies(headers, response);
  return redirectResponse(safeNextPath(parsed.data.next) ?? "/dashboard", headers);
}

export async function handleSignup(request: Request, api: ApiClient): Promise<Response> {
  let values: Record<string, string> = {};
  try {
    values = await formObject(request);
  } catch {
    return redirectResponse("/signup?error=invalid_form");
  }
  const parsed = SignupFormSchema.safeParse(values);
  if (!parsed.success) return redirectResponse(authFailureLocation("/signup", values, "invalid_form"));
  const { callbackURL: continuation, state: verificationState } = withVerificationState(authContinuation("/signup", request, parsed.data));
  const response = await api.request("/api/auth/sign-up/email", request, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: parsed.data.name,
      email: parsed.data.email,
      password: parsed.data.password,
      callbackURL: continuation.toString(),
    }),
  });
  if (!response.ok) return redirectResponse(authFailureLocation("/signup", values, "signup_failed"), responseHeaders(response));
  const headers = new Headers();
  appendSetCookies(headers, response);
  const cookie = cookieHeaderFromSetCookie(response);
  if (!cookie) {
    headers.append("set-cookie", verificationStateCookie(request, verificationState));
    return redirectResponse(verificationLocation({ status: "sent" }, continuation), headers);
  }
  const signedInRequest = requestWithCookie(request, cookie);
  const session = await optionalSession(signedInRequest, api);
  appendSetCookies(headers, session.response);
  if (session.user?.emailVerified === false) {
    headers.append("set-cookie", verificationStateCookie(request, verificationState));
    return redirectResponse(verificationLocation({ status: "sent" }, continuation), headers);
  }
  if (parsed.data.device_id && parsed.data.callback) return authorizeDevice(request, api, parsed.data.callback, [response, session.response]);
  return redirectResponse(safeNextPath(parsed.data.next) ?? "/dashboard", headers);
}

export async function handleVerifyEmail(request: Request, api: ApiClient): Promise<Response> {
  const requestUrl = new URL(request.url);
  const callbackURL = safeAuthContinuation(requestUrl.searchParams.get("callbackURL"), request);
  const cleanCallbackURL = new URL(callbackURL);
  cleanCallbackURL.searchParams.delete("verification_state");
  const verificationState = callbackURL.searchParams.get("verification_state");
  const stateMatches = Boolean(verificationState && requestCookie(request, VerificationStateCookie) === verificationState);
  const token = requestUrl.searchParams.get("token");
  if (!token || token.length > 4_000) {
    return redirectResponse(verificationLocation({ error: "invalid" }, cleanCallbackURL));
  }
  const query = new URLSearchParams({ token, callbackURL: callbackURL.toString() });
  const response = await api.request(`/api/auth/verify-email?${query}`, request, { redirect: "manual" });
  const headers = stateMatches ? responseHeaders(response) : new Headers();
  if (stateMatches) headers.append("set-cookie", verificationStateCookie(request, "", 0));
  const upstreamLocation = response.headers.get("location");
  if (upstreamLocation) {
    const error = new URL(upstreamLocation, callbackURL).searchParams.get("error")?.toLowerCase().replaceAll(" ", "_");
    if (error) {
      return redirectResponse(
        verificationLocation({ error: error.includes("expired") ? "expired" : "invalid" }, cleanCallbackURL),
        headers,
      );
    }
  }
  if (!response.ok && !upstreamLocation) {
    return redirectResponse(verificationLocation({ error: "invalid" }, cleanCallbackURL), headers);
  }
  if (!stateMatches || !cookieHeaderFromSetCookie(response)) {
    return redirectResponse(loginAfterVerification(cleanCallbackURL), headers);
  }
  const deviceId = cleanCallbackURL.searchParams.get("device_id");
  const desktopCallback = cleanCallbackURL.searchParams.get("callback");
  if (deviceId && desktopCallback) {
    const handoff = await authorizeDevice(
      request,
      api,
      desktopCallback,
      [response],
      verificationLocation({ error: "device_failed" }, cleanCallbackURL),
    );
    handoff.headers.append("set-cookie", verificationStateCookie(request, "", 0));
    return handoff;
  }
  return redirectResponse(`${cleanCallbackURL.pathname}${cleanCallbackURL.search}${cleanCallbackURL.hash}`, headers);
}

export async function handleResendVerification(request: Request, api: ApiClient): Promise<Response> {
  let values: Record<string, string>;
  try {
    values = await formObject(request);
  } catch {
    return redirectResponse("/verify-email?error=request_failed");
  }
  const parsed = VerifyEmailFormSchema.safeParse(values);
  const callbackURL = safeAuthContinuation(parsed.success ? parsed.data.callbackURL : undefined, request);
  callbackURL.searchParams.delete("verification_state");
  if (!parsed.success) return redirectResponse(verificationLocation({ error: "request_failed" }, callbackURL));
  const { callbackURL: statefulCallbackURL, state: verificationState } = withVerificationState(callbackURL);
  const response = await api.request("/api/auth/send-verification-email", request, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: parsed.data.email, callbackURL: statefulCallbackURL.toString() }),
  });
  const headers = responseHeaders(response);
  if (response.ok) headers.append("set-cookie", verificationStateCookie(request, verificationState));
  return redirectResponse(
    verificationLocation(response.ok ? { status: "sent" } : { error: "request_failed" }, statefulCallbackURL),
    headers,
  );
}

export async function handleForgotPassword(request: Request, api: ApiClient): Promise<Response> {
  let values: Record<string, string>;
  try {
    values = await formObject(request);
  } catch {
    return redirectResponse("/forgot-password?error=invalid_form");
  }
  const parsed = ForgotFormSchema.safeParse(values);
  if (!parsed.success) return redirectResponse("/forgot-password?error=invalid_form");
  const response = await api.request("/api/auth/request-password-reset", request, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: parsed.data.email, redirectTo: new URL("/reset-password", request.url).toString() }),
  });
  return redirectResponse(
    response.ok ? "/forgot-password?status=reset_sent" : "/forgot-password?error=request_failed",
    responseHeaders(response),
  );
}

export async function handleResetPassword(request: Request, api: ApiClient): Promise<Response> {
  let values: Record<string, string>;
  try {
    values = await formObject(request);
  } catch {
    return redirectResponse("/reset-password?error=invalid_form");
  }
  const parsed = ResetFormSchema.safeParse(values);
  if (!parsed.success) return redirectResponse(`/reset-password?error=invalid_form${values.token ? `&token=${encodeURIComponent(values.token)}` : ""}`);
  const response = await api.request("/api/auth/reset-password", request, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: parsed.data.token, newPassword: parsed.data.password }),
  });
  return redirectResponse(
    response.ok ? "/login" : `/reset-password?error=reset_failed&token=${encodeURIComponent(parsed.data.token)}`,
    responseHeaders(response),
  );
}

export async function handleLogout(request: Request, api: ApiClient): Promise<Response> {
  const upstream: Response[] = [];
  try {
    await requireSession(request, api, (response) => upstream.push(response));
  } catch {
    return redirectResponse("/", responseHeaders(...upstream));
  }
  const response = await api.request("/api/auth/sign-out", request, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  return redirectResponse("/", responseHeaders(...upstream, response));
}

export async function handleCheckout(request: Request, api: ApiClient): Promise<Response> {
  const url = new URL(request.url);
  const plan = z.enum(["free", "pro", "max"]).catch("pro").parse(url.searchParams.get("plan") ?? "pro");
  const checkoutPath = `/billing/checkout?plan=${encodeURIComponent(plan)}`;
  const upstream: Response[] = [];
  try {
    await requireSession(request, api, (response) => upstream.push(response));
  } catch {
    return redirectResponse(loginLocation(checkoutPath), responseHeaders(...upstream));
  }
  const response = await api.request(`/api/billing/checkout?plan=${encodeURIComponent(plan)}&interval=monthly`, request);
  upstream.push(response);
  if (response.status === 401) return redirectResponse(loginLocation(checkoutPath), responseHeaders(...upstream));
  if (response.status === 403) return redirectResponse("/signup?status=verify_email", responseHeaders(...upstream));
  if (!response.ok) {
    const error = await readApiError(response);
    const code = error?.code === "plan_change_required" ? "plan_change" : "billing";
    return redirectResponse(`/billing/error?code=${code}`, responseHeaders(...upstream));
  }
  const body = apiSchemas.checkout.parse(await response.json());
  return redirectResponse(body.data.url, responseHeaders(...upstream));
}

export async function handlePortal(request: Request, api: ApiClient): Promise<Response> {
  const upstream: Response[] = [];
  try {
    await requireSession(request, api, (response) => upstream.push(response));
  } catch {
    return redirectResponse("/login", responseHeaders(...upstream));
  }
  const response = await api.request("/api/billing/portal", request);
  upstream.push(response);
  if (response.status === 401) return redirectResponse("/login", responseHeaders(...upstream));
  if (!response.ok) return redirectResponse("/billing/error?code=portal", responseHeaders(...upstream));
  const body = apiSchemas.portal.parse(await response.json());
  return redirectResponse(body.data.url, responseHeaders(...upstream));
}

export async function handleDeviceRevoke(request: Request, api: ApiClient, rawDeviceId: string): Promise<Response> {
  const upstream: Response[] = [];
  try {
    await requireSession(request, api, (response) => upstream.push(response));
  } catch {
    return redirectResponse("/login", responseHeaders(...upstream));
  }
  const deviceId = IdSchema.parse(rawDeviceId);
  const form = await request.formData();
  if (String(form.get("confirm") ?? "") !== deviceId) return redirectResponse("/dashboard/devices", responseHeaders(...upstream));
  const response = await api.request("/api/auth/device/revoke", request, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId }),
  });
  upstream.push(response);
  if (response.status === 401) return redirectResponse("/login", responseHeaders(...upstream));
  if (!response.ok) return upstreamFailure(responseHeaders(...upstream));
  return redirectResponse("/dashboard/devices", responseHeaders(...upstream));
}

async function writeMemory(request: Request, api: ApiClient, path: string, method: "POST" | "PATCH"): Promise<Response> {
  const upstream: Response[] = [];
  try {
    await requireSession(request, api, (response) => upstream.push(response));
  } catch {
    return redirectResponse("/login", responseHeaders(...upstream));
  }
  const form = await request.formData();
  const parsed = MemoryWriteRequestSchema.safeParse({ content: form.get("content") });
  if (!parsed.success) return redirectResponse("/dashboard/memories?error=invalid_memory", responseHeaders(...upstream));
  const response = await api.request(path, request, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(parsed.data),
  });
  upstream.push(response);
  if (response.status === 401) return redirectResponse("/login", responseHeaders(...upstream));
  if (!response.ok) return upstreamFailure(responseHeaders(...upstream));
  return redirectResponse("/dashboard/memories", responseHeaders(...upstream));
}

export function handleMemoryCreate(request: Request, api: ApiClient): Promise<Response> {
  return writeMemory(request, api, "/api/account/memory", "POST");
}

export function handleMemoryEdit(request: Request, api: ApiClient, rawMemoryId: string): Promise<Response> {
  const memoryId = IdSchema.parse(rawMemoryId);
  return writeMemory(request, api, `/api/account/memory/${encodeURIComponent(memoryId)}`, "PATCH");
}

export async function handleMemoryDelete(request: Request, api: ApiClient, rawMemoryId: string): Promise<Response> {
  const upstream: Response[] = [];
  try {
    await requireSession(request, api, (response) => upstream.push(response));
  } catch {
    return redirectResponse("/login", responseHeaders(...upstream));
  }
  const memoryId = IdSchema.parse(rawMemoryId);
  const form = await request.formData();
  if (String(form.get("confirm") ?? "") !== "delete-memory") return redirectResponse("/dashboard/memories", responseHeaders(...upstream));
  const response = await api.request(`/api/account/memory/${encodeURIComponent(memoryId)}`, request, { method: "DELETE" });
  upstream.push(response);
  if (response.status === 401) return redirectResponse("/login", responseHeaders(...upstream));
  if (!response.ok) return upstreamFailure(responseHeaders(...upstream));
  return redirectResponse("/dashboard/memories", responseHeaders(...upstream));
}

export async function handleMemoryBulkDelete(request: Request, api: ApiClient): Promise<Response> {
  const upstream: Response[] = [];
  try {
    await requireSession(request, api, (response) => upstream.push(response));
  } catch {
    return redirectResponse("/login", responseHeaders(...upstream));
  }
  const form = await request.formData();
  if (String(form.get("confirm") ?? "") !== "delete-selected-memories") return redirectResponse("/dashboard/memories", responseHeaders(...upstream));
  const ids = [...new Set(form.getAll("memoryId").map(String))].map((id) => IdSchema.parse(id));
  for (const memoryId of ids) {
    const response = await api.request(`/api/account/memory/${encodeURIComponent(memoryId)}`, request, { method: "DELETE" });
    upstream.push(response);
    if (response.status === 401) return redirectResponse("/login", responseHeaders(...upstream));
    if (!response.ok) return upstreamFailure(responseHeaders(...upstream));
  }
  return redirectResponse("/dashboard/memories", responseHeaders(...upstream));
}

export async function handleMemoryExport(request: Request, api: ApiClient): Promise<Response> {
  const upstream: Response[] = [];
  try {
    await requireSession(request, api, (response) => upstream.push(response));
  } catch {
    return redirectResponse("/login", responseHeaders(...upstream));
  }
  const response = await api.request("/api/account/memory/export", request);
  upstream.push(response);
  if (response.status === 401) return redirectResponse("/login", responseHeaders(...upstream));
  if (!response.ok) return redirectResponse("/dashboard/memories?error=export_failed", responseHeaders(...upstream));
  const body = apiSchemas.memoryExport.parse(await response.json());
  const headers = responseHeaders(...upstream);
  headers.set("cache-control", "private, no-store");
  headers.set("content-disposition", 'attachment; filename="tab-personal-memory.json"');
  return Response.json(body, { headers });
}
