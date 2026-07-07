import { readFileSync, writeFileSync } from "node:fs";
import type { OnboardingPreferences } from "./onboarding.ts";

export type DesktopPreferences = {
  onboarding: OnboardingPreferences;
  deviceId?: string;
};

export type PreferencesStorage = {
  load(): DesktopPreferences;
  save(prefs: DesktopPreferences): void;
};

const DEFAULT_PREFERENCES: DesktopPreferences = {
  onboarding: { completed: false },
};

function isDesktopPreferences(value: unknown): value is DesktopPreferences {
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

  return true;
}

export function createMemoryPreferencesStorage(
  initial: DesktopPreferences = DEFAULT_PREFERENCES,
): PreferencesStorage {
  let prefs = structuredClone(initial);
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
        if (isDesktopPreferences(parsed)) {
          return structuredClone(parsed);
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
  let prefs = deps.storage.load();

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
