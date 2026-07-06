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
import { createTypingContextBuffer, getLastWords } from "./typing-context.ts";
import { createSuggestionLoop } from "./suggestion-loop.ts";
import { createApiSuggestionClient } from "./suggestion-client.ts";
import { acceptAndInsertSuggestion } from "./acceptance.ts";
import { createDesktopAuthClient } from "./auth.ts";
import { createMacOSKeychain } from "./keychain.ts";
import { createDesktopStatusService, type DesktopStatus } from "./status.ts";
import { createDesktopMemoryClient } from "./memory-client.ts";
import { MACOS_PERMISSION_SETTINGS_URLS, createOnboardingManager, getMacOSAppBundlePath } from "./onboarding.ts";
import { createOnboardingWindowManager } from "./onboarding-window.ts";
import { createSettingsWindowManager } from "./settings-window.ts";
import { createTrayMenu, type TabbTray } from "./tray-menu.ts";
import { createPreferencesManager, createFilePreferencesStorage } from "./preferences.ts";
import { createUpdateChecker } from "./release.ts";
import type { Suggestion, ActiveApplication, SuggestionContextSource, PersonalMemory } from "@tabb/contracts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execAsync = promisify(exec);
const runtimeRoot = app.isPackaged ? path.join(app.getAppPath(), "dist") : __dirname;
const PRELOAD_PATH = process.env.TABB_PRELOAD_PATH ?? path.join(runtimeRoot, "preload.cjs");
const TRAY_ICON_PATH = process.env.TABB_TRAY_ICON_PATH ?? path.join(runtimeRoot, "assets", "iconTemplate.png");
const packagedInputTapPath = path.join(process.resourcesPath, "app.asar.unpacked", "dist", "macos-input-tap");
const INPUT_TAP_PATH = process.env.TABB_INPUT_TAP_PATH ?? (app.isPackaged ? packagedInputTapPath : path.join(runtimeRoot, "macos-input-tap"));

const TERMINAL_BUNDLE_IDS = new Set([
  "com.apple.Terminal",
  "com.googlecode.iterm2",
  "com.mitchellh.ghostty",
  "net.kovidgoyal.kitty",
  "com.microsoft.WindowsTerminal",
  "dev.tabby",
]);

let overlayWindow: BrowserWindow | null = null;
let suggestionLoop: ReturnType<typeof createSuggestionLoop> | null = null;
let currentSuggestion: Suggestion | null = null;
let previouslyActiveApplication: ActiveApplication | null = null;
let observationPaused = false;
let tray: TabbTray | null = null;
let relaunchAfterPermissionQuit = false;
type InputTapProcess = {
  stdout: { on(event: "data", callback: (chunk: Buffer) => void): void };
  stderr: { on(event: "data", callback: (chunk: Buffer) => void): void };
  on(event: "exit", callback: (code: number | null, signal: string | null) => void): void;
  kill(): boolean;
};

let inputTapProcess: InputTapProcess | null = null;

const typingContextBuffer = createTypingContextBuffer();

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
  htmlPath: path.join(runtimeRoot, "onboarding.html"),
  preloadPath: PRELOAD_PATH,
});

const settingsWindowManager = createSettingsWindowManager({
  htmlPath: path.join(runtimeRoot, "settings.html"),
  preloadPath: PRELOAD_PATH,
});

const API_BASE_URL = process.env.TABB_API_BASE_URL ?? "http://localhost:8787";
const WEB_BASE_URL = process.env.TABB_WEB_BASE_URL ?? "http://localhost:3000";
const DEVICE_ID = process.env.TABB_DEVICE_ID ?? "device-unknown";
const APP_VERSION = app.getVersion() || "0.0.0";
const SHOW_SETTINGS_ON_START = process.argv.includes("--permission-debug") || process.env.TABB_SHOW_SETTINGS_ON_START === "1";
const SHOW_DEBUG_TYPING_OVERLAY =
  process.env.TABB_DEBUG_TYPING_OVERLAY !== "0" &&
  (!app.isPackaged || process.env.TABB_DEBUG_TYPING_OVERLAY === "1" || process.argv.includes("--typing-debug") || SHOW_SETTINGS_ON_START);
