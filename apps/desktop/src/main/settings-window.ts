import { BrowserWindow } from "electron";
import type { DesktopStatus } from "./status.ts";
import type { PersonalMemory } from "@tab/contracts";
import type { DesktopPreferences } from "./preferences.ts";

export type ControlWindowRoute = "settings" | "onboarding" | "sign-in";

export type CreateSettingsWindowDependencies = {
  rendererPath: string;
  preloadPath: string;
};

const controlWindowSizes = {
  settings: { width: 940, height: 720, minWidth: 840, minHeight: 640 },
  "sign-in": { width: 900, height: 620, minWidth: 840, minHeight: 580 },
  onboarding: { width: 760, height: 760, minWidth: 720, minHeight: 720 },
} satisfies Record<ControlWindowRoute, { width: number; height: number; minWidth: number; minHeight: number }>;

function applyControlWindowSize(win: BrowserWindow, route: ControlWindowRoute): void {
  const size = controlWindowSizes[route];
  win.setMinimumSize(size.minWidth, size.minHeight);
  win.setSize(size.width, size.height);
  win.center();
}

export function createSettingsWindow(deps: CreateSettingsWindowDependencies, route: ControlWindowRoute = "settings"): BrowserWindow {
  const size = controlWindowSizes[route];
  const win = new BrowserWindow({
    width: size.width,
    height: size.height,
    minWidth: size.minWidth,
    minHeight: size.minHeight,
    useContentSize: true,
    center: true,
    resizable: true,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: "Tab Settings",
    backgroundColor: "#11110f",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : undefined,
    trafficLightPosition: process.platform === "darwin" ? { x: 18, y: 18 } : undefined,
    webPreferences: {
      preload: deps.preloadPath,
    },
  });

  win.loadFile(deps.rendererPath, { hash: route });
  win.once("ready-to-show", () => win?.show());

  return win;
}

export type SettingsWindowManagerDependencies = {
  rendererPath: string;
  preloadPath: string;
};

export function createSettingsWindowManager(deps: SettingsWindowManagerDependencies) {
  let win: BrowserWindow | null = null;

  function show(route: ControlWindowRoute = "settings"): BrowserWindow {
    if (win && !win.isDestroyed()) {
      applyControlWindowSize(win, route);
      if (win.webContents.getURL() && !win.webContents.getURL().endsWith(`#${route}`)) {
        win.loadFile(deps.rendererPath, { hash: route });
      }
      win.focus();
      return win;
    }

    win = createSettingsWindow({ rendererPath: deps.rendererPath, preloadPath: deps.preloadPath }, route);

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

  function sendMemories(memories: PersonalMemory[]): void {
    if (win && !win.isDestroyed()) {
      win.webContents.send("memories-changed", memories);
    }
  }

  function sendPaused(paused: boolean): void {
    if (win && !win.isDestroyed()) {
      win.webContents.send("pause-changed", paused);
    }
  }

  function sendPreferences(preferences: DesktopPreferences): void {
    if (win && !win.isDestroyed()) {
      win.webContents.send("preferences-changed", preferences);
    }
  }

  return {
    show,
    close,
    isOpen: () => win !== null && !win.isDestroyed(),
    sendStatus,
    sendMemories,
    sendPaused,
    sendPreferences,
  };
}
