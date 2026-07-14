import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { apiSchemas, createRuntimeApiClient, getSetCookies } from "./api.server.ts";
import { parseDesktopAuthCallback } from "./desktop-auth-callback.ts";
import { getRuntimeConfig } from "./runtime.server.ts";
import { requireSession } from "./session-api.server.ts";

export const authorizeExistingDevice = createServerFn({ method: "POST" })
  .validator(z.object({ callback: z.string().max(2_000), deviceId: z.string().max(500) }))
  .handler(async ({ data }) => {
    const callback = parseDesktopAuthCallback(data.callback);
    if (!callback) throw redirect({ href: "/login?error=device_failed" });
    const request = getRequest();
    const retry = new URL("/verify-email", request.url);
    const continuation = new URL("/login", retry.origin);
    continuation.searchParams.set("device_id", data.deviceId);
    continuation.searchParams.set("callback", data.callback);
    retry.searchParams.set("error", "device_failed");
    retry.searchParams.set("callbackURL", continuation.toString());
    const api = createRuntimeApiClient(getRuntimeConfig());
    const cookies: string[] = [];
    await requireSession(request, api, (response) => cookies.push(...getSetCookies(response)));
    const response = await api.request("/api/auth/device/authorize", request, { method: "POST" });
    if (!response.ok) throw redirect({ href: `${retry.pathname}${retry.search}` });
    cookies.push(...getSetCookies(response));
    if (cookies.length) setResponseHeader("set-cookie", cookies);
    const body = apiSchemas.deviceAuthorize.parse(await response.json());
    callback.searchParams.set("code", body.code);
    throw redirect({ href: callback.toString() });
  });
