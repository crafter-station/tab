import {
  app,
  BrowserWindow,
  globalShortcut,
  clipboard,
  ipcMain,
  screen,
  powerMonitor,
  Notification,
  shell,
  systemPreferences,
} from "electron";
import path from "node:path";
import { exec } from "node:child_process";
import { mkdirSync } from "node:fs";
import { promisify } from "node:util";
import { PLATFORM_COLORS } from "@tab/ui/platform-colors";
import {
  createTypingContextBuffer,
  getLastWords,
  type TextSessionSnapshot,
  type TypingDeletionUnit,
} from "./typing-context.ts";
import { createApiSuggestionClient } from "./suggestion-client.ts";
import { createDesktopTelemetryClient } from "./telemetry-client.ts";
import {
  createAcceptedWordLedger,
  createFileAcceptedWordLedgerStorage,
} from "./accepted-word-ledger.ts";
import { createLocalAcceptanceUsageClient } from "./usage-client.ts";
import { createNativeAutocompleteApp, type SuggestionProvenance } from "./native-autocomplete-app.ts";
import {
  type AppContextSnapshot,
} from "./app-context.ts";
import { createAppContextExtractor, type AppContextAccessibilityTree } from "./app-context-extractor.ts";
import { createDesktopEventIngress } from "./desktop-event-ingress.ts";
import { createMacOSInputTap } from "./macos-input-tap.ts";
import {
  createDesktopAuthClient,
  createDesktopAuthSession,
  DEFAULT_DESKTOP_AUTH_CALLBACK_URL,
} from "./auth.ts";
import {
  createPackagedAuthCallback,
  createLoopbackAuthCallback,
} from "./auth-callback.ts";
import { createMacOSKeychain } from "./keychain.ts";
import { createDesktopStatusService, type DesktopStatus } from "./status.ts";
import { createDesktopMemoryClient } from "./memory-client.ts";
import { createDeviceApiClient } from "./device-api-client.ts";
import { createMemoryExtractionWindow } from "./memory-extraction-window.ts";
import { createMemoryExtractionDispatcher } from "./memory-extraction-dispatcher.ts";
import { MACOS_PERMISSION_SETTINGS_URLS, createOnboardingManager, getMacOSAppBundlePath } from "./onboarding.ts";
import { createControlWindowManager } from "./settings-window.ts";
import { createTrayMenu, type TabTray } from "./tray-menu.ts";
import { createPreferencesManager, createFilePreferencesStorage } from "./preferences.ts";
import { createDesktopUpdater } from "./release.ts";
import { createDefaultLocalModelCatalog, createLocalModelManager } from "./local-model-catalog.ts";
import { createCompletionHistory } from "./completion-history.ts";
import { DEFAULT_LOCAL_MODEL_ID, LocalModelIdSchema, type Suggestion, type PersonalMemory } from "@tab/contracts";
import { env } from "./env.ts";
import { createOpenCodeConversationContext } from "./opencode-session-context.ts";
import { boundsEqual } from "./window-position.ts";
import * as electronUpdaterModule from "electron-updater";
import {
  getLocalRuntimeExecutablePath,
  requireLocalRuntimeArchitecture,
} from "../../local-runtime-manifest.ts";

const electronUpdater = (
  "default" in electronUpdaterModule ? electronUpdaterModule.default : electronUpdaterModule
) as typeof import("electron-updater");
const { autoUpdater } = electronUpdater;
if (app.isPackaged) autoUpdater.logger = null;

const packagedAuthCallback = createPackagedAuthCallback({
  expectedCallbackUrl: DEFAULT_DESKTOP_AUTH_CALLBACK_URL,
  onCallback: completeBrowserHandoff,
  onError: (error) => {
    console.error("Failed to complete browser handoff:", error);
  },
});

app.on("open-url", (event, url) => {
  if (packagedAuthCallback.dispatch(url)) event.preventDefault();
});

const execAsync = promisify(exec);
const runtimeRoot = path.join(app.getAppPath(), app.isPackaged ? "dist" : "src");
const PRELOAD_PATH = env.TAB_PRELOAD_PATH ?? path.join(runtimeRoot, "preload.cjs");
const OVERLAY_RENDERER_PATH = env.TAB_OVERLAY_RENDERER_PATH ?? path.join(runtimeRoot, "renderer", "overlay.html");
const APP_RENDERER_PATH = env.TAB_APP_RENDERER_PATH ?? path.join(runtimeRoot, "renderer", "app.html");
const TRAY_ICON_PATH = env.TAB_TRAY_ICON_PATH ?? path.join(runtimeRoot, "assets", "iconTemplate.png");
const packagedInputTapPath = path.join(process.resourcesPath, "app.asar.unpacked", "dist", "macos-input-tap");
const packagedLocalRuntimeRoot = path.join(
  process.resourcesPath,
  "app.asar.unpacked",
  "dist",
  "local-runtime",
);
const localRuntimeArchitecture = requireLocalRuntimeArchitecture(process.arch);
const packagedQwenRuntimePath = getLocalRuntimeExecutablePath(
  packagedLocalRuntimeRoot,
  "qwen",
  localRuntimeArchitecture,
);
const packagedBonsaiRuntimePath = getLocalRuntimeExecutablePath(
  packagedLocalRuntimeRoot,
  "bonsai",
  localRuntimeArchitecture,
);
const INPUT_TAP_PATH = env.TAB_INPUT_TAP_PATH ?? (app.isPackaged ? packagedInputTapPath : path.join(runtimeRoot, "macos-input-tap"));
const LOCAL_INFERENCE_MODEL_PATH = env.TAB_LOCAL_INFERENCE_MODEL_PATH ?? path.join(
  app.getPath("userData"),
  "models",
  "Qwen2.5-3B-Instruct-Q4_K_M.gguf",
);
const LOCAL_INFERENCE_MODEL_URL = env.TAB_LOCAL_INFERENCE_MODEL_URL
  ?? "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/7dabda4d13d513e3e842b20f0d435c732f172cbe/qwen2.5-3b-instruct-q4_k_m.gguf";
const LOCAL_INFERENCE_EXECUTABLE = env.TAB_LOCAL_INFERENCE_EXECUTABLE
  ?? (app.isPackaged ? packagedQwenRuntimePath : "/opt/homebrew/bin/llama-server");

let overlayWindow: BrowserWindow | null = null;
let debugOverlayWindow: BrowserWindow | null = null;
let overlayRendererReady = false;
let tray: TabTray | null = null;
let relaunchAfterPermissionQuit = false;
const authCallback = createLoopbackAuthCallback({ onCallback: completeBrowserHandoff });
let pendingSyntheticPaste: { text: string; expiresAt: number } | null = null;

