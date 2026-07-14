import { BrowserWindow, nativeTheme, screen, type WebFrameMain } from "electron";
import { pathToFileURL } from "node:url";
import { PLATFORM_COLORS } from "@tab/ui/platform-colors";
import type { DesktopStatus } from "./status.ts";
import type { PersonalMemory } from "@tab/contracts";
import type { DesktopPreferences } from "./preferences.ts";
import type { LocalInferenceStatus, LocalModelCatalogState } from "@tab/contracts";
import type { CompletionHistoryEntry } from "./completion-history.ts";
import type { DesktopUpdateState } from "./release.ts";

export type ControlWindowRoute = "settings" | "onboarding" | "sign-in";

export type CreateControlWindowDependencies = {
  rendererPath: string;
  preloadPath: string;
};

function getControlWindowSize(route: ControlWindowRoute) {
  if (route === "onboarding") {
    const workArea = screen.getPrimaryDisplay().workAreaSize;
    const width = Math.min(760, workArea.width - 32);
    const height = Math.min(760, workArea.height - 32);
    return {
      width,
      height,
      minWidth: Math.min(600, width),
      minHeight: Math.min(600, height),
    };
  }

  return controlWindowSizes[route];
}

const controlWindowSizes = {
  settings: { width: 940, height: 720, minWidth: 840, minHeight: 640 },
  "sign-in": { width: 900, height: 620, minWidth: 840, minHeight: 580 },
} satisfies Record<Exclude<ControlWindowRoute, "onboarding">, { width: number; height: number; minWidth: number; minHeight: number }>;

const controlWindowTitles: Record<ControlWindowRoute, string> = {
  settings: "Tab Settings",
  "sign-in": "Sign in to Tab",
  onboarding: "Welcome to Tab",
};

function applyControlWindowSize(win: BrowserWindow, route: ControlWindowRoute): void {
  const size = getControlWindowSize(route);
  win.setMinimumSize(size.minWidth, size.minHeight);
  win.setSize(size.width, size.height);
  win.setTitle(controlWindowTitles[route]);
  win.setMinimizable(route !== "onboarding");
}

export function createControlWindow(deps: CreateControlWindowDependencies, route: ControlWindowRoute = "settings"): BrowserWindow {
  const size = getControlWindowSize(route);
  const isOnboarding = route === "onboarding";
  const win = new BrowserWindow({
    width: size.width,
    height: size.height,
    minWidth: size.minWidth,
    minHeight: size.minHeight,
    useContentSize: true,
    center: true,
    resizable: true,
    minimizable: !isOnboarding,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: controlWindowTitles[route],
    backgroundColor: PLATFORM_COLORS.theme[nativeTheme.shouldUseDarkColors ? "dark" : "light"].canvas,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : undefined,
    trafficLightPosition: process.platform === "darwin" ? { x: isOnboarding ? 16 : 18, y: isOnboarding ? 16 : 18 } : undefined,
    webPreferences: {
      preload: deps.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(deps.rendererPath, { hash: route });
  win.once("ready-to-show", () => win?.show());

  return win;
}

export type ControlWindowManagerDependencies = {
  rendererPath: string;
  preloadPath: string;
};

export function createControlWindowManager(deps: ControlWindowManagerDependencies) {
  let win: BrowserWindow | null = null;
  let currentRoute: ControlWindowRoute | null = null;

  function show(route: ControlWindowRoute = "settings"): BrowserWindow {
    if (win && !win.isDestroyed()) {
      const routeChanged = currentRoute !== route;
      if (routeChanged && (currentRoute === "onboarding" || route === "onboarding")) {
        close();
        return show(route);
      }
      if (routeChanged) {
        applyControlWindowSize(win, route);
        win.loadFile(deps.rendererPath, { hash: route });
        currentRoute = route;
      }
      win.focus();
      return win;
    }

    const createdWindow = createControlWindow({ rendererPath: deps.rendererPath, preloadPath: deps.preloadPath }, route);
    win = createdWindow;
    currentRoute = route;

    createdWindow.on("closed", () => {
      if (win !== createdWindow) return;
      win = null;
      currentRoute = null;
    });

    return createdWindow;
  }

  function close(): void {
    if (win && !win.isDestroyed()) {
      win.close();
    }
    win = null;
    currentRoute = null;
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

  function sendLocalInferenceStatus(status: LocalInferenceStatus): void {
    if (win && !win.isDestroyed()) {
      win.webContents.send("local-inference-status-changed", status);
    }
  }

  function sendLocalModelCatalog(catalog: LocalModelCatalogState): void {
    if (win && !win.isDestroyed()) {
      win.webContents.send("local-model-catalog-changed", catalog);
    }
  }

  function sendCompletionHistory(entries: readonly CompletionHistoryEntry[]): void {
    if (win && !win.isDestroyed()) {
      win.webContents.send("completion-history-changed", entries);
    }
  }

  function sendUpdateState(state: DesktopUpdateState): void {
    if (win && !win.isDestroyed()) {
      win.webContents.send("update-state-changed", state);
    }
  }

  function sendOptionTab(): void {
    if (win && !win.isDestroyed() && currentRoute === "onboarding") {
      win.webContents.send("onboarding-option-tab");
    }
  }

  return {
    show,
    close,
    isOpen: () => win !== null && !win.isDestroyed(),
    isRoute: (route: ControlWindowRoute) => currentRoute === route && win !== null && !win.isDestroyed(),
    isFocused: () => win?.isFocused() ?? false,
    ownsFrame: (frame: WebFrameMain | null) => {
      if (!win || win.isDestroyed() || !frame || frame !== win.webContents.mainFrame) return false;
      return frame.url.split("#", 1)[0] === pathToFileURL(deps.rendererPath).toString();
    },
    sendStatus,
    sendMemories,
    sendPaused,
    sendPreferences,
    sendLocalInferenceStatus,
    sendLocalModelCatalog,
    sendCompletionHistory,
    sendUpdateState,
    sendOptionTab,
  };
}
