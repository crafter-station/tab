import { contextBridge, ipcRenderer } from "electron";
import type { DesktopStatus } from "../main/status.ts";
import type { DesktopPreferences } from "../main/preferences.ts";
import type { PersonalMemory } from "@tab/contracts";

type DebugApiState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "empty" }
  | { status: "suggestion"; text: string };

type DebugContext = {
  context: string;
  wordLimit: number;
  wordCount: number;
  source: string;
  app: string | null;
  paused: boolean;
  secureInput: boolean;
  api?: DebugApiState;
};

export type TabPreloadApi = {
  onSuggestion: (callback: (suggestion: { id: string; text: string }) => void) => () => void;
  onDebugContext: (callback: (debug: DebugContext) => void) => () => void;
  onHide: (callback: () => void) => () => void;
  overlayReady: () => void;
  acceptSuggestion: () => void;

  // Onboarding
  openAccessibilitySettings: () => Promise<boolean>;
  checkAccessibilityPermission: () => Promise<boolean>;
  openInputMonitoringSettings: () => Promise<void>;
  revealAppInFinder: () => Promise<void>;
  relaunchForPermissions: () => Promise<void>;
  completeOnboarding: () => void;
  skipOnboarding: () => void;

  // Settings / status
  onStatusChanged: (callback: (status: DesktopStatus) => void) => void;
  onMemoriesChanged: (callback: (memories: PersonalMemory[]) => void) => void;
  onPauseChanged: (callback: (paused: boolean) => void) => void;
  onPreferencesChanged: (callback: (preferences: DesktopPreferences) => void) => void;
  getInitialState: () => Promise<{ status: DesktopStatus; memories: PersonalMemory[]; paused: boolean; preferences: DesktopPreferences }>;
  signIn: () => void;
  signOut: () => void;
  togglePause: () => void;
  setUsePersonalMemoryForSuggestions: (enabled: boolean) => void;
  deleteMemory: (id: string) => void;
};

contextBridge.exposeInMainWorld("tab", {
  onSuggestion: (callback: (suggestion: { id: string; text: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, suggestion: { id: string; text: string }) => callback(suggestion);
    ipcRenderer.on("suggestion", listener);
    return () => ipcRenderer.off("suggestion", listener);
  },
  onDebugContext: (callback: (debug: DebugContext) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, debug: DebugContext) => callback(debug);
    ipcRenderer.on("debug-context", listener);
    return () => ipcRenderer.off("debug-context", listener);
  },
  onHide: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("hide", listener);
    return () => ipcRenderer.off("hide", listener);
  },
  overlayReady: () => {
    ipcRenderer.send("overlay-ready");
  },
  acceptSuggestion: () => {
    ipcRenderer.send("accept-suggestion");
  },

  openAccessibilitySettings: () => ipcRenderer.invoke("open-accessibility-settings"),
  checkAccessibilityPermission: () => ipcRenderer.invoke("check-accessibility-permission"),
  openInputMonitoringSettings: () => ipcRenderer.invoke("open-input-monitoring-settings"),
  revealAppInFinder: () => ipcRenderer.invoke("reveal-app-in-finder"),
  relaunchForPermissions: () => ipcRenderer.invoke("relaunch-for-permissions"),
  completeOnboarding: () => {
    ipcRenderer.send("complete-onboarding");
  },
  skipOnboarding: () => {
    ipcRenderer.send("complete-onboarding");
  },

  onStatusChanged: (callback: (status: DesktopStatus) => void) => {
    ipcRenderer.on("status-changed", (_event, status) => callback(status));
  },
  onMemoriesChanged: (callback: (memories: PersonalMemory[]) => void) => {
    ipcRenderer.on("memories-changed", (_event, memories) => callback(memories));
  },
  onPauseChanged: (callback: (paused: boolean) => void) => {
    ipcRenderer.on("pause-changed", (_event, paused) => callback(paused));
  },
  onPreferencesChanged: (callback: (preferences: DesktopPreferences) => void) => {
    ipcRenderer.on("preferences-changed", (_event, preferences) => callback(preferences));
  },
  getInitialState: () => ipcRenderer.invoke("get-initial-state"),
  signIn: () => {
    ipcRenderer.send("sign-in");
  },
  signOut: () => {
    ipcRenderer.send("sign-out");
  },
  togglePause: () => {
    ipcRenderer.send("toggle-pause");
  },
  setUsePersonalMemoryForSuggestions: (enabled: boolean) => {
    ipcRenderer.send("set-use-personal-memory-for-suggestions", enabled);
  },
  deleteMemory: (id: string) => {
    ipcRenderer.send("delete-memory", id);
  },
} satisfies TabPreloadApi);

declare global {
  interface Window {
    tab: TabPreloadApi;
  }
}
