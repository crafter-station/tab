import {
  app,
  BrowserWindow,
  globalShortcut,
  clipboard,
  ipcMain,
  screen,
  powerMonitor,
  shell,
  systemPreferences,
} from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec, spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { promisify } from "node:util";
import {
  createTypingContextBuffer,
  getLastWords,
  type TextSessionSnapshot,
  type TypingDeletionUnit,
} from "./typing-context.ts";
import { createApiSuggestionClient } from "./suggestion-client.ts";
import { createDesktopTelemetryClient } from "./telemetry-client.ts";
import { createNativeAutocompleteRuntime } from "./native-autocomplete-runtime.ts";
import {
  type AppContextSnapshot,
} from "./app-context.ts";
import { createAppContextExtractor, type AppContextAccessibilityTree } from "./app-context-extractor.ts";
import { createDesktopEventIngress } from "./desktop-event-ingress.ts";
import { createDesktopAuthClient } from "./auth.ts";
import { createMacOSKeychain } from "./keychain.ts";
import { createDesktopStatusService, type DesktopStatus } from "./status.ts";
import { createDesktopMemoryClient } from "./memory-client.ts";
import { createMemoryExtractionWindow } from "./memory-extraction-window.ts";
import { createMemoryExtractionDispatcher } from "./memory-extraction-dispatcher.ts";
import { MACOS_PERMISSION_SETTINGS_URLS, createOnboardingManager, getMacOSAppBundlePath } from "./onboarding.ts";
import { createOnboardingWindowManager } from "./onboarding-window.ts";
import { createSettingsWindowManager } from "./settings-window.ts";
import { createTrayMenu, type TabTray } from "./tray-menu.ts";
import { createPreferencesManager, createFilePreferencesStorage } from "./preferences.ts";
import { createUpdateChecker } from "./release.ts";
import type { Suggestion, PersonalMemory } from "@tab/contracts";
import { env } from "./env.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execAsync = promisify(exec);
const runtimeRoot = app.isPackaged ? path.join(app.getAppPath(), "dist") : __dirname;
const PRELOAD_PATH = env.TAB_PRELOAD_PATH ?? path.join(runtimeRoot, "preload.cjs");
const OVERLAY_RENDERER_PATH = env.TAB_OVERLAY_RENDERER_PATH ?? path.join(runtimeRoot, "renderer", "overlay.html");
const APP_RENDERER_PATH = env.TAB_APP_RENDERER_PATH ?? path.join(runtimeRoot, "renderer", "app.html");
const TRAY_ICON_PATH = env.TAB_TRAY_ICON_PATH ?? path.join(runtimeRoot, "assets", "iconTemplate.png");
const packagedInputTapPath = path.join(process.resourcesPath, "app.asar.unpacked", "dist", "macos-input-tap");
const INPUT_TAP_PATH = env.TAB_INPUT_TAP_PATH ?? (app.isPackaged ? packagedInputTapPath : path.join(runtimeRoot, "macos-input-tap"));

let overlayWindow: BrowserWindow | null = null;
let debugOverlayWindow: BrowserWindow | null = null;
let overlayRendererReady = false;
let tray: TabTray | null = null;
let relaunchAfterPermissionQuit = false;
type InputTapProcess = {
  stdout: { on(event: "data", callback: (chunk: Buffer) => void): void };
  stderr: { on(event: "data", callback: (chunk: Buffer) => void): void };
  on(event: "exit", callback: (code: number | null, signal: string | null) => void): void;
  kill(): boolean;
};

let inputTapProcess: InputTapProcess | null = null;

const typingContextBuffer = createTypingContextBuffer();
const appContextExtractor = createAppContextExtractor();

const userDataPath = app.getPath("userData");
mkdirSync(userDataPath, { recursive: true });
const preferencesManager = createPreferencesManager({
  storage: createFilePreferencesStorage(path.join(userDataPath, "preferences.json")),
});

const onboardingManager = createOnboardingManager({
  getPreferences: () => preferencesManager.get().onboarding,
  setPreferences: (patch) =>
    preferencesManager.update({ onboarding: { ...preferencesManager.get().onboarding, ...patch } }),
});

