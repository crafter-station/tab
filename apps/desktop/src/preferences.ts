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
