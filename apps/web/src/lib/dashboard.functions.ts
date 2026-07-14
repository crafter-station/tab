import { createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { createRuntimeApiClient, getSetCookies } from "./api.server.ts";
import { getRuntimeConfig } from "./runtime.server.ts";
import { loadDashboardData } from "./dashboard.server.ts";

export const getDashboardData = createServerFn({ method: "GET" }).handler(async () => {
  const cookies: string[] = [];
  const data = await loadDashboardData(getRequest(), createRuntimeApiClient(getRuntimeConfig()), (response) => cookies.push(...getSetCookies(response)));
  if (cookies.length) setResponseHeader("set-cookie", cookies);
  setResponseHeader("cache-control", "private, no-store");
  setResponseHeader("vary", "Cookie");
  return data;
});