const onboardingWindowManager = createOnboardingWindowManager({
  rendererPath: APP_RENDERER_PATH,
  preloadPath: PRELOAD_PATH,
});

const settingsWindowManager = createSettingsWindowManager({
  rendererPath: APP_RENDERER_PATH,
  preloadPath: PRELOAD_PATH,
});

const API_BASE_URL = env.TAB_API_BASE_URL;
const WEB_BASE_URL = env.TAB_WEB_BASE_URL;
const APP_VERSION = app.getVersion() || "0.0.0";

function getOrCreateDeviceId(): string {
  const prefs = preferencesManager.get();
  if (prefs.deviceId) return prefs.deviceId;
  const deviceId = env.TAB_DEVICE_ID || crypto.randomUUID();
  preferencesManager.update({ deviceId });
  console.log("Generated and persisted new device id:", deviceId);
  return deviceId;
}

const DEVICE_ID = getOrCreateDeviceId();
const SHOW_SETTINGS_ON_START = process.argv.includes("--permission-debug") || env.TAB_SHOW_SETTINGS_ON_START === "1";
const SHOW_DEBUG_TYPING_OVERLAY =
  env.TAB_DEBUG_TYPING_OVERLAY !== "0" &&
  (!app.isPackaged || env.TAB_DEBUG_TYPING_OVERLAY === "1" || process.argv.includes("--typing-debug") || SHOW_SETTINGS_ON_START);
const DEBUG_TYPING_DEBOUNCE_MS = 300;
const DEBUG_TYPING_HIDE_MS = 3_600;
const DEBUG_TYPING_WORD_LIMIT = 100;
const CLIPBOARD_RESTORE_DELAY_MS = 250;
const OVERLAY_WIDTH = 560;
const OVERLAY_SUGGESTION_HEIGHT = 64;
const OVERLAY_DEBUG_WIDTH = 540;
const OVERLAY_DEBUG_HEIGHT = 220;
const OVERLAY_BOTTOM_MARGIN = 8;
const OVERLAY_POSITION_CHECK_MS = 400;
const OVERLAY_HIT_TEST_MS = 50;
const SUGGESTION_VISIBLE_MS = 4_000;
const DOUBLE_OPTION_PRESS_MS = 500;

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

const requestSuggestion = createApiSuggestionClient({
  apiBaseUrl: API_BASE_URL,
  deviceId: DEVICE_ID,
  appVersion: APP_VERSION,
  platform: process.platform,
  memoryEnabled: () => preferencesManager.get().suggestions.usePersonalMemory,
  getAuthorizationHeader: () => authClient.getAuthorizationHeader(),
});
const recordInteractionTelemetry = createDesktopTelemetryClient({
  apiBaseUrl: API_BASE_URL,
  getAuthorizationHeader: () => authClient.getAuthorizationHeader(),
});

const memoryClient = createDesktopMemoryClient({
  apiBaseUrl: API_BASE_URL,
  getAuthorizationHeader: () => authClient.getAuthorizationHeader(),
});

const memoryExtractionWindow = createMemoryExtractionWindow({
  memoryEnabled: () => preferencesManager.get().suggestions.usePersonalMemory,
});

const memoryExtractionDispatcher = createMemoryExtractionDispatcher({
  window: memoryExtractionWindow,
  client: memoryClient,
  clientMetadata: {
    appVersion: APP_VERSION,
    platform: process.platform,
  },
});

let updateAvailable = false;
let consecutiveAuthFailures = 0;
const MAX_CONSECUTIVE_AUTH_FAILURES = 3;

const updateChecker = createUpdateChecker({
  currentVersion: APP_VERSION,
  feedUrl: `${WEB_BASE_URL}/download/latest.json`,
  onUpdateAvailable: () => {
    updateAvailable = true;
    updateTray();
  },
});

