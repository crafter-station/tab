import { BrowserWindow } from "electron";
import type { DesktopStatus } from "./status.ts";
import type { PersonalMemory } from "@tabb/contracts";

export type ControlWindowRoute = "settings" | "onboarding" | "sign-in";

export type CreateSettingsWindowDependencies = {
  rendererPath: string;
  preloadPath: string;
};

export function createSettingsWindow(deps: CreateSettingsWindowDependencies, route: ControlWindowRoute = "settings"): BrowserWindow {
  const win = new BrowserWindow({
    width: 760,
    height: 780,
    resizable: true,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: "Tabb Settings",
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

  return {
    show,
    close,
    isOpen: () => win !== null && !win.isDestroyed(),
    sendStatus,
    sendMemories,
    sendPaused,
  };
}
