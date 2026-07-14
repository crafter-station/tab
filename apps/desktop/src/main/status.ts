import {
  ApiErrorResponseSchema,
  DesktopStatusResponseSchema,
} from "@tab/contracts";
import { planCapabilities } from "@tab/billing";
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

function withAllowanceLimit(
  allowance: BillingStatusData["localAcceptedWords"],
  limit: number | null,
): BillingStatusData["localAcceptedWords"] {
  return {
    ...allowance,
    limit,
    remaining: limit === null ? null : Math.max(0, limit - allowance.used),
    exhausted: limit !== null && allowance.used >= limit,
  };
}

function expireCachedEntitlement(
  entitlement: BillingStatusData,
  now: Date,
): BillingStatusData {
  const trialExpired =
    entitlement.entitlementSource === "trial" &&
    entitlement.trial.active &&
    new Date(entitlement.trial.endsAt) <= now;
  const paidAccessExpired =
    entitlement.entitlementSource === "paid" &&
    entitlement.accessEndsAt !== undefined &&
    new Date(entitlement.accessEndsAt) <= now;
  let resolved = entitlement;
  if (trialExpired || paidAccessExpired) {
    const capabilities = planCapabilities.free;
    resolved = {
      ...entitlement,
      planId: "free",
      entitlementSource: "free",
      billingInterval: undefined,
      accessEndsAt: undefined,
      capabilities: {
        localAcceptedWordsPerDay: capabilities.localAcceptedWordsPerDay,
        deepCompletesPerMonth: capabilities.deepCompletesPerMonth,
        personalDeviceLimit: capabilities.personalDeviceLimit,
        continuousMemoryExtraction: capabilities.continuousMemoryExtraction,
        customWritingInstructions: capabilities.customWritingInstructions,
        modelCatalogAccess: capabilities.modelCatalogAccess,
      },
      trial: { ...entitlement.trial, active: false },
      localAcceptedWords: withAllowanceLimit(
        entitlement.localAcceptedWords,
        capabilities.localAcceptedWordsPerDay,
      ),
      deepCompletes: withAllowanceLimit(
        entitlement.deepCompletes,
        capabilities.deepCompletesPerMonth,
      ),
      devices: {
        active: entitlement.devices.active,
        limit: capabilities.personalDeviceLimit,
        canLink: entitlement.devices.active < capabilities.personalDeviceLimit,
      },
      upgradeUrl: "/pricing",
    };
  }

  const currentLocalDay = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  if (resolved.localAcceptedWords.period !== currentLocalDay) {
    const resetAt = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    ).toISOString();
    resolved = {
      ...resolved,
      localAcceptedWords: {
        period: currentLocalDay,
        used: 0,
        limit: resolved.capabilities.localAcceptedWordsPerDay,
        remaining: resolved.capabilities.localAcceptedWordsPerDay,
        resetAt,
        exhausted: false,
      },
    };
  }
  return resolved;
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
        entitlement: expireCachedEntitlement(stored.entitlement, now()),
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
      const localNow = new Date();
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
        ? expireCachedEntitlement(currentStatus.entitlement, now())
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
