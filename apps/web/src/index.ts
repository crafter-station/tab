import { createAuthClient } from "better-auth/client";

export { planQuotas as pricingPlans } from "@tabb/billing";
export { createWebApp, type WebAppConfig, type WebApp } from "./server.ts";
export { apiRequest, getApiBaseUrl, defaultApiBaseUrl } from "./lib/api.ts";
export { createAppRouter } from "./router.tsx";

export const webAppBoundary = {
  runtime: "tanstack-start-react",
  owns: [
    "marketing and download surface",
    "pricing and account management",
    "Personal Memory control plane",
    "device management",
  ],
} as const;

export type WebAuthClientConfig = {
  apiBaseUrl: string;
  fetch?: typeof globalThis.fetch;
};

export function createWebAuthClient(config: WebAuthClientConfig) {
  return createAuthClient({
    baseURL: `${config.apiBaseUrl}/api/auth`,
    fetchOptions: {
      customFetchImpl: config.fetch,
    },
  });
}

export function buildDeviceHandoffUrl({
  webBaseUrl,
  deviceId,
  callbackScheme = "tabb",
}: {
  webBaseUrl: string;
  deviceId: string;
  callbackScheme?: string;
}) {
  const url = new URL("/login", webBaseUrl);
  url.searchParams.set("device_id", deviceId);
  url.searchParams.set("callback", `${callbackScheme}://auth/callback`);
  return url.toString();
}
