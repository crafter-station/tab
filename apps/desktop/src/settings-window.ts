import { BrowserWindow } from "electron";
import path from "node:path";
import type { DesktopStatus } from "./status.ts";
import type { PersonalMemory } from "@tabb/contracts";

export type CreateSettingsWindowDependencies = {
  htmlPath: string;
};

export function createSettingsWindow(deps: CreateSettingsWindowDependencies): BrowserWindow {
  const win = new BrowserWindow({
    width: 600,
    height: 720,
    resizable: true,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: "Tabb Settings",
    webPreferences: {
      preload: path.join(path.dirname(deps.htmlPath), "preload.js"),
    },
  });

  win.loadFile(deps.htmlPath);
  win.once("ready-to-show", () => win?.show());

  return win;
}

export type SettingsWindowManagerDependencies = {
  htmlPath: string;
};

export function createSettingsWindowManager(deps: SettingsWindowManagerDependencies) {
  let win: BrowserWindow | null = null;

  function show(): BrowserWindow {
    if (win && !win.isDestroyed()) {
      win.focus();
      return win;
    }

    win = createSettingsWindow({ htmlPath: deps.htmlPath });

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
