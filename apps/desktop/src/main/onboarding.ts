export type OnboardingPreferences = {
  completed: boolean;
};

export type OnboardingManagerDependencies = {
  getPreferences(): OnboardingPreferences;
  setPreferences(prefs: Partial<OnboardingPreferences>): void;
};

export const ONBOARDING_STEPS = ["try", "permissions", "done"] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const ONBOARDING_STEP_COPY: Record<OnboardingStep, { title: string; subtitle: string }> = {
  try: {
    title: "Try Tab",
    subtitle: "Accept a sample suggestion before Tab appears in other apps.",
  },
  permissions: {
    title: "Allow Tab to work in your apps",
    subtitle: "Enable Accessibility and Input Monitoring in order, with a clear explanation of each permission.",
  },
  done: {
    title: "Start writing with Tab",
    subtitle: "Relaunch once to apply Input Monitoring, then Tab will run quietly from the menu bar.",
  },
};

export const ONBOARDING_PERMISSIONS_COPY = {
  title: "Welcome to Tab — Permissions",
  subtitle: "Tab suggests continuations while you type in other macOS applications.",
  requiredPermissions:
    "Tab needs Accessibility and Input Monitoring permissions to read the text field you are using, detect typing activity, know the app you are writing in, and insert only suggestions you accept.",
  whyAccessibility:
    "Accessibility lets Tab read the text field you are using, avoid sensitive fields, and add suggestions you accept.",
  whyInputMonitoring:
    "Input Monitoring helps Tab notice typing, support Option+Tab, and keep working when text details are unavailable.",
  notRequested:
    "Tab does not ask to see your screen or access your files. Screen Recording and Full Disk Access stay outside Tab's permission scope.",
  privacyNote:
    "Recent typing is used to make suggestions. Nearby app text from supported apps is temporary and is not saved as memory by default. Saved memories remain visible and controlled by you. Metadata-only telemetry can improve reliability, but raw logs, raw recent typing, raw nearby app text, accepted suggestion text, and final inserted text are not stored by default.",
  cta: "Continue to Permissions",
} as const;

export const MACOS_PERMISSION_SETTINGS_URLS = {
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  inputMonitoring: "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
} as const;

export function getMacOSAppBundlePath(executablePath: string): string {
  const bundleMarker = ".app/Contents/MacOS/";
  const markerIndex = executablePath.indexOf(bundleMarker);
  if (markerIndex === -1) return executablePath;
  return executablePath.slice(0, markerIndex + ".app".length);
}

export function createOnboardingManager(deps: OnboardingManagerDependencies) {
  function shouldShowOnboarding(): boolean {
    return !deps.getPreferences().completed;
  }

  function completeOnboarding(): void {
    deps.setPreferences({ completed: true });
  }

  function resetOnboarding(): void {
    deps.setPreferences({ completed: false });
  }

  return {
    shouldShowOnboarding,
    completeOnboarding,
    resetOnboarding,
  };
}

export type OnboardingManager = ReturnType<typeof createOnboardingManager>;
