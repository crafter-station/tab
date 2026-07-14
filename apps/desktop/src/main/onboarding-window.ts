import { BrowserWindow, nativeTheme, screen } from "electron";
import { PLATFORM_COLORS } from "@tab/ui/platform-colors";
import type { DesktopStatus } from "./status.ts";
import type { LocalInferenceStatus } from "./local-inference-prototype.ts";

export type CreateOnboardingWindowDependencies = {
  rendererPath: string;
  preloadPath: string;
};

export function createOnboardingWindow(deps: CreateOnboardingWindowDependencies): BrowserWindow {
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(760, workArea.width - 32);
  const height = Math.min(760, workArea.height - 32);
  const win = new BrowserWindow({
    width,
    height,
    minWidth: Math.min(600, width),
    minHeight: Math.min(600, height),
    useContentSize: true,
    center: true,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: "Welcome to Tab",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: PLATFORM_COLORS.theme[nativeTheme.shouldUseDarkColors ? "dark" : "light"].canvas,
    webPreferences: {
      preload: deps.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(deps.rendererPath, { hash: "onboarding" });
  win.once("ready-to-show", () => win?.show());

  return win;
}

export type OnboardingWindowManagerDependencies = {
  rendererPath: string;
  preloadPath: string;
};

export function createOnboardingWindowManager(deps: OnboardingWindowManagerDependencies) {
  let win: BrowserWindow | null = null;

  function show(): BrowserWindow {
    if (win && !win.isDestroyed()) {
      win.focus();
      return win;
    }

    win = createOnboardingWindow({
      rendererPath: deps.rendererPath,
      preloadPath: deps.preloadPath,
    });

    win.on("closed", () => {
      win = null;
    });

    return win;
  }

  function close(): void {
    if (win && !win.isDestroyed()) {
      win.close();
    }
    win = null;
  }

  function sendStatus(status: DesktopStatus): void {
    if (win && !win.isDestroyed()) {
      win.webContents.send("status-changed", status);
    }
  }

  function sendLocalInferenceStatus(status: LocalInferenceStatus): void {
    if (win && !win.isDestroyed()) {
      win.webContents.send("local-inference-status-changed", status);
    }
  }

  function sendOptionTab(): void {
    if (win && !win.isDestroyed()) {
      win.webContents.send("onboarding-option-tab");
    }
  }

  return {
    show,
    close,
    isOpen: () => win !== null && !win.isDestroyed(),
    isFocused: () => win?.isFocused() ?? false,
    sendStatus,
    sendLocalInferenceStatus,
    sendOptionTab,
  };
}
