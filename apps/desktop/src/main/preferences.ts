import { readFileSync, writeFileSync } from "node:fs";
import {
  BillingStatusDataSchema,
  DEFAULT_LOCAL_MODEL_ID,
  type BillingStatusData,
  LocalModelIdSchema,
  type LocalModelId,
} from "@tab/contracts";
import type { OnboardingPreferences } from "./onboarding.ts";

export type DesktopPreferences = {
  onboarding: OnboardingPreferences;
  suggestions: {
    usePersonalMemory: boolean;
    continuousMemoryExtraction: boolean;
    customWritingInstructions: string;
    localModelId: LocalModelId;
  };
  cachedEntitlement?: {
    userId: string;
    entitlement: BillingStatusData;
  };
  deviceId?: string;
};

type StoredDesktopPreferences = Omit<DesktopPreferences, "suggestions"> & {
  suggestions?: DesktopPreferences["suggestions"];
};

export type PreferencesStorage = {
  load(): DesktopPreferences;
  save(prefs: DesktopPreferences): void;
};

const DEFAULT_PREFERENCES: DesktopPreferences = {
  onboarding: { completed: false },
  suggestions: {
    usePersonalMemory: false,
    continuousMemoryExtraction: false,
    customWritingInstructions: "",
    localModelId: DEFAULT_LOCAL_MODEL_ID,
  },
};

function normalizeDesktopPreferences(value: StoredDesktopPreferences): DesktopPreferences {
  return {
    ...DEFAULT_PREFERENCES,
    ...value,
    onboarding: { ...DEFAULT_PREFERENCES.onboarding, ...value.onboarding },
    suggestions: { ...DEFAULT_PREFERENCES.suggestions, ...value.suggestions },
  };
}

function isStoredDesktopPreferences(value: unknown): value is StoredDesktopPreferences {
  if (!value || typeof value !== "object") return false;
  if (!("onboarding" in value)) return false;

  const onboarding = value.onboarding;
  const hasValidOnboarding =
    !!onboarding &&
    typeof onboarding === "object" &&
    "completed" in onboarding &&
    typeof onboarding.completed === "boolean";
  if (!hasValidOnboarding) return false;

  if ("deviceId" in value && typeof value.deviceId !== "string") {
    return false;
  }

  if ("cachedEntitlement" in value) {
    const cached = value.cachedEntitlement;
    if (
      !cached ||
      typeof cached !== "object" ||
      !("userId" in cached) ||
      typeof cached.userId !== "string" ||
      !("entitlement" in cached) ||
      !BillingStatusDataSchema.safeParse(cached.entitlement).success
    ) {
      return false;
    }
  }

  if ("suggestions" in value) {
    const suggestions = value.suggestions;
    const hasValidSuggestions =
      !!suggestions &&
      typeof suggestions === "object" &&
      "usePersonalMemory" in suggestions &&
      typeof suggestions.usePersonalMemory === "boolean" &&
      (!("continuousMemoryExtraction" in suggestions) ||
        typeof suggestions.continuousMemoryExtraction === "boolean") &&
      (!("customWritingInstructions" in suggestions) ||
        (typeof suggestions.customWritingInstructions === "string" &&
          suggestions.customWritingInstructions.length <= 1_000)) &&
      (!("localModelId" in suggestions) || LocalModelIdSchema.safeParse(suggestions.localModelId).success);
    if (!hasValidSuggestions) return false;
  }

  return true;
}

export function createMemoryPreferencesStorage(
  initial: DesktopPreferences = DEFAULT_PREFERENCES,
): PreferencesStorage {
  let prefs = normalizeDesktopPreferences(initial);
  return {
    load: () => structuredClone(prefs),
    save: (next) => {
      prefs = structuredClone(next);
    },
  };
}

export function createFilePreferencesStorage(filePath: string): PreferencesStorage {
  return {
    load: () => {
      try {
        const raw = readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(raw) as unknown;
        if (isStoredDesktopPreferences(parsed)) {
          return normalizeDesktopPreferences(parsed);
        }
      } catch {
        // File missing or corrupt: fall back to defaults.
      }
      return structuredClone(DEFAULT_PREFERENCES);
    },
    save: (next) => {
      writeFileSync(filePath, JSON.stringify(next, null, 2));
    },
  };
}

export type PreferencesManagerDependencies = {
  storage: PreferencesStorage;
};

export function createPreferencesManager(deps: PreferencesManagerDependencies) {
  let prefs = normalizeDesktopPreferences(deps.storage.load());

  function get(): DesktopPreferences {
    return structuredClone(prefs);
  }

  function update(patch: Partial<DesktopPreferences>): void {
    prefs = { ...prefs, ...patch };
    deps.storage.save(prefs);
  }

  return {
    get,
    update,
  };
}

export type PreferencesManager = ReturnType<typeof createPreferencesManager>;
