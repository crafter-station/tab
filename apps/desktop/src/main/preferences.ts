import { readFileSync, writeFileSync } from "node:fs";
import type { OnboardingPreferences } from "./onboarding.ts";

export type DesktopPreferences = {
  onboarding: OnboardingPreferences;
  suggestions: {
    usePersonalMemory: boolean;
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
  suggestions: { usePersonalMemory: false },
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

  if ("suggestions" in value) {
    const suggestions = value.suggestions;
    const hasValidSuggestions =
      !!suggestions &&
      typeof suggestions === "object" &&
      "usePersonalMemory" in suggestions &&
      typeof suggestions.usePersonalMemory === "boolean";
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
