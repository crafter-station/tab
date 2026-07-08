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
    title: "Sign in to start Tab",
    subtitle: "Connect this Mac before Tab can request suggestions for your account.",
  },
  permissions: {
    title: "Enable two macOS permissions",
    subtitle: "Accessibility and Input Monitoring let Tab understand text sessions and detect typing activity safely.",
  },
  "how-it-works": {
    title: "Learn the flow",
    subtitle: "Tab keeps Typing Context in memory, asks for a suggestion when safe, then shows a small overlay.",
  },
  practice: {
    title: "Practice suggestions",
    subtitle: "Try accepting and dismissing a mock completion before Tab appears in other apps.",
  },
  done: {
    title: "You are ready",
    subtitle: "Tab will keep running from the tray and show suggestions when context is available.",
  },
};

export const ONBOARDING_PERMISSIONS_COPY = {
  title: "Welcome to Tab — Permissions",
  subtitle: "Tab suggests continuations while you type in other macOS applications.",
  requiredPermissions:
    "Tab needs Accessibility and Input Monitoring permissions to understand the focused Text Session, detect typing activity, know the Active Application, and insert only suggestions you accept.",
  whyAccessibility:
    "Accessibility supports Text Session understanding, sensitive-field checks, and accepted Suggestion insertion in the app you were using.",
  whyInputMonitoring:
    "Input Monitoring supports typing timing, acceptance shortcuts, and fallback Typing Context signals when Accessibility text details are unavailable.",
  notRequested:
    "Tab does not ask to see your screen or access your files. Screen Recording and Full Disk Access stay outside Tab's permission scope.",
  privacyNote:
    "Typing Context stays in memory only. App Context is temporary suggestion-only background from supported apps and is not Personal Memory eligible by default. Personal Memory remains visible and controlled by you. Metadata-only telemetry can improve reliability, but raw logs, raw Typing Context, raw App Context, accepted Suggestion text, and final inserted text are not stored by default.",
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