const typingContextBuffer = createTypingContextBuffer();
const appContextExtractor = createAppContextExtractor({
  openCodeConversation: createOpenCodeConversationContext({
    dataDirectory: path.join(app.getPath("home"), ".local", "share", "opencode"),
  }),
});

const userDataPath = app.getPath("userData");
mkdirSync(userDataPath, { recursive: true });
let currentDesktopStatus: DesktopStatus | null = null;
const preferencesManager = createPreferencesManager({
  storage: createFilePreferencesStorage(path.join(userDataPath, "preferences.json")),
});
const acceptedWordLedger = createAcceptedWordLedger({
  storage: createFileAcceptedWordLedgerStorage(
    path.join(userDataPath, "accepted-word-ledger.v2.json"),
  ),
  getUserId: () => currentDesktopStatus?.userId ?? undefined,
});

const onboardingManager = createOnboardingManager({
  getPreferences: () => preferencesManager.get().onboarding,
  setPreferences: (onboarding) => preferencesManager.update({ onboarding }),
});

const controlWindowManager = createControlWindowManager({
  rendererPath: APP_RENDERER_PATH,
  preloadPath: PRELOAD_PATH,
});

const API_BASE_URL = env.TAB_API_BASE_URL;
const WEB_BASE_URL = env.TAB_WEB_BASE_URL;
const APP_VERSION = app.getVersion() || "0.0.0";

function getOrCreateDeviceId(): string {
  const prefs = preferencesManager.get();
  if (prefs.deviceId && prefs.deviceId !== "device-unknown") return prefs.deviceId;
  const deviceId = env.TAB_DEVICE_ID || crypto.randomUUID();
  preferencesManager.update({ deviceId });
  console.log("Generated and persisted new device id:", deviceId);
  return deviceId;
}

const DEVICE_ID = getOrCreateDeviceId();
const DEVELOPMENT_LOGGING = !app.isPackaged;
const SHOW_SETTINGS_ON_START = process.argv.includes("--permission-debug") || env.TAB_SHOW_SETTINGS_ON_START === "1";
const SHOW_DEBUG_TYPING_OVERLAY =
  env.TAB_DEBUG_TYPING_OVERLAY !== "0" &&
  (!app.isPackaged || env.TAB_DEBUG_TYPING_OVERLAY === "1" || process.argv.includes("--typing-debug") || SHOW_SETTINGS_ON_START);
const DEBUG_TYPING_DEBOUNCE_MS = 300;
const DEBUG_TYPING_HIDE_MS = 3_600;
const DEBUG_TYPING_WORD_LIMIT = 100;
const CLIPBOARD_RESTORE_DELAY_MS = 250;
const OVERLAY_WIDTH = 560;
const OVERLAY_SUGGESTION_HEIGHT = 76;
const INLINE_OVERLAY_LEFT_BLEED = 4;
const INLINE_OVERLAY_MIN_WIDTH = 160;
const OVERLAY_DEBUG_WIDTH = 540;
const OVERLAY_DEBUG_HEIGHT = 220;
const OVERLAY_BOTTOM_MARGIN = 8;
const OVERLAY_POSITION_CHECK_MS = 400;
const SUGGESTION_VISIBLE_MS = 4_000;
const OBSIDIAN_BUNDLE_ID = "md.obsidian";
const OBSIDIAN_ACCEPTANCE_SHORTCUT = "Tab";

const authClient = createDesktopAuthClient({
  apiBaseUrl: API_BASE_URL,
  webBaseUrl: WEB_BASE_URL,
  deviceId: DEVICE_ID,
  appVersion: APP_VERSION,
  platform: process.platform,
  keychain: createMacOSKeychain(),
  openExternal: async (url) => {
    await shell.openExternal(url);
  },
});
const deviceApi = createDeviceApiClient({
  apiBaseUrl: API_BASE_URL,
  getAuthorizationHeader: () => authClient.getAuthorizationHeader(),
});

const requestCloudSuggestion = createApiSuggestionClient({
  api: deviceApi,
  deviceId: DEVICE_ID,
  appVersion: APP_VERSION,
  platform: process.platform,
  memoryEnabled: () => preferencesManager.get().suggestions.usePersonalMemory,
  getCustomWritingInstructions: () =>
    currentDesktopStatus?.entitlement?.capabilities.customWritingInstructions
      ? preferencesManager.get().suggestions.customWritingInstructions || undefined
      : undefined,
  onEntitlementError: () => controlWindowManager.show(),
});
const completionHistory = createCompletionHistory((entries) => {
  controlWindowManager.sendCompletionHistory(entries);
});
const requestDeepComplete: ReturnType<typeof createApiSuggestionClient> = requestCloudSuggestion;
const recordInteractionTelemetry = createDesktopTelemetryClient({
  api: deviceApi,
});
const synchronizeLocalAcceptance = createLocalAcceptanceUsageClient({
  api: deviceApi,
});

async function synchronizeAcceptedWordLedger(): Promise<void> {
  for (const event of acceptedWordLedger.getPending()) {
    const allowance = await synchronizeLocalAcceptance(event);
    if (!allowance) return;
    acceptedWordLedger.reconcileUsage(event.localDay, allowance.used);
    acceptedWordLedger.markSynced(event.acceptanceId);
  }
}

const memoryClient = createDesktopMemoryClient({
  api: deviceApi,
});

const memoryExtractionWindow = createMemoryExtractionWindow({
  memoryEnabled: () =>
    preferencesManager.get().suggestions.continuousMemoryExtraction &&
    Boolean(
      currentDesktopStatus?.entitlement?.capabilities
        .continuousMemoryExtraction,
    ),
});

const memoryExtractionDispatcher = createMemoryExtractionDispatcher({
  window: memoryExtractionWindow,
  client: memoryClient,
  clientMetadata: {
    appVersion: APP_VERSION,
    platform: process.platform,
  },
});

const authSession = createDesktopAuthSession({
  authClient,
  onSignedOut: showSignedOutSurface,
});

const notifiedUpdateVersions = new Set<string>();
let reconcileLocalModelAccess = () => {};
const desktopUpdater = createDesktopUpdater({
  currentVersion: APP_VERSION,
  nativeUpdater: autoUpdater,
  onChange: (state) => {
    controlWindowManager.sendUpdateState(state);
    updateTray();
    if (state.status === "available" && !notifiedUpdateVersions.has(state.version)) {
      notifiedUpdateVersions.add(state.version);
      if (Notification.isSupported()) {
        const notification = new Notification({
          title: "Tab update available",
          body: `Version ${state.version} is ready to download.`,
        });
        notification.on("click", () => controlWindowManager.show());
        notification.show();
      }
    }
  },
  onError: (error) => console.error("Desktop updater error:", error),
});

