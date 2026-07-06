import {
  Tray,
  Menu,
  type MenuItemConstructorOptions,
  type NativeImage,
} from "electron";
import type { DesktopStatus } from "./status.ts";

export type TrayMenuState = {
  paused: boolean;
  auth: DesktopStatus["auth"];
  quotaExhausted: boolean;
  updateAvailable?: boolean;
};

export type TrayMenuActions = {
  showSettings(): void;
  showQuickMemory(): void;
  togglePause(): void;
  signIn(): void;
  signOut(): void;
  checkForUpdates(): void;
  openDownloadPage(): void;
  quit(): void;
};

export type CreateTrayMenuDependencies = {
  icon: NativeImage | string;
  actions: TrayMenuActions;
};

export type TabbTray = Tray & {
  update(state: TrayMenuState): void;
};

const INITIAL_TRAY_STATE: TrayMenuState = {
  paused: false,
  auth: "sign_in_required",
  quotaExhausted: false,
  updateAvailable: false,
};

export function createTrayMenu(deps: CreateTrayMenuDependencies): TabbTray {
  const tray = new Tray(deps.icon) as TabbTray;
  tray.setToolTip("Tabb");

  function buildStatusLabel(state: TrayMenuState): string {
    if (state.paused) return "Tabb — Paused";
    if (state.auth === "revoked_device") return "Tabb — Device Revoked";
    if (state.auth === "sign_in_required") return "Tabb — Sign In Required";
    if (state.quotaExhausted) return "Tabb — Quota Exhausted";
    if (state.auth === "signed_in") return "Tabb — Signed In";
    return "Tabb";
  }

  function buildContextMenu(state: TrayMenuState): Menu {
    const isSignedIn = state.auth === "signed_in";
    const pauseLabel = state.paused ? "Resume Tabb" : "Pause Tabb";
    let updateItem: MenuItemConstructorOptions;
    if (state.updateAvailable) {
      updateItem = {
        label: "Update Available",
        click: deps.actions.openDownloadPage,
      };
    } else {
      updateItem = {
        label: "Check for Updates",
        click: deps.actions.checkForUpdates,
      };
    }

    let authItem: MenuItemConstructorOptions;
    if (isSignedIn) {
      authItem = {
        label: "Sign Out",
        click: deps.actions.signOut,
      };
    } else {
      authItem = {
        label: "Sign In",
        click: deps.actions.signIn,
      };
    }

    return Menu.buildFromTemplate([
      {
        label: buildStatusLabel(state),
        enabled: false,
      },
      { type: "separator" },
      {
        label: "Settings",
        click: deps.actions.showSettings,
      },
      {
        label: "Quick Memory",
        click: deps.actions.showQuickMemory,
      },
      { type: "separator" },
      {
        label: pauseLabel,
        click: deps.actions.togglePause,
      },
      { type: "separator" },
      updateItem,
      { type: "separator" },
      authItem,
      { type: "separator" },
      {
        label: "Quit",
        click: deps.actions.quit,
      },
    ]);
  }

  tray.update = (state: TrayMenuState): void => {
    tray.setToolTip(buildStatusLabel(state));
    tray.setContextMenu(buildContextMenu(state));
  };

  tray.update(INITIAL_TRAY_STATE);

  return tray;
}
