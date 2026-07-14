import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import type { SessionUser } from "@tab/contracts";
import { createRuntimeApiClient, getSetCookies } from "./api.server.ts";
import { getRuntimeConfig } from "./runtime.server.ts";
import { optionalSession } from "./session-api.server.ts";

export async function getRequestSession(required = false): Promise<SessionUser | undefined> {
  const request = getRequest();
  const api = createRuntimeApiClient(getRuntimeConfig());
  let result: Awaited<ReturnType<typeof optionalSession>>;
  try {
    result = await optionalSession(request, api);
  } catch (error) {
    if (!required) return undefined;
    throw error;
  }
  const { user, response } = result;
  const cookies = getSetCookies(response);
  if (cookies.length) setResponseHeader("set-cookie", cookies);
  setResponseHeader("cache-control", "private, no-store");
  setResponseHeader("vary", "Cookie");
  if (required && !user) throw new Response(null, { status: 401 });
  return user;
}
