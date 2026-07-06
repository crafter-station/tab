import type { SuggestionRequest } from "@tabb/contracts";

export const desktopAppBoundary = {
  runtime: "electron",
  owns: [
    "macOS permissions guidance",
    "typing context observation",
    "floating suggestion overlay",
    "suggestion acceptance",
    "local privacy suppression and redaction",
    "global pause/opt-out control",
  ],
} as const;

export function createDesktopSuggestionRequest(input: SuggestionRequest): SuggestionRequest {
  return input;
}

export { createTypingContextBuffer } from "./typing-context.ts";
export { generateFakeSuggestion } from "./suggestion-engine.ts";
export { createSuggestionLoop } from "./suggestion-loop.ts";
export { acceptAndInsertSuggestion } from "./acceptance.ts";
export { createApiSuggestionClient } from "./suggestion-client.ts";
export { createDesktopAuthClient } from "./auth.ts";
export { createMemoryKeychain, createMacOSKeychain } from "./keychain.ts";
export { createDesktopStatusService, type DesktopStatus } from "./status.ts";
export { createDesktopMemoryClient } from "./memory-client.ts";
export { createOnboardingManager, ONBOARDING_PERMISSIONS_COPY, type OnboardingPreferences } from "./onboarding.ts";
export { createPreferencesManager, createMemoryPreferencesStorage, type DesktopPreferences } from "./preferences.ts";
export { createUpdateChecker, type UpdateChecker } from "./release.ts";