const statusService = createDesktopStatusService({
  apiBaseUrl: API_BASE_URL,
  getAuthorizationHeader: () => authClient.getAuthorizationHeader(),
  onChange: (status) => {
    settingsWindowManager.sendStatus(status);
    onboardingWindowManager.sendStatus(status);
    updateTrayFromStatus(status);

    if (status.auth === "signed_in") {
      if (consecutiveAuthFailures > 0) {
        console.log(`Auth recovered after ${consecutiveAuthFailures} transient failure(s).`);
        consecutiveAuthFailures = 0;
      }
      return;
    }

    if (status.auth === "revoked_device") {
      consecutiveAuthFailures = 0;
      console.warn("Device token revoked by server; signing out.");
      authClient
        .isAuthenticated()
        .then((authenticated) => {
          if (authenticated) {
            return authClient.clearToken().then(() => showSignedOutSurface());
          }
        })
        .catch((error) => {
          console.error("Failed to clear revoked device token:", error);
        });
      return;
    }

    if (status.auth === "sign_in_required") {
      authClient
        .isAuthenticated()
        .then((authenticated) => {
          if (!authenticated) {
            consecutiveAuthFailures = 0;
            return;
          }

          consecutiveAuthFailures += 1;
          console.warn(
            `Server reported sign-in required (failure ${consecutiveAuthFailures}/${MAX_CONSECUTIVE_AUTH_FAILURES}).`,
          );

          if (consecutiveAuthFailures < MAX_CONSECUTIVE_AUTH_FAILURES) {
            return;
          }

          console.error("Clearing device token after repeated sign-in-required responses.");
          return authClient.clearToken().then(() => {
            consecutiveAuthFailures = 0;
            showSignedOutSurface();
          });
        })
        .catch((error) => {
          console.error("Failed to handle sign-in-required status:", error);
        });
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
const nativeAutocompleteRuntime = createNativeAutocompleteRuntime({
  typingContext: typingContextBuffer,
  appContext: appContextExtractor,
  memoryExtraction: memoryExtractionDispatcher,
  requestSuggestion,
  outputs: {
    showSuggestion: showOverlay,
    clearSuggestion: clearSuggestionOverlay,
    hideOverlay,
    showDebugContext: showDebugTypingOverlay,
    resetDebugApiState: () => {
      debugApiState = { status: "idle" };
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
  debounceMs: 300,
  maxVisibleMs: SUGGESTION_VISIBLE_MS,
  recordInteractionTelemetry,
});

const desktopEventIngress = createDesktopEventIngress({
  onReady: () => console.log("macOS input tap ready."),
  onError: (message) => console.error("macOS input tap error:", message),
  onActiveApplicationChanged: handleActiveApplicationChanged,
  onTextInput: handleTextInput,
  onDeleteBackward: handleDeleteBackward,
  onOptionKeyUp: handleOptionKeyUp,
  onTextSessionSnapshot: handleTextSessionSnapshot,
  onAppContextTree: handleAppContextTree,
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function refreshMemories(): Promise<void> {
  const memories = await memoryClient.listMemories();
  currentMemories = memories;
  settingsWindowManager.sendMemories(memories);
}

function updateTrayFromStatus(status: DesktopStatus): void {
  tray?.update(createTrayState(status));
}

function setUsePersonalMemoryForSuggestions(enabled: boolean): void {
  const preferences = preferencesManager.get();
  const nextPreferences = {
    ...preferences,
    suggestions: {
      ...preferences.suggestions,
      usePersonalMemory: enabled,
    },
  };

  preferencesManager.update(nextPreferences);
  settingsWindowManager.sendPreferences(nextPreferences);
}

function updateTray(): void {
  tray?.update(createTrayState(statusService.getCurrentStatus()));
}

function createTrayState(status: DesktopStatus) {
  return {
    paused: nativeAutocompleteRuntime.isPaused(),
    auth: status.auth,
    quotaExhausted: status.quota?.exhausted ?? false,
    updateAvailable,
  };
}

async function togglePause(): Promise<void> {
  const paused = !nativeAutocompleteRuntime.isPaused();
  nativeAutocompleteRuntime.setPaused(paused);
  settingsWindowManager.sendPaused(paused);
  updateTray();
  if (paused) {
    clearContextAndHide();
  }
}

async function signOut(): Promise<void> {
  console.log("Signing out device:", DEVICE_ID);
  await authClient.clearToken();
  clearContextAndHide();
  await statusService.refresh();
  await refreshMemories();
  showSignedOutSurface();
}

async function signIn(): Promise<void> {
  console.log("Opening browser sign-in for device:", DEVICE_ID);
  await authClient.openBrowserLogin();
}

function showSignedOutSurface(): void {
  onboardingWindowManager.close();
  settingsWindowManager.show("sign-in");
}

function showAuthenticatedDesktopSurface(): void {
  if (onboardingManager.shouldShowOnboarding()) {
    settingsWindowManager.close();
    onboardingWindowManager.show();
    return;
  }

  onboardingWindowManager.close();
  settingsWindowManager.show();
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

  return {
    width: OVERLAY_WIDTH,
    height,
    x: x + Math.round((width - OVERLAY_WIDTH) / 2),
    y: y + workAreaHeight - height - OVERLAY_BOTTOM_MARGIN,
  };
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

function isBoundsOnScreen(bounds: Electron.Rectangle): boolean {
  return screen.getAllDisplays().some((display) => {
    const workArea = display.workArea;
    const overlapsX = bounds.x < workArea.x + workArea.width && bounds.x + bounds.width > workArea.x;
    const overlapsY = bounds.y < workArea.y + workArea.height && bounds.y + bounds.height > workArea.y;
    return overlapsX && overlapsY;
  });
}

function installOverlayPositionTracking(win: BrowserWindow, getBounds: () => Electron.Rectangle): void {
  const reposition = () => {
    if (win.isDestroyed()) return;
    const currentBounds = win.getBounds();
    if (!isBoundsOnScreen(currentBounds) || screen.getAllDisplays().length > 1) {
      win.setBounds(getBounds(), false);
    }
  };

  const interval = setInterval(reposition, OVERLAY_POSITION_CHECK_MS);
  const onDisplayChanged = () => reposition();
  screen.on("display-added", onDisplayChanged);
  screen.on("display-removed", onDisplayChanged);
  screen.on("display-metrics-changed", onDisplayChanged);
  win.on("closed", () => {
    clearInterval(interval);
    screen.off("display-added", onDisplayChanged);
    screen.off("display-removed", onDisplayChanged);
    screen.off("display-metrics-changed", onDisplayChanged);
  });
}

function installAlphaClickThrough(win: BrowserWindow): void {
  win.setIgnoreMouseEvents(true, { forward: true });

  let lastIgnoreState = true;
  let captureInFlight = false;
  const interval = setInterval(async () => {
    if (win.isDestroyed() || captureInFlight) return;

    const cursor = screen.getCursorScreenPoint();
    const bounds = win.getBounds();
    const inside =
      cursor.x >= bounds.x &&
      cursor.x < bounds.x + bounds.width &&
      cursor.y >= bounds.y &&
      cursor.y < bounds.y + bounds.height;

    if (!inside) {
      if (!lastIgnoreState) {
        win.setIgnoreMouseEvents(true, { forward: true });
        lastIgnoreState = true;
      }
      return;
    }

    captureInFlight = true;
    try {
      const image = await win.webContents.capturePage({
        x: Math.floor(cursor.x - bounds.x),
        y: Math.floor(cursor.y - bounds.y),
        width: 1,
        height: 1,
      });
      const bitmap = image.toBitmap();
      const alpha = bitmap.length >= 4 ? (bitmap[3] ?? 0) : 0;

      if (alpha > 0 && lastIgnoreState) {
        win.setIgnoreMouseEvents(false);
        lastIgnoreState = false;
      } else if (alpha === 0 && !lastIgnoreState) {
        win.setIgnoreMouseEvents(true, { forward: true });
        lastIgnoreState = true;
      }
    } catch {
      if (!lastIgnoreState) {
        win.setIgnoreMouseEvents(true, { forward: true });
        lastIgnoreState = true;
      }
    } finally {
      captureInFlight = false;
    }
  }, OVERLAY_HIT_TEST_MS);

  win.on("closed", () => clearInterval(interval));
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
    backgroundColor: "#00000000",
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  configureFloatingPanel(win);
  installOverlayPositionTracking(win, () => getSuggestionOverlayBounds(win.getBounds().height));
  installAlphaClickThrough(win);
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
    backgroundColor: "#00000000",
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

function showOverlay(suggestion: Suggestion): void {
  if (!overlayRendererReady || !isUsableWebContents(overlayWindow)) return;
  resizeOverlayWindow(OVERLAY_SUGGESTION_HEIGHT);
  overlayWindow.webContents.send("suggestion", suggestion);
  overlayWindow.showInactive();
}

function clearSuggestionOverlay(): void {
  if (!overlayRendererReady || !isUsableWebContents(overlayWindow)) return;
  overlayWindow.webContents.send("hide");
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

  const snapshot = nativeAutocompleteRuntime.getCurrentSnapshot();
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
  await nativeAutocompleteRuntime.acceptCurrentSuggestion();
}

async function requestSuggestionNow(): Promise<void> {
  await nativeAutocompleteRuntime.requestSuggestionNow();
}

function handleOptionKeyUp(): void {
  if (nativeAutocompleteRuntime.handleOptionKeyUp(DOUBLE_OPTION_PRESS_MS)) {
    requestSuggestionNow().catch((error) => {
      console.error("Failed to request suggestion from Option double press:", error);
    });
  }
}

function clearContextAndHide(): void {
  nativeAutocompleteRuntime.clearContext();
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
  updateChecker.checkForUpdates().catch((error) => {
    console.error(errorMessage, error);
  });
}

function handleInputTapMessage(message: unknown): void {
  desktopEventIngress.handleMessage(message);
}

function handleAppContextTree(accessibilityTree: AppContextAccessibilityTree): void {
  nativeAutocompleteRuntime.ingestAppContextTree(accessibilityTree);
}

function startMacOSInputTap(): void {
  if (process.platform !== "darwin") return;
  if (!existsSync(INPUT_TAP_PATH)) {
    console.error(`macOS input tap helper missing at ${INPUT_TAP_PATH}`);
    return;
  }

  const child = spawn(INPUT_TAP_PATH, [], { stdio: ["ignore", "pipe", "pipe"] }) as unknown as InputTapProcess;
  inputTapProcess = child;
  let stdoutBuffer = "";

  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString("utf8");
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim().length === 0) continue;
      try {
        handleInputTapMessage(JSON.parse(line));
      } catch (error) {
        console.error("Failed to parse macOS input tap message:", error);
      }
    }
  });

  child.stderr.on("data", (chunk) => {
    console.error("macOS input tap stderr:", chunk.toString("utf8"));
  });

  child.on("exit", (code, signal) => {
    if (inputTapProcess === child) {
      inputTapProcess = null;
    }
    console.error(`macOS input tap exited with code ${code ?? "null"} signal ${signal ?? "null"}`);
  });
}

async function bootstrap(): Promise<void> {
  // Onboarding should guide the user to grant Accessibility and Input Monitoring
  // permissions. Tab deliberately does not request Screen Recording or Full
  // Disk Access; those are out of scope for the MVP per ADR-0037.
  ipcMain.on("overlay-ready", (event) => {
    if (!isUsableWebContents(overlayWindow) || event.sender !== overlayWindow.webContents) return;

    overlayRendererReady = true;
    const currentSuggestion = nativeAutocompleteRuntime.getCurrentSuggestion();
    if (currentSuggestion) {
      showOverlay(currentSuggestion);
    }
  });

  overlayWindow = createOverlayWindow();
  debugOverlayWindow = SHOW_DEBUG_TYPING_OVERLAY ? createDebugOverlayWindow() : null;

  const registered = globalShortcut.register("Alt+Tab", () => {
    acceptCurrentSuggestion().catch((error) => {
      console.error("Failed to accept suggestion:", error);
    });
  });

  if (!registered) {
    console.error("Failed to register Option+Tab acceptance shortcut");
  }

  ipcMain.on("accept-suggestion", () => {
    acceptCurrentSuggestion().catch((error) => {
      console.error("Failed to accept suggestion via overlay click:", error);
    });
  });

  // Settings / status / quick memory IPC handlers. These keep the overlay
  // focused on suggestions; status and memory surfaces live in their own window
  // and tray menu.
  ipcMain.on("complete-onboarding", () => {
    onboardingManager.completeOnboarding();
    onboardingWindowManager.close();
    settingsWindowManager.show();
  });

  ipcMain.handle("open-accessibility-settings", async () => {
    if (process.platform !== "darwin") return false;

    relaunchAfterPermissionQuit = true;
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
      relaunchAfterPermissionQuit = true;
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

  ipcMain.on("toggle-pause", () => {
    togglePause().catch((error) => console.error("Failed to toggle pause:", error));
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

  ipcMain.handle("get-initial-state", () => ({
    status: statusService.getCurrentStatus(),
    memories: currentMemories,
    paused: nativeAutocompleteRuntime.isPaused(),
    preferences: preferencesManager.get(),
  }));

  // Register the custom URL scheme so the browser handoff can land back in the
  // native app (ADR-0007).
  if (process.platform === "darwin") {
    app.setAsDefaultProtocolClient("tab");
  }

  app.on("open-url", (event, url) => {
    if (url.startsWith("tab://")) {
      event.preventDefault();
      console.log("Received auth callback:", url);
      authClient
        .handleCallback(url)
        .then(async (token) => {
          console.log("Device token stored after browser handoff for device:", DEVICE_ID);
          await statusService.refresh();
          await refreshMemories();
          showAuthenticatedDesktopSurface();
        })
        .catch((error) => {
          console.error("Failed to complete browser handoff:", error);
        });
    }
  });

  // The local typing context buffer remains in process memory only and clears
  // on sleep/lock so sensitive context cannot sit around (ADR-0018).
  powerMonitor.on("suspend", clearContextAndHide);
  powerMonitor.on("lock-screen", clearContextAndHide);

  // Tray menu provides always-visible access to settings, quick memory, pause,
  // and sign-in/out without cluttering the overlay.
  tray = createTrayMenu({
    icon: TRAY_ICON_PATH,
    actions: {
      showSettings: () => {
        showInitialDesktopSurface().catch((error) => console.error("Failed to show settings from tray:", error));
      },
      showQuickMemory: () => {
        showInitialDesktopSurface().catch((error) => console.error("Failed to show quick memory from tray:", error));
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
      openDownloadPage: () => {
        shell.openExternal(`${WEB_BASE_URL}/download`).catch((error) => {
          console.error("Failed to open download page:", error);
        });
      },
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
  startMacOSInputTap();

  // Initial status and memory refresh.
  statusService.refresh().catch((error) => console.error("Failed initial status refresh:", error));
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
  inputTapProcess?.kill();
  memoryExtractionDispatcher.stop();
  typingContextBuffer.clear();
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
  nativeAutocompleteRuntime.appendText(text);
}

export function handlePastedText(text: string): void {
  nativeAutocompleteRuntime.appendPastedText(text);
}

export function handleDeleteBackward(unit: TypingDeletionUnit = "character"): void {
  nativeAutocompleteRuntime.deleteBackward(unit);
}

export function handleShortcutOrNavigation(): void {
  nativeAutocompleteRuntime.handleShortcutOrNavigation();
}

export function handleActiveApplicationChanged(bundleId: string | null, windowId: string | null = null): void {
  nativeAutocompleteRuntime.setActiveApplication(bundleId, windowId);
}

export function handleSecureInputChanged(active: boolean): void {
  nativeAutocompleteRuntime.setSecureInput(active);
}

export function handleTextSessionSnapshot(snapshot: TextSessionSnapshot): void {
  nativeAutocompleteRuntime.applyTextSessionSnapshot(snapshot);
}

export function handlePauseChanged(active: boolean): void {
  nativeAutocompleteRuntime.setPaused(active);
}

export function getCurrentSuggestionForTest(): Suggestion | null {
  return nativeAutocompleteRuntime.getCurrentSuggestion();
}