const DEBUG_TYPING_DEBOUNCE_MS = 300;
const DEBUG_TYPING_HIDE_MS = 3_600;
const DEBUG_TYPING_WORD_LIMIT = 100;

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
  getState: () => typingContextBuffer.getState(),
  getAuthorizationHeader: () => authClient.getAuthorizationHeader(),
});

const memoryClient = createDesktopMemoryClient({
  apiBaseUrl: API_BASE_URL,
  getAuthorizationHeader: () => authClient.getAuthorizationHeader(),
});

let updateAvailable = false;

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
    updateTrayFromStatus(status);
    if (status.auth === "revoked_device" || status.auth === "sign_in_required") {
      // If a token is stored but the API reports revoked or unauthenticated,
      // clear it so the user is prompted to sign in again. The initial
      // sign_in_required state has no stored token, so isAuthenticated guards
      // against clearing an already-empty keychain.
      authClient
        .isAuthenticated()
        .then((authenticated) => {
          if (authenticated) {
            return authClient.clearToken();
          }
        })
        .catch((error) => {
          console.error("Failed to clear invalid device token:", error);
        });
    }
  },
});

let currentMemories: PersonalMemory[] = [];
let debugTypingTimer: ReturnType<typeof setTimeout> | null = null;
let debugTypingHideTimer: ReturnType<typeof setTimeout> | null = null;

async function refreshMemories(): Promise<void> {
  const memories = await memoryClient.listMemories();
  currentMemories = memories;
  settingsWindowManager.sendMemories(memories);
}

function updateTrayFromStatus(status: DesktopStatus): void {
  tray?.update(createTrayState(status));
}

function updateTray(): void {
  tray?.update(createTrayState(statusService.getCurrentStatus()));
}

function createTrayState(status: DesktopStatus) {
  return {
    paused: observationPaused,
    auth: status.auth,
    quotaExhausted: status.quota?.exhausted ?? false,
    updateAvailable,
  };
}

async function togglePause(): Promise<void> {
  observationPaused = !observationPaused;
  typingContextBuffer.setPaused(observationPaused);
  settingsWindowManager.sendPaused(observationPaused);
  updateTray();
  if (observationPaused) {
    clearContextAndHide();
  }
}

async function signOut(): Promise<void> {
  await authClient.clearToken();
  clearContextAndHide();
  await statusService.refresh();
  await refreshMemories();
}

async function signIn(): Promise<void> {
  await authClient.openBrowserLogin();
}

function isTerminalApplication(bundleId: string | null | undefined): boolean {
  if (!bundleId) return false;
  return TERMINAL_BUNDLE_IDS.has(bundleId);
}

function getTypedContextSource(): SuggestionContextSource {
  const bundleId = typingContextBuffer.getState().activeApplication?.bundleId;
  if (isTerminalApplication(bundleId)) return "terminal_input";
  return "typed_text";
}

function createOverlayWindow(): BrowserWindow {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  const win = new BrowserWindow({
    width: 640,
    height: 52,
    x: Math.round(width / 2 - 320),
    y: height - 72,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: PRELOAD_PATH,
    },
  });

  win.loadFile(path.join(runtimeRoot, "index.html"));
  win.setIgnoreMouseEvents(false);
  return win;
}

function resizeOverlayWindow(height: number): void {
  if (!overlayWindow) return;
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height: workAreaHeight } = primaryDisplay.workAreaSize;
  const overlayWidth = height > 80 ? 720 : 640;
  overlayWindow.setBounds({
    width: overlayWidth,
    height,
    x: Math.round(width / 2 - overlayWidth / 2),
    y: workAreaHeight - height - 20,
  });
}

