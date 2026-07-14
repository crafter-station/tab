import { describe, it, expect } from "bun:test";
import { unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  createPreferencesManager,
  createMemoryPreferencesStorage,
  createFilePreferencesStorage,
} from "../apps/desktop/src/main/preferences.ts";

describe("desktop preferences", () => {
  it("returns default preferences when storage is empty", () => {
    const manager = createPreferencesManager({
      storage: createMemoryPreferencesStorage(),
    });

    expect(manager.get().onboarding.completed).toBe(false);
    expect(manager.get().suggestions.usePersonalMemory).toBe(false);
    expect(manager.get().suggestions.localModelId).toBe("ternary-bonsai-8b-q2_0");
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

  it("persists a device id", () => {
    const storage = createMemoryPreferencesStorage();
    const manager = createPreferencesManager({ storage });

    manager.update({ deviceId: "persistent-device-1" });

    expect(manager.get().deviceId).toBe("persistent-device-1");

    const reloaded = createPreferencesManager({ storage });
    expect(reloaded.get().deviceId).toBe("persistent-device-1");
  });

  it("persists Personal Memory usage for suggestions", () => {
    const storage = createMemoryPreferencesStorage();
    const manager = createPreferencesManager({ storage });

    manager.update({ suggestions: { usePersonalMemory: true } });

    expect(manager.get().suggestions.usePersonalMemory).toBe(true);

    const reloaded = createPreferencesManager({ storage });
    expect(reloaded.get().suggestions.usePersonalMemory).toBe(true);
  });

  it("persists the selected local model", () => {
    const storage = createMemoryPreferencesStorage();
    const manager = createPreferencesManager({ storage });
    const preferences = manager.get();

    manager.update({
      suggestions: { ...preferences.suggestions, localModelId: "qwen2.5-3b-instruct-q4_k_m" },
    });

    const reloaded = createPreferencesManager({ storage });
    expect(reloaded.get().suggestions.localModelId).toBe("qwen2.5-3b-instruct-q4_k_m");
  });

  describe("file-backed storage", () => {
    const tmpDir = process.env.TMPDIR ?? process.env.TEMP ?? "/tmp";

    function tmpPath(name: string): string {
      return join(tmpDir, `tab-preferences-test-${name}-${Date.now()}.json`);
    }

    function cleanup(path: string): void {
      if (existsSync(path)) {
        unlinkSync(path);
      }
    }

    it("returns defaults when the preferences file does not exist", () => {
      const path = tmpPath("missing");
      try {
        const storage = createFilePreferencesStorage(path);
        const manager = createPreferencesManager({ storage });

        expect(manager.get().onboarding.completed).toBe(false);
      } finally {
        cleanup(path);
      }
    });

    it("persists onboarding completion to disk", () => {
      const path = tmpPath("persist");
      try {
        const storage = createFilePreferencesStorage(path);
        const manager = createPreferencesManager({ storage });

        manager.update({ onboarding: { completed: true } });

        const reloaded = createPreferencesManager({
          storage: createFilePreferencesStorage(path),
        });

        expect(reloaded.get().onboarding.completed).toBe(true);
      } finally {
        cleanup(path);
      }
    });

    it("does not mutate the file-backed stored preferences", () => {
      const path = tmpPath("immutable");
      try {
        const manager = createPreferencesManager({
          storage: createFilePreferencesStorage(path),
        });

        const prefs = manager.get();
        prefs.onboarding.completed = true;

        expect(manager.get().onboarding.completed).toBe(false);
      } finally {
        cleanup(path);
      }
    });
  });
});
