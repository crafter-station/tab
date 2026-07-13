import {
  ApiErrorResponseSchema,
  DesktopStatusResponseSchema,
} from "@tab/contracts";
import type {
  CredentialGeneration,
  DesktopAuthorizationObservation,
  SynchronousCredentialPublication,
} from "./auth.ts";

export type DesktopAuthStatus =
  | "sign_in_required"
  | "signed_in"
  | "revoked_device";

export type DesktopConnectivityStatus = "online" | "offline";

export type DesktopOverlayStatus = "hidden";

export type DesktopQuotaStatus = {
  readonly planId: string;
  readonly quota: number;
  readonly usage: number;
  readonly resetAt: string;
  readonly exhausted: boolean;
};

export type DesktopStatus = {
  readonly auth: DesktopAuthStatus;
  readonly connectivity: DesktopConnectivityStatus;
  readonly userId: string | null;
  readonly quota: DesktopQuotaStatus | null;
  readonly localSuggestionActivity?: {
    readonly accepted: number;
    readonly averageAcceptanceLatencyMs: number | null;
  };
  readonly overlay: DesktopOverlayStatus;
  readonly lastUpdatedAt: Date | null;
};

export type DesktopStatusServiceDependencies = {
  apiBaseUrl: string;
  getAuthorizationObservation(): Promise<DesktopAuthorizationObservation>;
  isCredentialGenerationCurrent(
    credentialGeneration: CredentialGeneration,
  ): Promise<boolean>;
  publishIfCredentialGenerationCurrent(
    credentialGeneration: CredentialGeneration,
    publish: SynchronousCredentialPublication,
  ): Promise<boolean>;
  fetch?: typeof globalThis.fetch;
  onChange?(
    status: DesktopStatus,
    credentialGeneration: CredentialGeneration | null,
  ): void;
};

function createInitialStatus(): DesktopStatus {
  return {
    auth: "sign_in_required",
    connectivity: "online",
    userId: null,
    quota: null,
    overlay: "hidden",
    lastUpdatedAt: null,
  };
}

function isRevokedDeviceError(body: unknown): boolean {
  const parsed = ApiErrorResponseSchema.safeParse(body);
  return parsed.success && parsed.data.error.code === "revoked_device";
}

function isUnauthenticatedError(body: unknown): boolean {
  const parsed = ApiErrorResponseSchema.safeParse(body);
  return parsed.success && parsed.data.error.code === "unauthenticated";
}

function markUpdated(status: Omit<DesktopStatus, "lastUpdatedAt">): DesktopStatus {
  return {
    ...status,
    lastUpdatedAt: new Date(),
  };
}

