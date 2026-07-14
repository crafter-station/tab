import {
  ApiErrorResponseSchema,
  AuthSessionResponseSchema,
  BillingCheckoutResponseSchema,
  BillingPortalResponseSchema,
  BillingStatusResponseSchema,
  DeviceAuthorizeResponseSchema,
  DeviceListResponseSchema,
  LocalSuggestionActivityResponseSchema,
  MemoryExportResponseSchema,
  MemoryListResponseSchema,
  type ApiErrorResponse,
  type SessionUser,
} from "@tab/contracts";
import type { WebRuntimeConfig } from "./runtime.server.ts";

export type ApiClientConfig = {
  apiBaseUrl: string;
  fetch?: typeof globalThis.fetch;
};

export type ApiClient = ReturnType<typeof createApiClient>;

export function createApiClient(config: ApiClientConfig) {
  const apiBaseUrl = config.apiBaseUrl.replace(/\/$/, "");
  const fetchImpl = config.fetch ?? globalThis.fetch;

  return {
    request(path: string, request: Request, init: RequestInit = {}) {
      const headers = new Headers(init.headers);
      const cookie = request.headers.get("cookie");
      if (cookie) headers.set("cookie", cookie);
      if (!headers.has("origin")) headers.set("origin", new URL(request.url).origin);
      return fetchImpl(`${apiBaseUrl}${path}`, { ...init, headers });
    },
  };
}

export function createRuntimeApiClient(config: WebRuntimeConfig) {
  return createApiClient({ apiBaseUrl: config.TAB_API_BASE_URL });
}

export function getSetCookies(response: Response): string[] {
  return response.headers.getSetCookie?.() ?? [];
}

export function appendSetCookies(target: Headers, source: Response): void {
  for (const cookie of getSetCookies(source)) target.append("set-cookie", cookie);
}

export function cookieHeaderFromSetCookie(response: Response): string | undefined {
  const values = getSetCookies(response)
    .map((cookie) => cookie.split(";", 1)[0] ?? "")
    .filter(Boolean);
  return values.length ? values.join("; ") : undefined;
}

export async function readSession(response: Response): Promise<SessionUser | undefined> {
  if (!response.ok) return undefined;
  const session = AuthSessionResponseSchema.parse(await response.json());
  if (!session) return undefined;
  return {
    ...session.user,
    name: session.user.name ?? undefined,
    email: session.user.email ?? undefined,
  };
}

export async function readApiError(response: Response): Promise<ApiErrorResponse["error"] | undefined> {
  try {
    return ApiErrorResponseSchema.parse(await response.json()).error;
  } catch {
    return undefined;
  }
}

export const apiSchemas = {
  billing: BillingStatusResponseSchema,
  checkout: BillingCheckoutResponseSchema,
  portal: BillingPortalResponseSchema,
  deviceAuthorize: DeviceAuthorizeResponseSchema,
  devices: DeviceListResponseSchema,
  memories: MemoryListResponseSchema,
  memoryExport: MemoryExportResponseSchema,
  localActivity: LocalSuggestionActivityResponseSchema,
} as const;
