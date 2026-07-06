import { contextBridge, ipcRenderer } from "electron";

export type TabbPreloadApi = {
  onSuggestion: (callback: (suggestion: { id: string; text: string }) => void) => void;
  onHide: (callback: () => void) => void;
  acceptSuggestion: () => void;
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
} satisfies TabbPreloadApi);

declare global {
  interface Window {
    tabb: TabbPreloadApi;
  }
}
