import { describe, it, expect } from "bun:test";
import {
  createOnboardingManager,
  getMacOSAppBundlePath,
  MACOS_PERMISSION_SETTINGS_URLS,
  ONBOARDING_PERMISSIONS_COPY,
  ONBOARDING_STEP_COPY,
  ONBOARDING_STEPS,
  type OnboardingPreferences,
} from "../apps/desktop/src/main/onboarding.ts";

describe("desktop onboarding", () => {
  it("shows onboarding when it has not been completed", () => {
    const prefs: OnboardingPreferences = { completed: false };
    const manager = createOnboardingManager({
      getPreferences: () => prefs,
      setPreferences: (p) => Object.assign(prefs, p),
    });

    expect(manager.shouldShowOnboarding()).toBe(true);
  });

  it("does not show onboarding after it has been completed", () => {
    const prefs: OnboardingPreferences = { completed: true };
    const manager = createOnboardingManager({
      getPreferences: () => prefs,
      setPreferences: (p) => Object.assign(prefs, p),
    });

    expect(manager.shouldShowOnboarding()).toBe(false);
  });

  it("marks onboarding as complete", () => {
    const prefs: OnboardingPreferences = { completed: false };
    const manager = createOnboardingManager({
      getPreferences: () => prefs,
      setPreferences: (p) => Object.assign(prefs, p),
    });

    manager.completeOnboarding();

    expect(prefs.completed).toBe(true);
    expect(manager.shouldShowOnboarding()).toBe(false);
  });

  it("uses the completed flag for skipped onboarding", () => {
    const prefs: OnboardingPreferences = { completed: false };
    const manager = createOnboardingManager({
      getPreferences: () => prefs,
      setPreferences: (p) => Object.assign(prefs, p),
    });

    manager.completeOnboarding();

    expect(prefs.completed).toBe(true);
    expect(manager.shouldShowOnboarding()).toBe(false);
  });

  it("defines the first-run onboarding steps in order", () => {
    expect(ONBOARDING_STEPS).toEqual(["sign-in", "permissions", "how-it-works", "practice", "done"]);
    expect(ONBOARDING_STEP_COPY["sign-in"].title.toLowerCase()).toContain("sign in");
    expect(ONBOARDING_STEP_COPY.practice.subtitle.toLowerCase()).toContain("mock");
  });

  it("explains Accessibility and Input Monitoring permissions in product language", () => {
    expect(ONBOARDING_PERMISSIONS_COPY.title.toLowerCase()).toContain("permissions");
    expect(ONBOARDING_PERMISSIONS_COPY.requiredPermissions).toContain("Accessibility");
    expect(ONBOARDING_PERMISSIONS_COPY.requiredPermissions).toContain("Input Monitoring");
  });

  it("targets the exact macOS privacy panes required for onboarding", () => {
    expect(MACOS_PERMISSION_SETTINGS_URLS.accessibility).toContain("Privacy_Accessibility");
    expect(MACOS_PERMISSION_SETTINGS_URLS.inputMonitoring).toContain("Privacy_ListenEvent");
  });

  it("reveals the app bundle instead of the executable inside a macOS app", () => {
    expect(getMacOSAppBundlePath("/Applications/Tabb.app/Contents/MacOS/Tabb")).toBe("/Applications/Tabb.app");
  });

  it("falls back to the executable path when not running from a macOS app bundle", () => {
    expect(getMacOSAppBundlePath("/usr/local/bin/electron")).toBe("/usr/local/bin/electron");
  });

  it("does not request Screen Recording or Full Disk Access", () => {
    const copy = ONBOARDING_PERMISSIONS_COPY.requiredPermissions.toLowerCase();
    expect(copy).not.toContain("screen recording");
    expect(copy).not.toContain("full disk access");
    expect(copy).not.toContain("screenrecording");
    expect(copy).not.toContain("fulldiskaccess");
  });

  it("communicates that Screen Recording and Full Disk Access are out of scope", () => {
    const copy = JSON.stringify(ONBOARDING_PERMISSIONS_COPY).toLowerCase();
    expect(copy).toContain("screen recording");
    expect(copy).toContain("full disk access");
  });

  it("explains why permissions are needed without raw keystroke language", () => {
    const copy = JSON.stringify(ONBOARDING_PERMISSIONS_COPY).toLowerCase();
    expect(copy).not.toContain("keystroke log");
    expect(copy).not.toContain("keylogger");
    expect(copy).toContain("typing context");
    expect(copy).toContain("active application");
  });
});
