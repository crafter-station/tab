import { describe, it, expect } from "bun:test";
import {
  createPreferencesManager,
  createMemoryPreferencesStorage,
} from "../apps/desktop/src/preferences.ts";

describe("desktop preferences", () => {
  it("returns default preferences when storage is empty", () => {
    const manager = createPreferencesManager({
      storage: createMemoryPreferencesStorage(),
    });

    expect(manager.get().onboarding.completed).toBe(false);
  });

  it("persists onboarding completion", () => {
    const storage = createMemoryPreferencesStorage();
    const manager = createPreferencesManager({ storage });

    manager.update({ onboarding: { completed: true } });

    expect(manager.get().onboarding.completed).toBe(true);

    const reloaded = createPreferencesManager({ storage });
    expect(reloaded.get().onboarding.completed).toBe(true);
  });

  it("does not mutate stored preferences when returning them", () => {
    const manager = createPreferencesManager({
      storage: createMemoryPreferencesStorage(),
    });

    const prefs = manager.get();
    prefs.onboarding.completed = true;

    expect(manager.get().onboarding.completed).toBe(false);
  });
});