const statusService = createDesktopStatusService({
  apiBaseUrl: API_BASE_URL,
  getCachedEntitlement: () =>
    preferencesManager.get().cachedEntitlement ?? null,
  setCachedEntitlement: (cachedEntitlement) => {
    preferencesManager.update({
      cachedEntitlement: cachedEntitlement ?? undefined,
    });
  },
  getAuthorizationObservation: () => authClient.getAuthorizationObservation(),
  isCredentialGenerationCurrent: (credentialGeneration) =>
    authClient.isCredentialGenerationCurrent(credentialGeneration),
  publishIfCredentialGenerationCurrent: (credentialGeneration, publish) =>
    authClient.publishIfCredentialGenerationCurrent(credentialGeneration, publish),
  onChange: (status, credentialGeneration) => {
    currentDesktopStatus = status;
    controlWindowManager.sendStatus(status);
    updateTrayFromStatus(status);
    reconcileLocalModelAccess();
    if (credentialGeneration !== null) {
      void authSession.handleStatus(status.auth, credentialGeneration);
    }
    if (status.auth === "signed_in") {
      if (
        status.entitlement?.localAcceptedWords.period ===
        acceptedWordLedger.getCurrentDay()
      ) {
        acceptedWordLedger.reconcileUsage(
          status.entitlement.localAcceptedWords.period,
          status.entitlement.localAcceptedWords.used,
        );
      }
      void synchronizeAcceptedWordLedger();
    }
    if (!status.entitlement?.capabilities.continuousMemoryExtraction) {
      memoryExtractionDispatcher.cancelAndClear();
    }
  },
});

let currentMemories: PersonalMemory[] = [];
let debugTypingTimer: ReturnType<typeof setTimeout> | null = null;
let debugTypingHideTimer: ReturnType<typeof setTimeout> | null = null;
type DebugApiState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "empty" }
  | { status: "local-unavailable"; reason: string }
  | { status: "suggestion"; text: string };
type DebugAppContextState = {
  status: string;
  provider: string | null;
  confidence: number | null;
  suppressionReason: string | null;
  fragmentCount: number;
  messageCount: number;
};
let debugApiState: DebugApiState = { status: "idle" };
function logLocalSuggestion(event: string, details: Record<string, unknown>): void {
  console.log(`[local-suggestions] ${event}`, details);
}

const localModelCatalog = createDefaultLocalModelCatalog({
  modelsDirectory: path.join(app.getPath("userData"), "models"),
  qwenModelPath: LOCAL_INFERENCE_MODEL_PATH,
  qwenModelUrl: LOCAL_INFERENCE_MODEL_URL,
  qwenExecutablePath: LOCAL_INFERENCE_EXECUTABLE,
  bonsaiExecutablePath: env.TAB_BONSAI_INFERENCE_EXECUTABLE
    ?? (app.isPackaged ? packagedBonsaiRuntimePath : LOCAL_INFERENCE_EXECUTABLE),
});
const localInference = createLocalModelManager({
  entries: localModelCatalog,
  defaultModelId: DEFAULT_LOCAL_MODEL_ID,
  selectedModelId: preferencesManager.get().suggestions.localModelId,
  port: env.TAB_LOCAL_INFERENCE_PORT,
  canAccessCatalog: () =>
    currentDesktopStatus?.entitlement?.capabilities.modelCatalogAccess
    ?? preferencesManager.get().cachedEntitlement?.entitlement.capabilities.modelCatalogAccess
    ?? false,
  getMemories: () =>
    preferencesManager.get().suggestions.usePersonalMemory
      ? currentMemories
      : [],
  getCustomWritingInstructions: () =>
    currentDesktopStatus?.entitlement?.capabilities.customWritingInstructions
      ? preferencesManager.get().suggestions.customWritingInstructions || undefined
      : undefined,
  onDiagnostic: DEVELOPMENT_LOGGING
    ? (event, details) => logLocalSuggestion(`inference.${event}`, details)
    : undefined,
  onStatusChange: (status) => {
    controlWindowManager.sendLocalInferenceStatus(status);
    if (status.status === "unavailable") {
      updateDebugApiState({ status: "local-unavailable", reason: status.reason });
    }
  },
  onCatalogChange: (catalog) => controlWindowManager.sendLocalModelCatalog(catalog),
  onSelectedModelChange: (localModelId) => {
    const preferences = preferencesManager.update({ suggestions: { localModelId } });
    controlWindowManager.sendPreferences(preferences);
  },
});
reconcileLocalModelAccess = () => {
  void localInference.reconcileAccess()
    .then(() => localInference.start())
    .catch((error) => console.error("Failed to reconcile Local Model Catalog access:", error));
};
const nativeAutocompleteApp = createNativeAutocompleteApp({
  typingContext: typingContextBuffer,
  appContext: appContextExtractor,
  memoryExtraction: memoryExtractionDispatcher,
  getAutomaticSuggestion: async (snapshot, options) => {
    if (controlWindowManager.isRoute("onboarding")) return null;
    updateDebugApiState({ status: "loading" });
    const startedAt = performance.now();
    try {
      const suggestion = await localInference.getSuggestion(snapshot, options);
      if (suggestion && !options?.signal?.aborted) {
        const timing = localInference.getLastTiming();
        completionHistory.stageLocalSuggestion(suggestion.id, {
          input: snapshot.sanitizedContext,
          output: suggestion.text,
          latencyMs: Math.round(performance.now() - startedAt),
          ...(timing ?? {}),
          model: localInference.getSelectedModelId(),
        });
      }
      updateDebugApiState(suggestion ? { status: "suggestion", text: suggestion.text } : { status: "empty" });
      return suggestion;
    } catch (error) {
      const status = localInference.getStatus();
      updateDebugApiState({
        status: "local-unavailable",
        reason: status.status === "unavailable" ? status.reason : "request_failed",
      });
      throw error;
    }
  },
  onSuggestionDiagnostic: DEVELOPMENT_LOGGING
    ? (event, details) => logLocalSuggestion(`loop.${event}`, details)
    : undefined,
  requestDeepComplete,
  outputs: {
    showSuggestion: showOverlay,
    showGuidance: showOverlayGuidance,
    clearSuggestion: clearSuggestionOverlay,
    hideOverlay,
    showDebugContext: showDebugTypingOverlay,
    resetDebugApiState: () => {
      debugApiState = { status: "idle" };
    },
    setSuggestionRefreshing: (refreshing) => {
      if (!overlayRendererReady || !isUsableWebContents(overlayWindow)) return;
      overlayWindow.webContents.send("suggestion-refreshing", refreshing);
    },
    onRequestStarted: () => updateDebugApiState({ status: "loading" }),
    onRequestFinished: (suggestion) => {
      updateDebugApiState(suggestion ? { status: "suggestion", text: suggestion.text } : { status: "empty" });
    },
  },
  createAcceptanceDependencies: (getCurrentSuggestion, getPreviouslyActiveApplication) => ({
    getCurrentSuggestion,
    getPreviouslyActiveApplication,
    setClipboard: async (text) => {
      const previous = clipboard.readText();
      clipboard.writeText(text);
      pendingSyntheticPaste = { text, expiresAt: Date.now() + 1_000 };
      return previous;
    },
    sendPaste: async () => {
      // On macOS, send Cmd+V via System Events. This requires Accessibility
      // and Automation permissions, which are the same permissions the app
      // already guides the user to grant. The overlay is focusable: false so
      // the previously active application remains frontmost for Option+Tab.
      if (process.platform === "darwin") {
        await execAsync('osascript -e \'tell application "System Events" to keystroke "v" using command down\'');
      }
    },
    waitForPaste: async () => {
      // Some target apps process the paste event after osascript returns. Keep
      // the suggestion on the pasteboard until the app has consumed Cmd+V.
      await delay(CLIPBOARD_RESTORE_DELAY_MS);
    },
    restoreClipboard: async (previous) => {
      clipboard.writeText(previous);
    },
  }),
  debounceMs: 100,
  maxVisibleMs: SUGGESTION_VISIBLE_MS,
  recordInteractionTelemetry,
  canAcceptLocalSuggestion: () =>
    acceptedWordLedger.canAccept(
      currentDesktopStatus?.entitlement
        ? currentDesktopStatus.entitlement.capabilities.localAcceptedWordsPerDay
        : 100,
    ),
  onLocalAllowanceExhausted: () => controlWindowManager.show(),
  recordAcceptedUsage: (event) => {
    acceptedWordLedger.record(event);
    void synchronizeAcceptedWordLedger();
  },
  onLocalSuggestionAccepted: (suggestionId) => {
    completionHistory.acceptLocalSuggestion(suggestionId);
  },
  getLocalSuggestionModelId: () => localInference.getSelectedModelId(),
});

