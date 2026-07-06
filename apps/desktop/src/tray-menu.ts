import { Tray, Menu, type NativeImage } from "electron";
import type { DesktopStatus } from "./status.ts";

export type TrayMenuState = {
  paused: boolean;
  auth: DesktopStatus["auth"];
  quotaExhausted: boolean;
};

export type TrayMenuActions = {
  showSettings(): void;
  showQuickMemory(): void;
  togglePause(): void;
  signIn(): void;
  signOut(): void;
  quit(): void;
};

export type CreateTrayMenuDependencies = {
  icon: NativeImage | string;
  actions: TrayMenuActions;
};

export type TabbTray = Tray & {
  update(state: TrayMenuState): void;
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
      isSignedIn
        ? {
            label: "Sign Out",
            click: deps.actions.signOut,
          }
        : {
            label: "Sign In",
            click: deps.actions.signIn,
          },
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

  tray.setToolTip(buildStatusLabel({ paused: false, auth: "sign_in_required", quotaExhausted: false }));
  tray.setContextMenu(buildContextMenu({ paused: false, auth: "sign_in_required", quotaExhausted: false }));

  return tray;
}
