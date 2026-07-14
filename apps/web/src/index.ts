import { createAuthClient } from "better-auth/client";

export { planCapabilities as pricingPlans } from "@tab/billing";

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
  callbackScheme = "tab",
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
