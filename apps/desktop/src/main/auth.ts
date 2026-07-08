import {
  DeviceTokenExchangeResponseSchema,
  type DeviceTokenExchangeRequest,
} from "@tab/contracts";
import type { Keychain } from "./keychain.ts";

const TOKEN_SERVICE = "tab";
const TOKEN_ACCOUNT = "device-token";

export type DesktopAuthClientDependencies = {
  apiBaseUrl: string;
  webBaseUrl: string;
  deviceId: string;
  appVersion: string;
  platform: string;
  keychain: Keychain;
  fetch?: typeof globalThis.fetch;
  openExternal?: (url: string) => void | Promise<void>;
};

export function createDesktopAuthClient(deps: DesktopAuthClientDependencies) {
  const http = deps.fetch ?? globalThis.fetch;

  function buildBrowserLoginUrl({
    callbackScheme = "tab",
  }: { callbackScheme?: string } = {}) {
    const callbackUrl = `${callbackScheme}://auth/callback`;
    const url = new URL("/login", deps.webBaseUrl);
    url.searchParams.set("device_id", deps.deviceId);
    url.searchParams.set("callback", callbackUrl);
    return url.toString();
  }

  async function openBrowserLogin({
    callbackScheme,
  }: { callbackScheme?: string } = {}) {
    const url = buildBrowserLoginUrl({ callbackScheme });
    if (deps.openExternal) {
      await deps.openExternal(url);
    }
    return url;
  }

  async function handleCallback(callbackUrl: string): Promise<string> {
    const url = new URL(callbackUrl);
    const code = url.searchParams.get("code");
    if (!code) {
      throw new Error("Missing authorization code in callback URL.");
    }

    const payload: DeviceTokenExchangeRequest = {
      code,
      deviceId: deps.deviceId,
      platform: deps.platform,
      appVersion: deps.appVersion,
    };

    const response = await http(`${deps.apiBaseUrl}/api/auth/device/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Device token exchange failed: ${body}`);
    }

    const raw = (await response.json()) as unknown;
    const parsed = DeviceTokenExchangeResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error("Invalid device token exchange response.");
    }

    await deps.keychain.set(TOKEN_SERVICE, TOKEN_ACCOUNT, parsed.data.token);
    return parsed.data.token;
  }

  async function getToken(): Promise<string | null> {
    return deps.keychain.get(TOKEN_SERVICE, TOKEN_ACCOUNT);
  }

  async function clearToken(): Promise<void> {
    await deps.keychain.remove(TOKEN_SERVICE, TOKEN_ACCOUNT);
  }

  async function isAuthenticated(): Promise<boolean> {
    return (await getToken()) !== null;
  }

  async function getAuthorizationHeader(): Promise<string | null> {
    const token = await getToken();
    return token ? `Bearer ${token}` : null;
  }

  return {
    buildBrowserLoginUrl,
    openBrowserLogin,
    handleCallback,
    getToken,
    clearToken,
    isAuthenticated,
    getAuthorizationHeader,
  };
}

export type DesktopAuthClient = ReturnType<typeof createDesktopAuthClient>;