export function createDesktopStatusService(deps: DesktopStatusServiceDependencies) {
  const http = deps.fetch ?? globalThis.fetch;
  let currentStatus: DesktopStatus = createInitialStatus();
  let refreshSequence = 0;

  function emit(
    status: DesktopStatus,
    credentialGeneration: CredentialGeneration | null,
  ): void {
    currentStatus = status;
    deps.onChange?.(status, credentialGeneration);
  }

  async function canAccept(
    sequence: number,
    credentialGeneration: CredentialGeneration,
  ): Promise<boolean> {
    if (sequence !== refreshSequence) return false;
    const generationIsCurrent = await deps.isCredentialGenerationCurrent(credentialGeneration);
    return generationIsCurrent && sequence === refreshSequence;
  }

  async function accept(
    status: DesktopStatus,
    sequence: number,
    credentialGeneration: CredentialGeneration,
  ): Promise<DesktopStatus> {
    if (sequence !== refreshSequence) return currentStatus;
    let accepted = false;
    const generationIsCurrent = await deps.publishIfCredentialGenerationCurrent(
      credentialGeneration,
      () => {
        if (sequence !== refreshSequence) return undefined;
        emit(status, credentialGeneration);
        accepted = true;
        return undefined;
      },
    );
    return generationIsCurrent && accepted ? status : currentStatus;
  }

  async function refresh(): Promise<DesktopStatus> {
    const sequence = ++refreshSequence;
    let authorizationObservation: DesktopAuthorizationObservation;
    try {
      authorizationObservation = await deps.getAuthorizationObservation();
    } catch (error) {
      if (sequence !== refreshSequence) return currentStatus;
      console.error("Failed to read desktop authorization:", error);
      const status = markUpdated({
        ...currentStatus,
        connectivity: "offline",
        overlay: "hidden",
      });
      if (sequence !== refreshSequence) return currentStatus;
      emit(status, null);
      return status;
    }

    const { authorizationHeader, credentialGeneration } = authorizationObservation;
    if (!(await canAccept(sequence, credentialGeneration))) return currentStatus;

    if (!authorizationHeader) {
      const status = markUpdated(createInitialStatus());
      return accept(status, sequence, credentialGeneration);
    }

    try {
      const response = await http(`${deps.apiBaseUrl}/api/status`, {
        method: "GET",
        headers: {
          Authorization: authorizationHeader,
          Accept: "application/json",
        },
      });
      if (!(await canAccept(sequence, credentialGeneration))) return currentStatus;

      if (response.status === 401) {
        const body = (await response.json()) as unknown;
        if (!(await canAccept(sequence, credentialGeneration))) return currentStatus;
        if (isRevokedDeviceError(body)) {
          const status = markUpdated({
            ...createInitialStatus(),
            auth: "revoked_device",
            connectivity: "online",
            overlay: "hidden",
          });
          return accept(status, sequence, credentialGeneration);
        }

        if (isUnauthenticatedError(body)) {
          const status = markUpdated({
            ...createInitialStatus(),
            connectivity: "online",
            overlay: "hidden",
          });
          return accept(status, sequence, credentialGeneration);
        }
      }

      if (!response.ok) {
        const status = createOfflineStatus();
        return accept(status, sequence, credentialGeneration);
      }

      const raw = (await response.json()) as unknown;
      if (!(await canAccept(sequence, credentialGeneration))) return currentStatus;
      const parsed = DesktopStatusResponseSchema.safeParse(raw);

      if (!parsed.success) {
        const status = createOfflineStatus();
        return accept(status, sequence, credentialGeneration);
      }

      const data = parsed.data.data;
      const status = markUpdated({
        auth: "signed_in",
        connectivity: "online",
        userId: data.userId ?? currentStatus.userId,
        quota: data.quota !== undefined && data.usage !== undefined && data.planId && data.resetAt
          ? {
              planId: data.planId,
              quota: data.quota,
              usage: data.usage,
              resetAt: data.resetAt,
              exhausted: data.usage >= data.quota,
            }
          : null,
        ...(data.localSuggestionActivity
          ? { localSuggestionActivity: data.localSuggestionActivity }
          : {}),
        overlay: "hidden",
      });
      return accept(status, sequence, credentialGeneration);
    } catch {
      if (!(await canAccept(sequence, credentialGeneration))) return currentStatus;
      // If we have a stored token but cannot reach the API, preserve the last
      // known auth state; on the first failure assume signed_in because the
      // token exists. Status UI surfaces the connectivity issue separately from
      // the overlay.
      const status = createOfflineStatus();
      return accept(status, sequence, credentialGeneration);
    }
  }

  function createOfflineStatus(): DesktopStatus {
    return markUpdated({
      ...currentStatus,
      auth: currentStatus.auth === "sign_in_required" ? "signed_in" : currentStatus.auth,
      connectivity: "offline",
      overlay: "hidden",
    });
  }

  function getCurrentStatus(): DesktopStatus {
    return currentStatus;
  }

  return {
    refresh,
    getCurrentStatus,
  };
}

export type DesktopStatusService = ReturnType<typeof createDesktopStatusService>;
