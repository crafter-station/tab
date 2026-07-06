import { readFileSync, writeFileSync } from "node:fs";
import type { OnboardingPreferences } from "./onboarding.ts";

export type DesktopPreferences = {
  onboarding: OnboardingPreferences;
};

export type PreferencesStorage = {
  load(): DesktopPreferences;
  save(prefs: DesktopPreferences): void;
};

const DEFAULT_PREFERENCES: DesktopPreferences = {
  onboarding: { completed: false },
};

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
        // Minimal validation: ensure the shape is a preferences object.
        if (
          parsed &&
          typeof parsed === "object" &&
          "onboarding" in parsed &&
          parsed.onboarding &&
          typeof parsed.onboarding === "object" &&
          "completed" in parsed.onboarding &&
          typeof parsed.onboarding.completed === "boolean"
        ) {
          return structuredClone(parsed as DesktopPreferences);
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