const desktopEventIngress = createDesktopEventIngress({
  onReady: () => console.log("macOS input tap ready."),
  onError: (message) => console.error("macOS input tap error:", message),
  onActiveApplicationChanged: handleActiveApplicationChanged,
  onTextInput: handleTextInput,
  onPastedText: handlePastedText,
  onContextInvalidated: handleContextInvalidated,
  onDeleteBackward: handleDeleteBackward,
  onSuggestNow: handleSuggestNow,
  onTextSessionSnapshot: handleTextSessionSnapshot,
  onAppContextTree: handleAppContextTree,
});
const macOSInputTap = createMacOSInputTap({
  executablePath: INPUT_TAP_PATH,
  onMessage: (message) => desktopEventIngress.handleMessage(message),
  onError: (...details) => console.error(...details),
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function refreshMemories(): Promise<void> {
  const memories = await memoryClient.listMemories();
  currentMemories = memories;
  controlWindowManager.sendMemories(memories);
}

function updateTrayFromStatus(status: DesktopStatus): void {
  tray?.update(createTrayState(status));
}

function setUsePersonalMemoryForSuggestions(enabled: boolean): void {
  const preferences = preferencesManager.update({ suggestions: { usePersonalMemory: enabled } });
  controlWindowManager.sendPreferences(preferences);
}

function setContinuousMemoryExtraction(enabled: boolean): void {
  const preferences = preferencesManager.update({
    suggestions: { continuousMemoryExtraction: enabled },
  });
  if (!enabled) memoryExtractionDispatcher.cancelAndClear();
  controlWindowManager.sendPreferences(preferences);
}

function setCustomWritingInstructions(value: string): void {
  const preferences = preferencesManager.update({
    suggestions: { customWritingInstructions: value.trimStart().slice(0, 1_000) },
  });
  controlWindowManager.sendPreferences(preferences);
}

function updateTray(): void {
  tray?.update(createTrayState(statusService.getCurrentStatus()));
}

function createTrayState(status: DesktopStatus) {
  return {
    paused: nativeAutocompleteApp.isPaused(),
    auth: status.auth,
    quotaExhausted: false,
    update: desktopUpdater.getState(),
  };
}

async function togglePause(): Promise<void> {
  const paused = !nativeAutocompleteApp.isPaused();
  nativeAutocompleteApp.setPaused(paused);
  controlWindowManager.sendPaused(paused);
  updateTray();
  if (paused) {
    clearContextAndHide();
  }
}

async function signOut(): Promise<void> {
  console.log("Signing out device:", DEVICE_ID);
  await authClient.clearToken();
  memoryExtractionDispatcher.cancelAndClear();
  clearContextAndHide();
  await statusService.refresh();
  await refreshMemories();
  showSignedOutSurface();
}

async function signIn(): Promise<void> {
  console.log("Opening browser sign-in for device:", DEVICE_ID);
  const callbackUrl = await authCallback.getCallbackUrl();
  await authClient.openBrowserLogin({ callbackUrl });
}

async function completeBrowserHandoff(url: string): Promise<void> {
  console.log("Received auth callback");
  await authClient.handleCallback(url);
  console.log("Device token stored after browser handoff for device:", DEVICE_ID);
  await statusService.refresh();
  await refreshMemories();
  showAuthenticatedDesktopSurface();
}

function showSignedOutSurface(): void {
  controlWindowManager.show("sign-in");
}

function showAuthenticatedDesktopSurface(): void {
  if (onboardingManager.shouldShowOnboarding()) {
    clearContextAndHide();
    controlWindowManager.show("onboarding");
    return;
  }

  controlWindowManager.show();
}

async function showInitialDesktopSurface(): Promise<void> {
  if (!(await authClient.isAuthenticated())) {
    showSignedOutSurface();
    return;
  }

  showAuthenticatedDesktopSurface();
}

function getCurrentDisplay(): Electron.Display {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

function getSuggestionOverlayBounds(height = OVERLAY_SUGGESTION_HEIGHT): Electron.Rectangle {
  const display = getCurrentDisplay();
  const { x, y, width, height: workAreaHeight } = display.workArea;
  const overlayWidth = Math.max(1, Math.min(OVERLAY_WIDTH, width - 16));
  const overlayHeight = Math.max(1, Math.min(height, workAreaHeight));

  return {
    width: overlayWidth,
    height: overlayHeight,
    x: x + Math.round((width - overlayWidth) / 2),
    y: Math.max(y, y + workAreaHeight - overlayHeight - OVERLAY_BOTTOM_MARGIN),
  };
}

function getInlineSuggestionOverlayBounds(caretBounds: NonNullable<TextSessionSnapshot["caretBounds"]>): Electron.Rectangle {
  const display = screen.getDisplayNearestPoint({ x: Math.round(caretBounds.x), y: Math.round(caretBounds.y) });
  const textX = Math.round(caretBounds.x + Math.max(caretBounds.width, 1));
  const workAreaRight = display.workArea.x + display.workArea.width;
  const workAreaBottom = display.workArea.y + display.workArea.height;
  const x = Math.max(display.workArea.x, textX - INLINE_OVERLAY_LEFT_BLEED);
  const height = Math.max(1, Math.min(Math.round(caretBounds.height), display.workArea.height));
  const y = Math.max(display.workArea.y, Math.min(Math.round(caretBounds.y), workAreaBottom - height));
  const availableWidth = workAreaRight - x;

  return {
    x,
    y,
    width: Math.max(1, Math.min(OVERLAY_WIDTH, availableWidth)),
    height,
  };
}

function getCurrentOverlayBounds(): Electron.Rectangle {
  const snapshot = nativeAutocompleteApp.getCurrentSnapshot();
  if (nativeAutocompleteApp.getCurrentSuggestion() && isObsidianInlineTarget(snapshot)) {
    return getInlineSuggestionOverlayBounds(snapshot.textSession!.caretBounds!);
  }
  return getSuggestionOverlayBounds(isUsableWindow(overlayWindow) ? overlayWindow.getBounds().height : undefined);
}

function getDebugOverlayBounds(): Electron.Rectangle {
  const display = getCurrentDisplay();
  const { x, y, width } = display.workArea;

  return {
    width: OVERLAY_DEBUG_WIDTH,
    height: OVERLAY_DEBUG_HEIGHT,
    x: x + Math.round((width - OVERLAY_DEBUG_WIDTH) / 2),
    y: y + 24,
  };
}

function configureFloatingPanel(win: BrowserWindow): void {
  if (process.platform !== "darwin") return;

  win.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });
  win.setAlwaysOnTop(true, "screen-saver");
}

function isBoundsOnScreen(bounds: Electron.Rectangle, displays = screen.getAllDisplays()): boolean {
  return displays.some((display) => {
    const workArea = display.workArea;
    const overlapsX = bounds.x < workArea.x + workArea.width && bounds.x + bounds.width > workArea.x;
    const overlapsY = bounds.y < workArea.y + workArea.height && bounds.y + bounds.height > workArea.y;
    return overlapsX && overlapsY;
  });
}

function installOverlayPositionTracking(win: BrowserWindow, getBounds: () => Electron.Rectangle): void {
  const reposition = () => {
    if (win.isDestroyed() || !win.isVisible()) return;
    const currentBounds = win.getBounds();
    const displays = screen.getAllDisplays();
    if (!isBoundsOnScreen(currentBounds, displays) || displays.length > 1) {
      const nextBounds = getBounds();
      if (!boundsEqual(currentBounds, nextBounds)) {
        win.setBounds(nextBounds, false);
      }
    }
  };

  let interval: ReturnType<typeof setInterval> | null = null;
  const stopTracking = () => {
    if (interval === null) return;
    clearInterval(interval);
    interval = null;
  };
  const startTracking = () => {
    if (interval !== null || win.isDestroyed()) return;
    reposition();
    interval = setInterval(reposition, OVERLAY_POSITION_CHECK_MS);
  };
  const onDisplayChanged = () => reposition();
  win.on("show", startTracking);
  win.on("hide", stopTracking);
  screen.on("display-added", onDisplayChanged);
  screen.on("display-removed", onDisplayChanged);
  screen.on("display-metrics-changed", onDisplayChanged);
  if (win.isVisible()) startTracking();
  win.on("closed", () => {
    stopTracking();
    win.off("show", startTracking);
    win.off("hide", stopTracking);
    screen.off("display-added", onDisplayChanged);
    screen.off("display-removed", onDisplayChanged);
    screen.off("display-metrics-changed", onDisplayChanged);
  });
}

function createOverlayWindow(): BrowserWindow {
  const bounds = getSuggestionOverlayBounds();

  const win = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    show: false,
    resizable: false,
    fullscreenable: false,
    hiddenInMissionControl: true,
    type: process.platform === "darwin" ? "panel" : undefined,
    backgroundColor: PLATFORM_COLORS.transparentWindow,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  configureFloatingPanel(win);
  installOverlayPositionTracking(win, getCurrentOverlayBounds);
  win.setIgnoreMouseEvents(true, { forward: true });
  win.on("closed", () => {
    if (overlayWindow === win) {
      overlayWindow = null;
      overlayRendererReady = false;
    }
  });
  win.loadFile(OVERLAY_RENDERER_PATH);
  return win;
}

function createDebugOverlayWindow(): BrowserWindow {
  const bounds = getDebugOverlayBounds();

  const win = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    show: false,
    resizable: false,
    fullscreenable: false,
    hiddenInMissionControl: true,
    type: process.platform === "darwin" ? "panel" : undefined,
    backgroundColor: PLATFORM_COLORS.transparentWindow,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  configureFloatingPanel(win);
  installOverlayPositionTracking(win, getDebugOverlayBounds);
  win.on("closed", () => {
    if (debugOverlayWindow === win) {
      debugOverlayWindow = null;
    }
  });
  win.loadFile(OVERLAY_RENDERER_PATH);
  win.setIgnoreMouseEvents(true, { forward: true });
  return win;
}

function isUsableWindow(win: BrowserWindow | null): win is BrowserWindow {
  return win !== null && !win.isDestroyed();
}

function isUsableWebContents(win: BrowserWindow | null): win is BrowserWindow {
  return isUsableWindow(win) && !win.webContents.isDestroyed();
}

function resizeOverlayWindow(height: number): void {
  if (!isUsableWindow(overlayWindow)) return;
  overlayWindow.setBounds(getSuggestionOverlayBounds(height), false);
}

function isObsidianInlineTarget(snapshot: ReturnType<typeof nativeAutocompleteApp.getCurrentSnapshot>): boolean {
  const caretBounds = snapshot.textSession?.caretBounds;
  return snapshot.activeApplication?.bundleId === OBSIDIAN_BUNDLE_ID
    && snapshot.textSession?.accessibilityReliability === "reliable"
    && snapshot.textSession.selectedRange?.length === 0
    && caretBounds !== undefined
    && getInlineSuggestionOverlayBounds(caretBounds).width >= INLINE_OVERLAY_MIN_WIDTH;
}

function unregisterObsidianTabAcceptance(): void {
  if (globalShortcut.isRegistered(OBSIDIAN_ACCEPTANCE_SHORTCUT)) {
    globalShortcut.unregister(OBSIDIAN_ACCEPTANCE_SHORTCUT);
  }
}

function registerObsidianTabAcceptance(): void {
  unregisterObsidianTabAcceptance();
  const registered = globalShortcut.register(OBSIDIAN_ACCEPTANCE_SHORTCUT, () => {
    acceptCurrentSuggestion().catch((error) => {
      console.error("Failed to accept Obsidian suggestion:", error);
    });
  });
  if (!registered) {
    console.error("Failed to register Tab acceptance shortcut for Obsidian");
  }
}

function showOverlay(suggestion: Suggestion, provenance: SuggestionProvenance): void {
  if (controlWindowManager.isRoute("onboarding")) return;
  if (!overlayRendererReady || !isUsableWebContents(overlayWindow)) return;
  const snapshot = nativeAutocompleteApp.getCurrentSnapshot();
  const inline = isObsidianInlineTarget(snapshot);
  if (inline) {
    overlayWindow.setBounds(getInlineSuggestionOverlayBounds(snapshot.textSession!.caretBounds!), false);
    registerObsidianTabAcceptance();
  } else {
    unregisterObsidianTabAcceptance();
    resizeOverlayWindow(OVERLAY_SUGGESTION_HEIGHT);
  }
  overlayWindow.webContents.send("suggestion", {
    ...suggestion,
    source: provenance === "automatic" ? "local" : "cloud",
    provenance,
    acceptable: true,
    presentation: inline ? "inline" : "floating",
    ...(inline ? {
      inlineMetrics: {
        fontSize: Math.max(11, Math.min(20, Math.round(snapshot.textSession!.caretBounds!.height * 0.78))),
        lineHeight: Math.max(1, Math.round(snapshot.textSession!.caretBounds!.height)),
      },
    } : {}),
  });
  if (!overlayWindow.isVisible()) {
    overlayWindow.showInactive();
  }
}

function showOverlayGuidance(message: string): void {
  if (controlWindowManager.isRoute("onboarding")) return;
  if (!overlayRendererReady || !isUsableWebContents(overlayWindow)) return;
  unregisterObsidianTabAcceptance();
  resizeOverlayWindow(OVERLAY_SUGGESTION_HEIGHT);
  overlayWindow.webContents.send("suggestion", {
    id: "rewrite-guidance",
    text: message,
    source: "cloud",
    provenance: "rewrite",
    acceptable: false,
    presentation: "floating",
  });
  overlayWindow.showInactive();
}

function clearSuggestionOverlay(): void {
  unregisterObsidianTabAcceptance();
  if (!overlayRendererReady || !isUsableWebContents(overlayWindow)) return;
  overlayWindow.webContents.send("hide");
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.hide();
}

function hideOverlay(): void {
  clearSuggestionOverlay();
  if (!isUsableWindow(debugOverlayWindow)) return;
  if (SHOW_DEBUG_TYPING_OVERLAY && typingContextBuffer.getState().context.length > 0) {
    showDebugTypingOverlay();
    return;
  }
  hideDebugTypingOverlay();
}

function hideDebugTypingOverlay(): void {
  if (!isUsableWebContents(debugOverlayWindow)) return;
  debugOverlayWindow.webContents.send("hide");
  debugOverlayWindow.hide();
  if (debugTypingTimer) {
    clearTimeout(debugTypingTimer);
    debugTypingTimer = null;
  }
  if (debugTypingHideTimer) {
    clearTimeout(debugTypingHideTimer);
    debugTypingHideTimer = null;
  }
}

function sendDebugContext(): void {
  if (!SHOW_DEBUG_TYPING_OVERLAY || !isUsableWebContents(debugOverlayWindow)) return;

  const snapshot = nativeAutocompleteApp.getCurrentSnapshot();
  const context = getLastWords(snapshot.sanitizedContext, DEBUG_TYPING_WORD_LIMIT);
  debugOverlayWindow.webContents.send("debug-context", {
    context,
    wordLimit: DEBUG_TYPING_WORD_LIMIT,
    wordCount: context.length === 0 ? 0 : context.split(/\s+/).length,
    source: snapshot.contextSource,
    app: snapshot.activeApplication?.bundleId ?? null,
    paused: snapshot.paused,
    secureInput: snapshot.secureInput,
    appContext: snapshot.appContext ? debugAppContextState(snapshot.appContext) : undefined,
    api: debugApiState,
  });
}

function debugAppContextState(appContext: AppContextSnapshot): DebugAppContextState {
  const messageCount = appContext.fragments.reduce((count, fragment) => {
    const fragmentMessageCount = fragment.metadata?.messageCount;
    return count + (typeof fragmentMessageCount === "number" ? fragmentMessageCount : 0);
  }, 0);

  return {
    status: appContext.metadata.status,
    provider: appContext.metadata.provider ?? null,
    confidence: appContext.metadata.confidence ?? null,
    suppressionReason: appContext.metadata.suppressionReason ?? null,
    fragmentCount: appContext.fragments.length,
    messageCount,
  };
}

function updateDebugApiState(apiState: DebugApiState): void {
  debugApiState = apiState;
  if (!SHOW_DEBUG_TYPING_OVERLAY || !isUsableWindow(debugOverlayWindow)) return;
  if (typingContextBuffer.getState().context.length === 0) return;

  sendDebugContext();
  debugOverlayWindow.showInactive();
}

function showDebugTypingOverlay(): void {
  if (!SHOW_DEBUG_TYPING_OVERLAY || !isUsableWindow(debugOverlayWindow)) return;
  if (SHOW_DEBUG_TYPING_OVERLAY && typingContextBuffer.getState().context.length > 0) {
    if (debugTypingTimer) {
      clearTimeout(debugTypingTimer);
    }
    if (debugTypingHideTimer) {
      clearTimeout(debugTypingHideTimer);
      debugTypingHideTimer = null;
    }
    debugTypingTimer = setTimeout(() => {
      debugTypingTimer = null;
      if (!SHOW_DEBUG_TYPING_OVERLAY || !isUsableWindow(debugOverlayWindow)) return;

      sendDebugContext();
      debugOverlayWindow.showInactive();
      debugTypingHideTimer = setTimeout(() => {
        debugTypingHideTimer = null;
        if (isUsableWindow(debugOverlayWindow)) {
          debugOverlayWindow.hide();
        }
      }, DEBUG_TYPING_HIDE_MS);
    }, DEBUG_TYPING_DEBOUNCE_MS);
  } else {
    debugOverlayWindow.hide();
    if (debugTypingTimer) {
      clearTimeout(debugTypingTimer);
      debugTypingTimer = null;
    }
    if (debugTypingHideTimer) {
      clearTimeout(debugTypingHideTimer);
    }
    debugTypingHideTimer = null;
  }
}

async function acceptCurrentSuggestion(): Promise<void> {
  await nativeAutocompleteApp.acceptCurrentSuggestion();
}

async function requestSuggestionNow(): Promise<void> {
  await nativeAutocompleteApp.requestSuggestionNow();
}

function handleSuggestNow(): void {
  if (controlWindowManager.isRoute("onboarding")) return;
  requestSuggestionNow().catch((error) => {
    console.error("Failed to suggest now from double-tap Option:", error);
  });
}

function clearContextAndHide(): void {
  nativeAutocompleteApp.clearContext();
  debugApiState = { status: "idle" };
  if (debugTypingTimer) {
    clearTimeout(debugTypingTimer);
    debugTypingTimer = null;
  }
  if (debugTypingHideTimer) {
    clearTimeout(debugTypingHideTimer);
    debugTypingHideTimer = null;
  }
}

function checkForUpdates(errorMessage: string): void {
  if (!app.isPackaged) return;
  desktopUpdater.checkForUpdates().catch((error) => {
    console.error(errorMessage, error);
  });
}

function handleAppContextTree(accessibilityTree: AppContextAccessibilityTree): void {
  nativeAutocompleteApp.ingestAppContextTree(accessibilityTree);
}

async function bootstrap(): Promise<void> {
  void localInference.start();
  // Onboarding should guide the user to grant Accessibility and Input Monitoring
  // permissions. Tab deliberately does not request Screen Recording or Full
  // Disk Access; those are out of scope for the MVP per ADR-0037.
  ipcMain.on("overlay-ready", (event) => {
    if (!isUsableWebContents(overlayWindow) || event.sender !== overlayWindow.webContents) return;

    overlayRendererReady = true;
    const visibleSuggestion = nativeAutocompleteApp.getVisibleSuggestion();
    if (visibleSuggestion) {
      showOverlay(visibleSuggestion.suggestion, visibleSuggestion.provenance);
    }
  });

  ipcMain.on("overlay-pointer-interaction", (event, interactive: boolean) => {
    if (!isUsableWebContents(overlayWindow) || event.sender !== overlayWindow.webContents) return;
    overlayWindow.setIgnoreMouseEvents(!interactive, interactive ? undefined : { forward: true });
  });

  overlayWindow = createOverlayWindow();
  debugOverlayWindow = SHOW_DEBUG_TYPING_OVERLAY ? createDebugOverlayWindow() : null;
  packagedAuthCallback.activate(process.argv);

  const registered = globalShortcut.register("Alt+Tab", () => {
    if (controlWindowManager.isRoute("onboarding") && controlWindowManager.isFocused()) {
      controlWindowManager.sendOptionTab();
      return;
    }
    acceptCurrentSuggestion().catch((error) => {
      console.error("Failed to accept suggestion:", error);
    });
  });

  if (!registered) {
    console.error("Failed to register Option+Tab acceptance shortcut");
  }

  ipcMain.on("accept-suggestion", (event) => {
    if (!isUsableWebContents(overlayWindow) || event.sender !== overlayWindow.webContents) return;
    acceptCurrentSuggestion().catch((error) => {
      console.error("Failed to accept suggestion via overlay click:", error);
    });
  });

  // Settings / status / quick memory IPC handlers. These keep the overlay
  // focused on suggestions; status and memory surfaces live in their own window
  // and tray menu.
  ipcMain.on("complete-onboarding", () => {
    onboardingManager.completeOnboarding();
    controlWindowManager.show();
  });

  ipcMain.on("complete-onboarding-and-relaunch", () => {
    onboardingManager.completeOnboarding();
    relaunchAfterPermissionQuit = true;
    app.quit();
  });

  ipcMain.handle("open-accessibility-settings", async () => {
    if (process.platform !== "darwin") return false;

    const trusted = systemPreferences.isTrustedAccessibilityClient(true);
    if (!trusted) {
      await shell.openExternal(MACOS_PERMISSION_SETTINGS_URLS.accessibility);
    }
    return trusted;
  });

  ipcMain.handle("check-accessibility-permission", () => {
    if (process.platform !== "darwin") return true;
    return systemPreferences.isTrustedAccessibilityClient(false);
  });

  ipcMain.handle("open-input-monitoring-settings", async () => {
    if (process.platform === "darwin") {
      await shell.openExternal(MACOS_PERMISSION_SETTINGS_URLS.inputMonitoring);
    }
  });

  ipcMain.handle("reveal-app-in-finder", () => {
    shell.showItemInFolder(getMacOSAppBundlePath(app.getPath("exe")));
  });

  ipcMain.handle("relaunch-for-permissions", () => {
    relaunchAfterPermissionQuit = true;
    app.quit();
  });

  ipcMain.on("sign-in", () => {
    signIn().catch((error) => console.error("Failed to open sign in:", error));
  });

  ipcMain.on("sign-out", () => {
    signOut().catch((error) => console.error("Failed to sign out:", error));
  });
  ipcMain.on("open-pricing", () => {
    shell.openExternal(`${WEB_BASE_URL}/pricing`).catch((error) =>
      console.error("Failed to open pricing:", error),
    );
  });

  ipcMain.on("toggle-pause", () => {
    togglePause().catch((error) => console.error("Failed to toggle pause:", error));
  });
  ipcMain.handle("download-local-model", (_event, modelId?: unknown) =>
    localInference.downloadModel(modelId === undefined ? undefined : LocalModelIdSchema.parse(modelId)));
  ipcMain.handle("select-local-model", (_event, modelId: unknown) =>
    localInference.selectModel(LocalModelIdSchema.parse(modelId)));
  ipcMain.handle("check-for-updates", (event) => {
    if (!controlWindowManager.ownsFrame(event.senderFrame)) {
      throw new Error("Update controls are only available from the control window");
    }
    if (!app.isPackaged) return;
    return desktopUpdater.checkForUpdates();
  });
  ipcMain.handle("download-update", (event) => {
    if (!controlWindowManager.ownsFrame(event.senderFrame)) {
      throw new Error("Update controls are only available from the control window");
    }
    return desktopUpdater.downloadUpdate();
  });
  ipcMain.handle("install-update", (event) => {
    if (!controlWindowManager.ownsFrame(event.senderFrame)) {
      throw new Error("Update controls are only available from the control window");
    }
    desktopUpdater.quitAndInstall();
  });

  ipcMain.on("delete-memory", (_event, id: string) => {
    memoryClient
      .deleteMemory(id)
      .then((deleted) => {
        if (deleted) {
          return refreshMemories();
        }
      })
      .catch((error) => console.error("Failed to delete memory:", error));
  });

  ipcMain.on("set-use-personal-memory-for-suggestions", (_event, enabled: boolean) => {
    setUsePersonalMemoryForSuggestions(Boolean(enabled));
  });
  ipcMain.on("set-continuous-memory-extraction", (_event, enabled: boolean) => {
    setContinuousMemoryExtraction(Boolean(enabled));
  });
  ipcMain.on("set-custom-writing-instructions", (_event, value: string) => {
    setCustomWritingInstructions(typeof value === "string" ? value : "");
  });

  ipcMain.handle("get-initial-state", () => ({
    status: statusService.getCurrentStatus(),
    memories: currentMemories,
    paused: nativeAutocompleteApp.isPaused(),
    preferences: preferencesManager.get(),
    localInferenceStatus: localInference.getStatus(),
    localModelCatalog: localInference.getCatalogState(),
    completionHistory: completionHistory.getEntries(),
    updateState: desktopUpdater.getState(),
  }));

  // Packaged macOS builds declare this scheme in electron-builder.yml. During
  // development, browser handoff uses loopback so generic Electron.app is not
  // registered as the system handler.
  if (process.platform === "darwin") {
    if (app.isPackaged) {
      app.setAsDefaultProtocolClient("tab");
    } else if (app.isDefaultProtocolClient("tab")) {
      // Remove registrations left by older dev builds that pointed at the
      // generic Electron.app without Tab's development app argument.
      app.removeAsDefaultProtocolClient("tab");
    }
  }

  // The local typing context buffer remains in process memory only and clears
  // on sleep/lock so sensitive context cannot sit around (ADR-0018).
  powerMonitor.on("suspend", clearContextAndHide);
  powerMonitor.on("lock-screen", clearContextAndHide);

  // Tray menu keeps settings, pause, updates, and account actions available
  // without adding controls to the suggestion overlay.
  tray = createTrayMenu({
    icon: TRAY_ICON_PATH,
    actions: {
      showSettings: () => {
        showInitialDesktopSurface().catch((error) => console.error("Failed to show settings from tray:", error));
      },
      togglePause: () => {
        togglePause().catch((error) => console.error("Failed to toggle pause from tray:", error));
      },
      signIn: () => {
        signIn().catch((error) => console.error("Failed to sign in from tray:", error));
      },
      signOut: () => {
        signOut().catch((error) => console.error("Failed to sign out from tray:", error));
      },
      checkForUpdates: () => {
        checkForUpdates("Failed to check for updates:");
      },
      downloadUpdate: () => {
        desktopUpdater.downloadUpdate().catch((error) => {
          console.error("Failed to download update:", error);
        });
      },
      installUpdate: () => desktopUpdater.quitAndInstall(),
      quit: () => app.quit(),
    },
  });

  // Check for updates shortly after launch and then every hour. The initial
  // check is delayed so it does not block first-launch onboarding.
  setTimeout(() => {
    checkForUpdates("Failed initial update check:");
  }, 60_000);
  setInterval(() => {
    checkForUpdates("Failed periodic update check:");
  }, 60 * 60 * 1_000);

  // Poll status so the tray and settings window reflect auth, quota, and
  // connectivity changes without requiring user interaction.
  setInterval(() => {
    statusService.refresh().catch((error) => {
      console.error("Failed to refresh status:", error);
    });
  }, 60_000);

  // Show onboarding on first launch; once completed it will not reappear.
  showInitialDesktopSurface().catch((error) => console.error("Failed to show initial desktop surface:", error));

  // Input monitoring and active-application tracking are wired to the same
  // in-memory buffer. In a production build these are fed by a macOS native
  // input tap (IOKit/Quartz Event Services) and an active-app observer.
  handleActiveApplicationChanged("com.apple.TextEdit", null);
  macOSInputTap.start();

  // Initial status and memory refresh.
  statusService.refresh().catch((error) => console.error("Failed initial status refresh:", error));
  synchronizeAcceptedWordLedger().catch((error) =>
    console.error("Failed initial Accepted Word reconciliation:", error),
  );
  refreshMemories().catch((error) => console.error("Failed initial memory refresh:", error));
}

app.whenReady().then(bootstrap).catch((error) => {
  console.error("Failed to bootstrap desktop app:", error);
});

app.on("will-quit", () => {
  if (relaunchAfterPermissionQuit) {
    app.relaunch({ args: process.argv.slice(1) });
  }
  globalShortcut.unregisterAll();
  if (isUsableWindow(debugOverlayWindow)) {
    debugOverlayWindow.close();
  }
  macOSInputTap.stop();
  localInference.stop();
  memoryExtractionDispatcher.stop();
  typingContextBuffer.clearAll();
  void authCallback.close().catch(() => {});
});

app.on("window-all-closed", () => {
  // The overlay is a child window; on macOS the app stays alive until quit.
  // Do not call app.quit() here so Tab keeps running in the background.
});

app.on("activate", () => {
  showInitialDesktopSurface().catch((error) => console.error("Failed to show desktop surface:", error));
});

// Exposed for the native input bridge and for tests.
export function handleTextInput(text: string): void {
  console.log("[local-suggestions] input.text", {
    utf16Length: text.length,
    codePointCount: Array.from(text).length,
    containsNonAscii: /[^\x00-\x7F]/u.test(text),
  });
  nativeAutocompleteApp.appendText(text);
}

export function handlePastedText(text: string): void {
  if (pendingSyntheticPaste?.text === text && pendingSyntheticPaste.expiresAt >= Date.now()) {
    pendingSyntheticPaste = null;
    return;
  }
  pendingSyntheticPaste = null;
  nativeAutocompleteApp.appendPastedText(text);
}

export function handleContextInvalidated(reason: string): void {
  console.log("[local-suggestions] input.context-invalidated", { reason });
  nativeAutocompleteApp.invalidateContext();
}

export function handleDeleteBackward(unit: TypingDeletionUnit = "character"): void {
  console.log("[local-suggestions] input.delete", { unit });
  nativeAutocompleteApp.deleteBackward(unit);
}

export function handleActiveApplicationChanged(bundleId: string | null, windowId: string | null = null): void {
  nativeAutocompleteApp.setActiveApplication(bundleId, windowId);
}

export function handleSecureInputChanged(active: boolean): void {
  nativeAutocompleteApp.setSecureInput(active);
}

export function handleTextSessionSnapshot(snapshot: TextSessionSnapshot): void {
  nativeAutocompleteApp.applyTextSessionSnapshot(snapshot);
  if (
    nativeAutocompleteApp.getCurrentSuggestion()
    && isObsidianInlineTarget(nativeAutocompleteApp.getCurrentSnapshot())
    && isUsableWindow(overlayWindow)
  ) {
    overlayWindow.setBounds(getInlineSuggestionOverlayBounds(snapshot.caretBounds!), false);
  }
}

export function handlePauseChanged(active: boolean): void {
  nativeAutocompleteApp.setPaused(active);
}

export function getCurrentSuggestionForTest(): Suggestion | null {
  return nativeAutocompleteApp.getCurrentSuggestion();
}