function showOverlay(suggestion: Suggestion): void {
  currentSuggestion = suggestion;
  if (!overlayWindow) return;
  if (debugTypingTimer) {
    clearTimeout(debugTypingTimer);
    debugTypingTimer = null;
  }
  if (debugTypingHideTimer) {
    clearTimeout(debugTypingHideTimer);
    debugTypingHideTimer = null;
  }
  resizeOverlayWindow(52);
  overlayWindow.webContents.send("suggestion", suggestion);
  overlayWindow.showInactive();
}

function hideOverlay(): void {
  currentSuggestion = null;
  if (!overlayWindow) return;
  if (SHOW_DEBUG_TYPING_OVERLAY && typingContextBuffer.getState().context.length > 0) {
    showDebugTypingOverlay();
    return;
  }
  if (debugTypingTimer) {
    clearTimeout(debugTypingTimer);
    debugTypingTimer = null;
  }
  if (debugTypingHideTimer) {
    clearTimeout(debugTypingHideTimer);
    debugTypingHideTimer = null;
  }
  overlayWindow.hide();
}

function sendDebugContext(): void {
  if (!SHOW_DEBUG_TYPING_OVERLAY || !overlayWindow) return;

  const state = typingContextBuffer.getState();
  const context = getLastWords(state.context, DEBUG_TYPING_WORD_LIMIT);
  overlayWindow.webContents.send("debug-context", {
    context,
    wordLimit: DEBUG_TYPING_WORD_LIMIT,
    wordCount: context.length === 0 ? 0 : context.split(/\s+/).length,
    source: state.contextSource,
    app: state.activeApplication?.bundleId ?? null,
    paused: state.paused,
    secureInput: state.secureInput,
  });
}

function showDebugTypingOverlay(): void {
  if (!SHOW_DEBUG_TYPING_OVERLAY || !overlayWindow || currentSuggestion) return;
  if (typingContextBuffer.getState().context.length === 0) {
    overlayWindow.hide();
    return;
  }

  if (debugTypingTimer) {
    clearTimeout(debugTypingTimer);
  }
  if (debugTypingHideTimer) {
    clearTimeout(debugTypingHideTimer);
    debugTypingHideTimer = null;
  }
  debugTypingTimer = setTimeout(() => {
    debugTypingTimer = null;
    if (!SHOW_DEBUG_TYPING_OVERLAY || !overlayWindow || currentSuggestion) return;

    resizeOverlayWindow(184);
    sendDebugContext();
    overlayWindow.showInactive();
    debugTypingHideTimer = setTimeout(() => {
      debugTypingHideTimer = null;
      if (!overlayWindow || currentSuggestion) return;
      overlayWindow.hide();
    }, DEBUG_TYPING_HIDE_MS);
  }, DEBUG_TYPING_DEBOUNCE_MS);
}

async function acceptCurrentSuggestion(): Promise<void> {
  if (!suggestionLoop) return;

  const result = await acceptAndInsertSuggestion({
    getCurrentSuggestion: () => currentSuggestion,
    getPreviouslyActiveApplication: () => previouslyActiveApplication,
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
    restoreClipboard: async (previous) => {
      clipboard.writeText(previous);
    },
  });

  if (result === "inserted") {
    hideOverlay();
    typingContextBuffer.clear();
  }
}

function clearContextAndHide(): void {
  typingContextBuffer.clear();
  if (debugTypingTimer) {
    clearTimeout(debugTypingTimer);
    debugTypingTimer = null;
  }
  if (debugTypingHideTimer) {
    clearTimeout(debugTypingHideTimer);
    debugTypingHideTimer = null;
  }
  suggestionLoop?.invalidate();
}

function checkForUpdates(errorMessage: string): void {
  updateChecker.checkForUpdates().catch((error) => {
    console.error(errorMessage, error);
  });
}

