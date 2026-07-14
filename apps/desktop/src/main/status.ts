import {
  ApiErrorResponseSchema,
  DesktopStatusResponseSchema,
} from "@tab/contracts";
import {
  projectBillingStatus,
  type EntitlementFacts,
} from "@tab/billing";
import type {
  BillingStatusData,
  LocalSuggestionActivity,
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

export type DesktopStatus = {
  readonly auth: DesktopAuthStatus;
  readonly connectivity: DesktopConnectivityStatus;
  readonly userId: string | null;
  readonly entitlement: BillingStatusData | null;
  readonly localSuggestionActivity?: LocalSuggestionActivity;
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
  now?: () => Date;
  getCachedEntitlement?(): {
    userId: string;
    entitlement: BillingStatusData;
  } | null;
  setCachedEntitlement?(
    cached: { userId: string; entitlement: BillingStatusData } | null,
  ): void;
  onChange?(
    status: DesktopStatus,
    credentialGeneration: CredentialGeneration | null,
  ): void;
};

function createInitialStatus(cached?: {
  userId: string;
  entitlement: BillingStatusData;
} | null): DesktopStatus {
  return {
    auth: "sign_in_required",
    connectivity: "online",
    userId: cached?.userId ?? null,
    entitlement: cached?.entitlement ?? null,
    overlay: "hidden",
    lastUpdatedAt: null,
  };
}

function projectCachedEntitlement(
  entitlement: BillingStatusData,
  now: Date,
): BillingStatusData {
  let facts: EntitlementFacts = { planId: "free", source: "free" };
  if (entitlement.entitlementSource === "trial" && entitlement.trial.active) {
    facts = {
      planId: entitlement.planId,
      source: "trial",
      effectiveEnd: entitlement.trial.endsAt,
      trialStartedAt: entitlement.trial.startedAt,
    };
  } else if (entitlement.entitlementSource === "paid") {
    facts = {
      planId: entitlement.planId,
      source: "paid",
      effectiveEnd: entitlement.accessEndsAt,
      billingInterval: entitlement.billingInterval,
    };
  }

  return projectBillingStatus({
    entitlement: facts,
    now,
    localAcceptedWords: {
      period: entitlement.localAcceptedWords.period ?? "",
      used: entitlement.localAcceptedWords.used,
      resetAt: entitlement.localAcceptedWords.resetAt,
    },
    deepCompletes: {
      period: entitlement.deepCompletes.period ?? "",
      used: entitlement.deepCompletes.used,
      resetAt: entitlement.deepCompletes.resetAt,
    },
    activeDevices: entitlement.devices.active,
  });
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
  const now = deps.now ?? (() => new Date());
  const stored = deps.getCachedEntitlement?.() ?? null;
  const cached = stored
    ? {
        ...stored,
        entitlement: projectCachedEntitlement(stored.entitlement, now()),
      }
    : null;
  let currentStatus: DesktopStatus = createInitialStatus(cached);
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
      deps.setCachedEntitlement?.(null);
      const status = markUpdated(createInitialStatus());
      return accept(status, sequence, credentialGeneration);
    }

    try {
      const localNow = now();
      const localDay = [
        localNow.getFullYear(),
        String(localNow.getMonth() + 1).padStart(2, "0"),
        String(localNow.getDate()).padStart(2, "0"),
      ].join("-");
      const localResetAt = new Date(
        localNow.getFullYear(),
        localNow.getMonth(),
        localNow.getDate() + 1,
      ).toISOString();
      const statusUrl = new URL("/api/status", deps.apiBaseUrl);
      statusUrl.searchParams.set("localDay", localDay);
      statusUrl.searchParams.set("localResetAt", localResetAt);
      const response = await http(
        statusUrl,
        {
          method: "GET",
          headers: {
            Authorization: authorizationHeader,
            Accept: "application/json",
          },
        },
      );
      if (!(await canAccept(sequence, credentialGeneration))) return currentStatus;

      if (response.status === 401) {
        const body = (await response.json()) as unknown;
        if (!(await canAccept(sequence, credentialGeneration))) return currentStatus;
        if (isRevokedDeviceError(body)) {
          deps.setCachedEntitlement?.(null);
          const status = markUpdated({
            ...createInitialStatus(),
            auth: "revoked_device",
            connectivity: "online",
            overlay: "hidden",
          });
          return accept(status, sequence, credentialGeneration);
        }

        if (isUnauthenticatedError(body)) {
          deps.setCachedEntitlement?.(null);
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
        entitlement: data.entitlement ?? null,
        ...(data.localSuggestionActivity
          ? { localSuggestionActivity: data.localSuggestionActivity }
          : {}),
        overlay: "hidden",
      });
      const accepted = await accept(status, sequence, credentialGeneration);
      if (accepted === status && status.userId && status.entitlement) {
        deps.setCachedEntitlement?.({
          userId: status.userId,
          entitlement: status.entitlement,
        });
      }
      return accepted;
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
      entitlement: currentStatus.entitlement
        ? projectCachedEntitlement(currentStatus.entitlement, now())
        : null,
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
