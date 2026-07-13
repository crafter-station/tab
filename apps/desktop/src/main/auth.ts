import {
  DeviceTokenExchangeResponseSchema,
  type DeviceTokenExchangeRequest,
} from "@tab/contracts";
import type { Keychain } from "./keychain.ts";
import type { DesktopAuthStatus } from "./status.ts";

const TOKEN_SERVICE = "tab";
const TOKEN_ACCOUNT = "device-token";
export const DEFAULT_DESKTOP_AUTH_CALLBACK_URL = "tab://auth/callback";

declare const credentialGenerationBrand: unique symbol;
export type CredentialGeneration = number & {
  readonly [credentialGenerationBrand]: true;
};

export type DesktopAuthorizationObservation = {
  readonly authorizationHeader: string | null;
  readonly credentialGeneration: CredentialGeneration;
};

export type ObservedCredentialState =
  | "current_present"
  | "current_absent"
  | "stale";

export type SynchronousCredentialPublication = () => undefined;

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
  let credentialGeneration = 0 as CredentialGeneration;
  let credentialOperation = Promise.resolve();

  function enqueueCredentialOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = credentialOperation.then(operation);
    credentialOperation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function advanceCredentialGeneration(): void {
    credentialGeneration = (credentialGeneration + 1) as CredentialGeneration;
  }

  function buildBrowserLoginUrl({
    callbackUrl = DEFAULT_DESKTOP_AUTH_CALLBACK_URL,
  }: { callbackUrl?: string } = {}) {
    const url = new URL("/login", deps.webBaseUrl);
    url.searchParams.set("device_id", deps.deviceId);
    url.searchParams.set("callback", callbackUrl);
    return url.toString();
  }

  async function openBrowserLogin({
    callbackUrl,
  }: { callbackUrl?: string } = {}) {
    const url = buildBrowserLoginUrl({ callbackUrl });
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

    await enqueueCredentialOperation(async () => {
      await deps.keychain.set(TOKEN_SERVICE, TOKEN_ACCOUNT, parsed.data.token);
      advanceCredentialGeneration();
    });
    return parsed.data.token;
  }

  async function getToken(): Promise<string | null> {
    return enqueueCredentialOperation(() => deps.keychain.get(TOKEN_SERVICE, TOKEN_ACCOUNT));
  }

  async function clearToken(): Promise<void> {
    await enqueueCredentialOperation(async () => {
      await deps.keychain.remove(TOKEN_SERVICE, TOKEN_ACCOUNT);
      advanceCredentialGeneration();
    });
  }

  async function clearTokenForGeneration(
    observedGeneration: CredentialGeneration,
  ): Promise<boolean> {
    return enqueueCredentialOperation(async () => {
      if (credentialGeneration !== observedGeneration) return false;
      if ((await deps.keychain.get(TOKEN_SERVICE, TOKEN_ACCOUNT)) === null) return false;

      await deps.keychain.remove(TOKEN_SERVICE, TOKEN_ACCOUNT);
      advanceCredentialGeneration();
      return true;
    });
  }

  async function isAuthenticated(): Promise<boolean> {
    return enqueueCredentialOperation(async () => {
      const token = await deps.keychain.get(TOKEN_SERVICE, TOKEN_ACCOUNT);
      return token !== null;
    });
  }

  async function getCredentialState(
    observedGeneration: CredentialGeneration,
  ): Promise<ObservedCredentialState> {
    return enqueueCredentialOperation(async () => {
      if (credentialGeneration !== observedGeneration) return "stale";
      const token = await deps.keychain.get(TOKEN_SERVICE, TOKEN_ACCOUNT);
      return token === null ? "current_absent" : "current_present";
    });
  }

  async function isCredentialGenerationCurrent(
    observedGeneration: CredentialGeneration,
  ): Promise<boolean> {
    return enqueueCredentialOperation(async () => credentialGeneration === observedGeneration);
  }

  async function publishIfCredentialGenerationCurrent(
    observedGeneration: CredentialGeneration,
    publish: SynchronousCredentialPublication,
  ): Promise<boolean> {
    return enqueueCredentialOperation(async () => {
      if (credentialGeneration !== observedGeneration) return false;
      publish();
      return true;
    });
  }

  async function getAuthorizationHeader(): Promise<string | null> {
    const observation = await getAuthorizationObservation();
    return observation.authorizationHeader;
  }

  async function getAuthorizationObservation(): Promise<DesktopAuthorizationObservation> {
    return enqueueCredentialOperation(async () => {
      const token = await deps.keychain.get(TOKEN_SERVICE, TOKEN_ACCOUNT);
      return {
        authorizationHeader: token ? `Bearer ${token}` : null,
        credentialGeneration,
      };
    });
  }

  return {
    buildBrowserLoginUrl,
    openBrowserLogin,
    handleCallback,
    getToken,
    clearToken,
    clearTokenForGeneration,
    isAuthenticated,
    getCredentialState,
    isCredentialGenerationCurrent,
    publishIfCredentialGenerationCurrent,
    getAuthorizationHeader,
    getAuthorizationObservation,
  };
}

