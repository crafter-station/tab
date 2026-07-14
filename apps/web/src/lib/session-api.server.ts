import { redirect } from "@tanstack/react-router";
import type { SessionUser } from "@tab/contracts";
import { readSession, type ApiClient } from "./api.server.ts";

export async function optionalSession(request: Request, api: ApiClient): Promise<{ user?: SessionUser; response: Response }> {
  const response = await api.request("/api/auth/get-session", request);
  return { user: await readSession(response), response };
}

export async function requireSession(request: Request, api: ApiClient, onResponse?: (response: Response) => void): Promise<SessionUser> {
  const { user, response } = await optionalSession(request, api);
  onResponse?.(response);
  if (!user) throw redirect({ href: "/login" });
  return user;
}
