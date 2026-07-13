import { contextBridge, ipcRenderer } from "electron";
import type { DesktopStatus } from "../main/status.ts";
import type { DesktopPreferences } from "../main/preferences.ts";
import type { PersonalMemory } from "@tab/contracts";
import type { LocalInferenceStatus } from "../main/local-inference-prototype.ts";
import type { CompletionHistoryEntry } from "../main/completion-history.ts";

type DebugApiState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "empty" }
  | { status: "local-unavailable"; reason: string }
  | { status: "suggestion"; text: string };

type DebugContext = {
  context: string;
  wordLimit: number;
  wordCount: number;
  source: string;
  app: string | null;
  paused: boolean;
  secureInput: boolean;
  appContext?: {
    status: string;
    provider: string | null;
    confidence: number | null;
    suppressionReason?: string | null;
    fragmentCount: number;
    messageCount: number;
  };
  api?: DebugApiState;
};

export type TabPreloadApi = {
  onSuggestion: (callback: (suggestion: {
    id: string;
    text: string;
    source: "local" | "cloud";
    presentation?: "floating" | "inline";
    inlineMetrics?: { fontSize: number; lineHeight: number };
  }) => void) => () => void;
  onSuggestionLoading: (callback: (loading: boolean) => void) => () => void;
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
  completeOnboardingAndRelaunch: () => void;
  skipOnboarding: () => void;

  // Settings / status
  onStatusChanged: (callback: (status: DesktopStatus) => void) => () => void;
  onMemoriesChanged: (callback: (memories: PersonalMemory[]) => void) => () => void;
  onPauseChanged: (callback: (paused: boolean) => void) => () => void;
  onPreferencesChanged: (callback: (preferences: DesktopPreferences) => void) => () => void;
  onLocalInferenceStatusChanged: (callback: (status: LocalInferenceStatus) => void) => () => void;
  onCompletionHistoryChanged: (callback: (entries: readonly CompletionHistoryEntry[]) => void) => () => void;
  getInitialState: () => Promise<{ status: DesktopStatus; memories: PersonalMemory[]; paused: boolean; preferences: DesktopPreferences; localInferenceStatus: LocalInferenceStatus; completionHistory: readonly CompletionHistoryEntry[] }>;
  signIn: () => void;
  signOut: () => void;
  togglePause: () => void;
  downloadLocalModel: () => Promise<void>;
  setUsePersonalMemoryForSuggestions: (enabled: boolean) => void;
  deleteMemory: (id: string) => void;
};

contextBridge.exposeInMainWorld("tab", {
  onSuggestion: (callback: (suggestion: {
    id: string;
    text: string;
    source: "local" | "cloud";
    presentation?: "floating" | "inline";
    inlineMetrics?: { fontSize: number; lineHeight: number };
  }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, suggestion: {
      id: string;
      text: string;
      source: "local" | "cloud";
      presentation?: "floating" | "inline";
      inlineMetrics?: { fontSize: number; lineHeight: number };
    }) => callback(suggestion);
    ipcRenderer.on("suggestion", listener);
    return () => ipcRenderer.off("suggestion", listener);
  },
  onSuggestionLoading: (callback: (loading: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, loading: boolean) => callback(loading);
    ipcRenderer.on("suggestion-loading", listener);
    return () => ipcRenderer.off("suggestion-loading", listener);
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
  completeOnboardingAndRelaunch: () => {
    ipcRenderer.send("complete-onboarding-and-relaunch");
  },
  skipOnboarding: () => {
    ipcRenderer.send("complete-onboarding");
  },

  onStatusChanged: (callback: (status: DesktopStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: DesktopStatus) => callback(status);
    ipcRenderer.on("status-changed", listener);
    return () => ipcRenderer.off("status-changed", listener);
  },
  onMemoriesChanged: (callback: (memories: PersonalMemory[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, memories: PersonalMemory[]) => callback(memories);
    ipcRenderer.on("memories-changed", listener);
    return () => ipcRenderer.off("memories-changed", listener);
  },
  onPauseChanged: (callback: (paused: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, paused: boolean) => callback(paused);
    ipcRenderer.on("pause-changed", listener);
    return () => ipcRenderer.off("pause-changed", listener);
  },
  onPreferencesChanged: (callback: (preferences: DesktopPreferences) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, preferences: DesktopPreferences) => callback(preferences);
    ipcRenderer.on("preferences-changed", listener);
    return () => ipcRenderer.off("preferences-changed", listener);
  },
  onLocalInferenceStatusChanged: (callback: (status: LocalInferenceStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: LocalInferenceStatus) => callback(status);
    ipcRenderer.on("local-inference-status-changed", listener);
    return () => ipcRenderer.off("local-inference-status-changed", listener);
  },
  onCompletionHistoryChanged: (callback: (entries: readonly CompletionHistoryEntry[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, entries: readonly CompletionHistoryEntry[]) => callback(entries);
    ipcRenderer.on("completion-history-changed", listener);
    return () => ipcRenderer.off("completion-history-changed", listener);
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
  downloadLocalModel: () => ipcRenderer.invoke("download-local-model"),
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
