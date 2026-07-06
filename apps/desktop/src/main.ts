import {
  app,
  BrowserWindow,
  globalShortcut,
  clipboard,
  ipcMain,
  screen,
  powerMonitor,
  shell,
} from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import { mkdirSync } from "node:fs";
import { promisify } from "node:util";
import { createTypingContextBuffer } from "./typing-context.ts";
import { createSuggestionLoop } from "./suggestion-loop.ts";
import { createApiSuggestionClient } from "./suggestion-client.ts";
import { acceptAndInsertSuggestion } from "./acceptance.ts";
import { createDesktopAuthClient } from "./auth.ts";
import { createMacOSKeychain } from "./keychain.ts";
import { createDesktopStatusService, type DesktopStatus } from "./status.ts";
import { createDesktopMemoryClient } from "./memory-client.ts";
import { createOnboardingManager } from "./onboarding.ts";
import { createOnboardingWindowManager } from "./onboarding-window.ts";
import { createSettingsWindowManager } from "./settings-window.ts";
import { createTrayMenu, type TabbTray } from "./tray-menu.ts";
import { createPreferencesManager, createFilePreferencesStorage } from "./preferences.ts";
import type { Suggestion, ActiveApplication, SuggestionContextSource, PersonalMemory } from "@tabb/contracts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execAsync = promisify(exec);

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
  htmlPath: path.join(__dirname, "onboarding.html"),
});

const settingsWindowManager = createSettingsWindowManager({
  htmlPath: path.join(__dirname, "settings.html"),
});

const API_BASE_URL = process.env.TABB_API_BASE_URL ?? "http://localhost:8787";
const WEB_BASE_URL = process.env.TABB_WEB_BASE_URL ?? "http://localhost:3000";
const DEVICE_ID = process.env.TABB_DEVICE_ID ?? "device-unknown";

const authClient = createDesktopAuthClient({
  apiBaseUrl: API_BASE_URL,
  webBaseUrl: WEB_BASE_URL,
  deviceId: DEVICE_ID,
  appVersion: app.getVersion() || "0.0.0",
  platform: process.platform,
  keychain: createMacOSKeychain(),
  openExternal: async (url) => {
    await shell.openExternal(url);
  },
});

const requestSuggestion = createApiSuggestionClient({
  apiBaseUrl: API_BASE_URL,
  deviceId: DEVICE_ID,
  appVersion: app.getVersion() || "0.0.0",
  platform: process.platform,
  getState: () => typingContextBuffer.getState(),
  getAuthorizationHeader: () => authClient.getAuthorizationHeader(),
});

const memoryClient = createDesktopMemoryClient({
  apiBaseUrl: API_BASE_URL,
  getAuthorizationHeader: () => authClient.getAuthorizationHeader(),
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

async function refreshMemories(): Promise<void> {
  const memories = await memoryClient.listMemories();
  currentMemories = memories;
  settingsWindowManager.sendMemories(memories);
}

function updateTrayFromStatus(status: DesktopStatus): void {
  tray?.update(createTrayState(status));
}

function updateTrayFromPause(): void {
  tray?.update(createTrayState(statusService.getCurrentStatus()));
}

function createTrayState(status: DesktopStatus) {
  return {
    paused: observationPaused,
    auth: status.auth,
    quotaExhausted: status.quota?.exhausted ?? false,
  };
}

async function togglePause(): Promise<void> {
  observationPaused = !observationPaused;
  typingContextBuffer.setPaused(observationPaused);
  settingsWindowManager.sendPaused(observationPaused);
  updateTrayFromPause();
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
      preload: path.join(__dirname, "preload.js"),
    },
  });

  win.loadFile(path.join(__dirname, "index.html"));
  win.setIgnoreMouseEvents(false);
  return win;
}

function showOverlay(suggestion: Suggestion): void {
  currentSuggestion = suggestion;
  if (!overlayWindow) return;
  overlayWindow.webContents.send("suggestion", suggestion);
  overlayWindow.showInactive();
}

function hideOverlay(): void {
  currentSuggestion = null;
  if (!overlayWindow) return;
  overlayWindow.hide();
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
  suggestionLoop?.invalidate();
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
    icon: path.join(__dirname, "../assets/iconTemplate.png"),
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
      quit: () => app.quit(),
    },
  });

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
  }

  // Input monitoring and active-application tracking are wired to the same
  // in-memory buffer. In a production build these are fed by a macOS native
  // input tap (IOKit/Quartz Event Services) and an active-app observer.
  handleActiveApplicationChanged("com.apple.TextEdit");

  // Initial status and memory refresh.
  statusService.refresh().catch((error) => console.error("Failed initial status refresh:", error));
  refreshMemories().catch((error) => console.error("Failed initial memory refresh:", error));
}

app.whenReady().then(bootstrap).catch((error) => {
  console.error("Failed to bootstrap desktop app:", error);
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  typingContextBuffer.clear();
});

app.on("window-all-closed", () => {
  // The overlay is a child window; on macOS the app stays alive until quit.
  // Do not call app.quit() here so Tabb keeps running in the background.
});

// Exposed for the native input bridge and for tests.
export function handleTextInput(text: string): void {
  if (observationPaused) return;
  typingContextBuffer.appendText(text, getTypedContextSource());
  suggestionLoop?.onContextChanged();
}

export function handlePastedText(text: string): void {
  if (observationPaused) return;
  typingContextBuffer.appendPastedText(text);
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
  suggestionLoop?.onContextChanged();
}

export function handleSecureInputChanged(active: boolean): void {
  typingContextBuffer.setSecureInput(active);
  suggestionLoop?.onContextChanged();
}

export function handlePauseChanged(active: boolean): void {
  observationPaused = active;
  typingContextBuffer.setPaused(active);
  if (active) {
    clearContextAndHide();
  }
}

export function getCurrentSuggestionForTest(): Suggestion | null {
  return currentSuggestion;
}
