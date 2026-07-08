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

export { createTypingContextBuffer, type TextSessionSnapshot } from "./main/typing-context.ts";
export { generateFakeSuggestion, generateLocalSuggestion } from "./main/suggestion-engine.ts";
export { createSuggestionLoop } from "./main/suggestion-loop.ts";
export { acceptAndInsertSuggestion } from "./main/acceptance.ts";
export { createApiSuggestionClient } from "./main/suggestion-client.ts";
export { createDesktopAuthClient } from "./main/auth.ts";
export { createMemoryKeychain, createMacOSKeychain } from "./main/keychain.ts";
export { createDesktopStatusService, type DesktopStatus } from "./main/status.ts";
export { createDesktopMemoryClient } from "./main/memory-client.ts";
export { APP_CONTEXT_SUPPORTED_APP_MATRIX, APP_CONTEXT_TRUST_COPY } from "./main/app-context.ts";
export { createOnboardingManager, ONBOARDING_PERMISSIONS_COPY, type OnboardingPreferences } from "./main/onboarding.ts";
export { createPreferencesManager, createMemoryPreferencesStorage, type DesktopPreferences } from "./main/preferences.ts";
export { createUpdateChecker, type UpdateChecker } from "./main/release.ts";
