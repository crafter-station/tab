import { contextBridge, ipcRenderer } from "electron";
import type { DesktopStatus } from "./status.ts";
import type { PersonalMemory } from "@tabb/contracts";

export type TabbPreloadApi = {
  onSuggestion: (callback: (suggestion: { id: string; text: string }) => void) => void;
  onHide: (callback: () => void) => void;
  acceptSuggestion: () => void;

  // Onboarding
  completeOnboarding: () => void;

  // Settings / status
  onStatusChanged: (callback: (status: DesktopStatus) => void) => void;
  onMemoriesChanged: (callback: (memories: PersonalMemory[]) => void) => void;
  onPauseChanged: (callback: (paused: boolean) => void) => void;
  getInitialState: () => Promise<{ status: DesktopStatus; memories: PersonalMemory[]; paused: boolean }>;
  signIn: () => void;
  signOut: () => void;
  togglePause: () => void;
  deleteMemory: (id: string) => void;
};

contextBridge.exposeInMainWorld("tabb", {
  onSuggestion: (callback: (suggestion: { id: string; text: string }) => void) => {
    ipcRenderer.on("suggestion", (_event, suggestion) => callback(suggestion));
  },
  onHide: (callback: () => void) => {
    ipcRenderer.on("hide", () => callback());
  },
  acceptSuggestion: () => {
    ipcRenderer.send("accept-suggestion");
  },

  completeOnboarding: () => {
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
  deleteMemory: (id: string) => {
    ipcRenderer.send("delete-memory", id);
  },
} satisfies TabbPreloadApi);

declare global {
  interface Window {
    tabb: TabbPreloadApi;
  }
}
