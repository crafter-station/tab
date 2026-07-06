import { app, BrowserWindow, globalShortcut, clipboard, ipcMain, screen } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import process from "node:process";
import { createTypingContextBuffer } from "./typing-context.ts";
import { createSuggestionLoop } from "./suggestion-loop.ts";
import { generateFakeSuggestion } from "./suggestion-engine.ts";
import { acceptAndInsertSuggestion } from "./acceptance.ts";
import type { Suggestion, ActiveApplication } from "@tabb/contracts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execAsync = promisify(exec);

let overlayWindow: BrowserWindow | null = null;
let suggestionLoop: ReturnType<typeof createSuggestionLoop> | null = null;
let currentSuggestion: Suggestion | null = null;
let previouslyActiveApplication: ActiveApplication | null = null;

const typingContextBuffer = createTypingContextBuffer();

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

async function bootstrap(): Promise<void> {
  // Onboarding should guide the user to grant Accessibility and Input Monitoring
  // permissions. Tabb deliberately does not request Screen Recording or Full
  // Disk Access; those are out of scope for the MVP per ADR-0037.
  overlayWindow = createOverlayWindow();

  suggestionLoop = createSuggestionLoop({
    getContext: () => typingContextBuffer.getState(),
    requestSuggestion: async (context) => generateFakeSuggestion(context),
    onShowSuggestion: showOverlay,
    onHideSuggestion: hideOverlay,
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

  // Input monitoring and active-application tracking are wired to the same
  // in-memory buffer. In a production build these are fed by a macOS native
  // input tap (IOKit/Quartz Event Services) and an active-app observer.
  handleActiveApplicationChanged("com.apple.TextEdit");
}

app.whenReady().then(bootstrap).catch((error) => {
  console.error("Failed to bootstrap desktop app:", error);
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  // The overlay is a child window; on macOS the app stays alive until quit.
  // Do not call app.quit() here so Tabb keeps running in the background.
});

// Exposed for the native input bridge and for tests.
export function handleTextInput(text: string): void {
  typingContextBuffer.appendText(text);
  suggestionLoop?.onContextChanged();
}

export function handlePastedText(text: string): void {
  typingContextBuffer.appendText(text);
  suggestionLoop?.onContextChanged();
}

export function handleTerminalInput(text: string): void {
  typingContextBuffer.appendText(text);
  suggestionLoop?.onContextChanged();
}

export function handleShortcutOrNavigation(): void {
  // Shortcuts and navigation keys do not become typing context.
}

export function handleActiveApplicationChanged(bundleId: string | null): void {
  const app = bundleId ? { bundleId } : null;

  // Do not treat Tabb's own windows as the previously active application,
  // otherwise clicking the overlay would paste back into Tabb.
  const isTabb = bundleId?.toLowerCase().includes("tabb") ?? false;
  if (app && !isTabb) {
    previouslyActiveApplication = app;
  }

  typingContextBuffer.setActiveApplication(app);
}

export function handleSecureInputChanged(active: boolean): void {
  typingContextBuffer.setSecureInput(active);
  suggestionLoop?.onContextChanged();
}

export function getCurrentSuggestionForTest(): Suggestion | null {
  return currentSuggestion;
}
