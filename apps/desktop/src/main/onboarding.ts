export type OnboardingPreferences = {
  completed: boolean;
};

export type OnboardingManagerDependencies = {
  getPreferences(): OnboardingPreferences;
  setPreferences(prefs: Partial<OnboardingPreferences>): void;
};

export const ONBOARDING_STEPS = ["model", "try", "permissions", "done"] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const ONBOARDING_STEP_COPY: Record<OnboardingStep, { title: string; subtitle: string }> = {
  model: {
    title: "Prepare Tab",
    subtitle: "Set up private, local Suggestions.",
  },
  try: {
    title: "Try Tab",
    subtitle: "Practice accepting a Suggestion.",
  },
  permissions: {
    title: "Allow access",
    subtitle: "Turn on two macOS permissions.",
  },
  done: {
    title: "Finish setup",
    subtitle: "Start using Tab everywhere.",
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
    "Tab does not request Screen Recording or Full Disk Access. Supported nearby context, including a bounded local OpenCode conversation match, may be read on-device without those broad permissions.",
  privacyNote:
    "Automatic Suggestions use recent typing locally. Double-tapping Option explicitly sends bounded, redacted Typing Context and eligible nearby context for Deep Complete. Nearby app text is temporary and is not saved as memory by default. Saved memories remain visible and controlled by you. Metadata-only telemetry excludes raw recent typing, nearby app text, accepted Suggestion text, and final inserted text.",
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