export type DesktopAuthClient = ReturnType<typeof createDesktopAuthClient>;

export type DesktopAuthSessionDependencies = {
  authClient: Pick<DesktopAuthClient, "clearTokenForGeneration" | "getCredentialState">;
  onSignedOut(): void | Promise<void>;
};

export function createDesktopAuthSession(deps: DesktopAuthSessionDependencies) {
  let consecutiveAuthFailures = 0;
  let failureGeneration: CredentialGeneration | null = null;
  let transitionQueue = Promise.resolve();
  const maxConsecutiveAuthFailures = 3;

  function resetFailures(): void {
    consecutiveAuthFailures = 0;
    failureGeneration = null;
  }

  async function notifySignedOut(): Promise<void> {
    try {
      await deps.onSignedOut();
    } catch (error) {
      console.error("Failed to show signed-out surface:", error);
    }
  }

  async function clearObservedCredential(
    credentialGeneration: CredentialGeneration,
    errorMessage: string,
  ): Promise<void> {
    let cleared = false;
    try {
      cleared = await deps.authClient.clearTokenForGeneration(credentialGeneration);
    } catch (error) {
      console.error(errorMessage, error);
      return;
    }

    if (cleared) {
      await notifySignedOut();
    }
  }

  async function applyStatus(
    status: DesktopAuthStatus,
    credentialGeneration: CredentialGeneration,
  ): Promise<void> {
    try {
      const credentialState = await deps.authClient.getCredentialState(credentialGeneration);
      if (credentialState === "stale") return;
      if (credentialState === "current_absent") {
        resetFailures();
        return;
      }
    } catch (error) {
      console.error("Failed to read desktop authentication state:", error);
      return;
    }

    if (status === "signed_in") {
      if (consecutiveAuthFailures > 0) {
        console.log(`Auth recovered after ${consecutiveAuthFailures} transient failure(s).`);
        resetFailures();
      }
      return;
    }

    if (status === "revoked_device") {
      resetFailures();
      console.warn("Device token revoked by server; signing out.");
      await clearObservedCredential(
        credentialGeneration,
        "Failed to clear revoked device token:",
      );
      return;
    }

    if (failureGeneration !== credentialGeneration) {
      consecutiveAuthFailures = 0;
      failureGeneration = credentialGeneration;
    }

    consecutiveAuthFailures += 1;
    console.warn(
      `Server reported sign-in required (failure ${consecutiveAuthFailures}/${maxConsecutiveAuthFailures}).`,
    );

    if (consecutiveAuthFailures < maxConsecutiveAuthFailures) return;

    console.error("Clearing device token after repeated sign-in-required responses.");
    resetFailures();
    await clearObservedCredential(
      credentialGeneration,
      "Failed to clear device token after repeated sign-in-required responses:",
    );
  }

  function handleStatus(
    status: DesktopAuthStatus,
    credentialGeneration: CredentialGeneration,
  ): Promise<void> {
    const transition = transitionQueue.then(() => applyStatus(status, credentialGeneration));
    transitionQueue = transition.catch((error) => {
      console.error("Failed to handle desktop authentication status:", error);
    });
    return transitionQueue;
  }

  return { handleStatus };
}

export type DesktopAuthSession = ReturnType<typeof createDesktopAuthSession>;