function handleInputTapMessage(message: unknown): void {
  if (!message || typeof message !== "object") return;
  const payload = message as { type?: unknown; text?: unknown; bundleId?: unknown; message?: unknown };

  if (payload.type === "ready") {
    console.log("macOS input tap ready.");
    return;
  }
  if (payload.type === "error") {
    console.error("macOS input tap error:", payload.message);
    return;
  }
  if (payload.type === "active-app" && typeof payload.bundleId === "string") {
    handleActiveApplicationChanged(payload.bundleId);
    return;
  }
  if (payload.type === "text" && typeof payload.text === "string") {
    handleTextInput(payload.text);
  }
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
  // permissions. Tabb deliberately does not request Screen Recording or Full
  // Disk Access; those are out of scope for the MVP per ADR-0037.
  overlayWindow = createOverlayWindow();

  suggestionLoop = createSuggestionLoop({
    getContext: () => typingContextBuffer.getState(),
    requestSuggestion,
    onShowSuggestion: showOverlay,
    onHideSuggestion: hideOverlay,
    onSecretLikeContextDetected: () => {
      // Clear the in-memory buffer as soon as secret-like context is detected,
      // before any network call can happen.
      typingContextBuffer.clear();
    },
    debounceMs: 300,
  });

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

  ipcMain.handle("get-initial-state", () => ({
    status: statusService.getCurrentStatus(),
    memories: currentMemories,
    paused: observationPaused,
  }));

  // Register the custom URL scheme so the browser handoff can land back in the
  // native app (ADR-0007).
  if (process.platform === "darwin") {
    app.setAsDefaultProtocolClient("tabb");
  }

  app.on("open-url", (event, url) => {
    if (url.startsWith("tabb://")) {
      event.preventDefault();
      authClient
        .handleCallback(url)
        .then(async () => {
          console.log("Device token stored after browser handoff.");
          await statusService.refresh();
          await refreshMemories();
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
      showSettings: () => settingsWindowManager.show(),
      showQuickMemory: () => settingsWindowManager.show(),
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
  if (onboardingManager.shouldShowOnboarding()) {
    onboardingWindowManager.show();
  } else if (SHOW_SETTINGS_ON_START) {
    settingsWindowManager.show();
  }

  // Input monitoring and active-application tracking are wired to the same
  // in-memory buffer. In a production build these are fed by a macOS native
  // input tap (IOKit/Quartz Event Services) and an active-app observer.
  handleActiveApplicationChanged("com.apple.TextEdit");
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
  inputTapProcess?.kill();
  typingContextBuffer.clear();
});

app.on("window-all-closed", () => {
  // The overlay is a child window; on macOS the app stays alive until quit.
  // Do not call app.quit() here so Tabb keeps running in the background.
});

app.on("activate", () => {
  settingsWindowManager.show();
});

// Exposed for the native input bridge and for tests.
export function handleTextInput(text: string): void {
  if (observationPaused) return;
  typingContextBuffer.appendText(text, getTypedContextSource());
  showDebugTypingOverlay();
  suggestionLoop?.onContextChanged();
}

export function handlePastedText(text: string): void {
  if (observationPaused) return;
  typingContextBuffer.appendPastedText(text);
  showDebugTypingOverlay();
  suggestionLoop?.onContextChanged();
}

export function handleShortcutOrNavigation(): void {
  // Shortcuts and navigation keys do not become typing context.
}

export function handleActiveApplicationChanged(bundleId: string | null): void {
  if (observationPaused) return;

  const activeApp = bundleId ? { bundleId } : null;

  // Do not treat Tabb's own windows as the previously active application,
  // otherwise clicking the overlay would paste back into Tabb.
  const isTabb = bundleId?.toLowerCase().includes("tabb") ?? false;
  if (activeApp && !isTabb) {
    previouslyActiveApplication = activeApp;
  }

  typingContextBuffer.setActiveApplication(activeApp);
  showDebugTypingOverlay();
  suggestionLoop?.onContextChanged();
}

export function handleSecureInputChanged(active: boolean): void {
  typingContextBuffer.setSecureInput(active);
  showDebugTypingOverlay();
  suggestionLoop?.onContextChanged();
}

export function handlePauseChanged(active: boolean): void {
  observationPaused = active;
  typingContextBuffer.setPaused(active);
  if (active) {
    clearContextAndHide();
  }
  showDebugTypingOverlay();
}

export function getCurrentSuggestionForTest(): Suggestion | null {
  return currentSuggestion;
}
