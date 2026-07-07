export type OnboardingPreferences = {
  completed: boolean;
};

export type OnboardingManagerDependencies = {
  getPreferences(): OnboardingPreferences;
  setPreferences(prefs: Partial<OnboardingPreferences>): void;
};

export const ONBOARDING_STEPS = ["sign-in", "permissions", "how-it-works", "practice", "done"] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const ONBOARDING_STEP_COPY: Record<OnboardingStep, { title: string; subtitle: string }> = {
  "sign-in": {
    title: "Sign in to start Tabb",
    subtitle: "Connect this Mac before Tabb can request suggestions for your account.",
  },
  permissions: {
    title: "Enable two macOS permissions",
    subtitle: "Accessibility and Input Monitoring let Tabb observe context and insert accepted suggestions.",
  },
  "how-it-works": {
    title: "Learn the flow",
    subtitle: "Tabb watches recent typing context in memory, asks for a suggestion, then shows a small overlay.",
  },
  practice: {
    title: "Practice suggestions",
    subtitle: "Try accepting and dismissing a mock completion before Tabb appears in other apps.",
  },
  done: {
    title: "You are ready",
    subtitle: "Tabb will keep running from the tray and show suggestions when context is available.",
  },
};

export const ONBOARDING_PERMISSIONS_COPY = {
  title: "Welcome to Tabb — Permissions",
  subtitle: "Tabb suggests continuations while you type in other macOS applications.",
  requiredPermissions: "Tabb needs Accessibility and Input Monitoring permissions to observe your recent typing context, know the active application, and insert accepted suggestions.",
  whyAccessibility:
    "Accessibility lets Tabb paste accepted suggestions into the previously active application and guide you through setup.",
  whyInputMonitoring:
    "Input Monitoring lets Tabb listen for text-bearing typing context and the Option+Tab acceptance shortcut across applications.",
  notRequested:
    "Tabb does not ask to see your screen or access your files. Screen Recording and Full Disk Access stay outside Tabb's permission scope.",
  privacyNote:
    "Your recent typing context stays in memory only. It is not stored as a raw log or used to build hidden profiles.",
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
