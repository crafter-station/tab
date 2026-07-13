import {
  BillingCheckoutResponseSchema,
  BillingPortalResponseSchema,
  BillingStatusResponseSchema,
  DeviceAuthorizeResponseSchema,
  DeviceListResponseSchema,
  MemoryDeleteResponseSchema,
  MemoryListResponseSchema,
  LocalSuggestionActivityResponseSchema,
} from "@tab/contracts";
import { env } from "../env.ts";

export const defaultApiBaseUrl = "http://localhost:8787";

export function getApiBaseUrl() {
  return env.TAB_API_BASE_URL.replace(/\/$/, "");
}

export type ApiRequestOptions = RequestInit & {
  readonly apiBaseUrl?: string;
  readonly cookie?: string;
  readonly fetch?: typeof globalThis.fetch;
};

export async function apiRequest(path: string, options: ApiRequestOptions = {}) {
  const { apiBaseUrl = getApiBaseUrl(), cookie, fetch: fetchImpl = globalThis.fetch, ...init } = options;
  const headers = new Headers(init.headers);

  if (cookie) {
    headers.set("cookie", cookie);
  }

  if (!headers.has("origin")) {
    headers.set("origin", apiBaseUrl);
  }

  return fetchImpl(`${apiBaseUrl}${path}`, { ...init, headers });
}

export function appendSetCookies(target: Response, source: Response) {
  for (const cookie of source.headers.getSetCookie?.() ?? []) {
    target.headers.append("set-cookie", cookie);
  }
}

export function cookieHeaderFromSetCookie(source: Response) {
  const pairs = (source.headers.getSetCookie?.() ?? [])
    .map((cookie) => cookie.split(";", 1)[0] ?? "")
    .filter(Boolean);
  return pairs.length > 0 ? pairs.join("; ") : undefined;
}

export async function parseBillingStatus(response: Response) {
  return BillingStatusResponseSchema.parse(await response.json());
}

export const parseBillingQuota = parseBillingStatus;

export async function parseDevices(response: Response) {
  return DeviceListResponseSchema.parse(await response.json());
}

export async function parseMemories(response: Response) {
  return MemoryListResponseSchema.parse(await response.json());
}

export async function parseLocalSuggestionActivity(response: Response) {
  return LocalSuggestionActivityResponseSchema.parse(await response.json());
}

export async function parseDeviceAuthorize(response: Response) {
  return DeviceAuthorizeResponseSchema.parse(await response.json());
}

export async function parseCheckout(response: Response) {
  return BillingCheckoutResponseSchema.parse(await response.json());
}

export async function parsePortal(response: Response) {
  return BillingPortalResponseSchema.parse(await response.json());
}

export async function parseMemoryDelete(response: Response) {
  return MemoryDeleteResponseSchema.parse(await response.json());
}

export function redirectResponse(location: string, status = 302) {
  return new Response(null, { status, headers: { location } });
}
