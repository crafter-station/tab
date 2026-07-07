import { BrowserWindow } from "electron";
import type { DesktopStatus } from "./status.ts";

export type CreateOnboardingWindowDependencies = {
  rendererPath: string;
  preloadPath: string;
};

export function createOnboardingWindow(deps: CreateOnboardingWindowDependencies): BrowserWindow {
  const win = new BrowserWindow({
    width: 760,
    height: 760,
    minWidth: 720,
    minHeight: 720,
    useContentSize: true,
    center: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: "Welcome to Tabb",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: "#11110f",
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

  return {
    show,
    close,
    isOpen: () => win !== null && !win.isDestroyed(),
    sendStatus,
  };
}
