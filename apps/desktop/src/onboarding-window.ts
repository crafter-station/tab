import { BrowserWindow } from "electron";

export type CreateOnboardingWindowDependencies = {
  htmlPath: string;
  preloadPath: string;
};

export function createOnboardingWindow(deps: CreateOnboardingWindowDependencies): BrowserWindow {
  const win = new BrowserWindow({
    width: 560,
    height: 640,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: "Welcome to Tabb",
    webPreferences: {
      preload: deps.preloadPath,
    },
  });

  win.loadFile(deps.htmlPath);
  win.once("ready-to-show", () => win?.show());

  return win;
}

export type OnboardingWindowManagerDependencies = {
  htmlPath: string;
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
      htmlPath: deps.htmlPath,
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

  return {
    show,
    close,
    isOpen: () => win !== null && !win.isDestroyed(),
  };
}
