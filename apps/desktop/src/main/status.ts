import {
  ApiErrorResponseSchema,
  DesktopStatusResponseSchema,
} from "@tab/contracts";

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
  readonly overlay: DesktopOverlayStatus;
  readonly lastUpdatedAt: Date | null;
};

export type DesktopStatusServiceDependencies = {
  apiBaseUrl: string;
  getAuthorizationHeader(): Promise<string | null>;
  fetch?: typeof globalThis.fetch;
  onChange?(status: DesktopStatus): void;
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

  function emit(status: DesktopStatus): void {
    currentStatus = status;
    deps.onChange?.(status);
  }

  async function refresh(): Promise<DesktopStatus> {
    const authorization = await deps.getAuthorizationHeader();

    if (!authorization) {
      const status = markUpdated(createInitialStatus());
      emit(status);
      return status;
    }

    // Assume signed_in optimistically while the request is in flight.
    currentStatus = {
      ...currentStatus,
      auth: currentStatus.auth === "sign_in_required" ? "signed_in" : currentStatus.auth,
    };

    try {
      const response = await http(`${deps.apiBaseUrl}/api/status`, {
        method: "GET",
        headers: {
          Authorization: authorization,
          Accept: "application/json",
        },
      });

      if (response.status === 401) {
        const body = (await response.json()) as unknown;
        if (isRevokedDeviceError(body)) {
          const status = markUpdated({
            ...createInitialStatus(),
            auth: "revoked_device",
            connectivity: "online",
            overlay: "hidden",
          });
          emit(status);
          return status;
        }

        if (isUnauthenticatedError(body)) {
          const status = markUpdated({
            ...createInitialStatus(),
            connectivity: "online",
            overlay: "hidden",
          });
          emit(status);
          return status;
        }
      }

      if (!response.ok) {
        const status = createOfflineStatus();
        emit(status);
        return status;
      }

      const raw = (await response.json()) as unknown;
      const parsed = DesktopStatusResponseSchema.safeParse(raw);

      if (!parsed.success) {
        const status = createOfflineStatus();
        emit(status);
        return status;
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
        overlay: "hidden",
      });
      emit(status);
      return status;
    } catch {
      // If we have a stored token but cannot reach the API, preserve the last
      // known auth state; on the first failure assume signed_in because the
      // token exists. Status UI surfaces the connectivity issue separately from
      // the overlay.
      const status = createOfflineStatus();
      emit(status);
      return status;
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
