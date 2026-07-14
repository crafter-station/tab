export type DesktopUpdateState =
  | { status: "idle"; currentVersion: string }
  | { status: "checking"; currentVersion: string }
  | { status: "not-available"; currentVersion: string }
  | { status: "available"; currentVersion: string; version: string }
  | { status: "downloading"; currentVersion: string; version: string; percent: number }
  | { status: "downloaded"; currentVersion: string; version: string }
  | { status: "error"; currentVersion: string; message: string };

type UpdateInfo = { version: string };
type DownloadProgress = { percent: number };

export type NativeUpdater = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  on(event: "checking-for-update", listener: () => void): unknown;
  on(event: "update-not-available", listener: (info: UpdateInfo) => void): unknown;
  on(event: "update-available", listener: (info: UpdateInfo) => void): unknown;
  on(event: "download-progress", listener: (progress: DownloadProgress) => void): unknown;
  on(event: "update-downloaded", listener: (info: UpdateInfo) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<string[]>;
  quitAndInstall(): void;
};

export type DesktopUpdaterDependencies = {
  currentVersion: string;
  nativeUpdater: NativeUpdater;
  onChange?: (state: DesktopUpdateState) => void;
  onError?: (error: Error) => void;
};

export function createDesktopUpdater(deps: DesktopUpdaterDependencies) {
  const { nativeUpdater } = deps;
  let state: DesktopUpdateState = {
    status: "idle",
    currentVersion: deps.currentVersion,
  };
  let availableVersion: string | null = null;
  let operation: "checking" | "downloading" | null = null;
  const handledErrors = new WeakSet<Error>();

  nativeUpdater.autoDownload = false;
  nativeUpdater.autoInstallOnAppQuit = true;
  nativeUpdater.allowPrerelease = false;
  nativeUpdater.allowDowngrade = false;

  function publish(nextState: DesktopUpdateState): void {
    state = nextState;
    deps.onChange?.(nextState);
  }

  function fail(error: Error): void {
    if (handledErrors.has(error)) return;
    handledErrors.add(error);
    deps.onError?.(error);
    const message = operation === "downloading"
      ? "The update could not be downloaded. Check your connection and try again."
      : "Tab could not check for updates. Check your connection and try again.";
    operation = null;
    publish({ status: "error", currentVersion: deps.currentVersion, message });
  }

  nativeUpdater.on("checking-for-update", () => {
    operation = "checking";
    publish({ status: "checking", currentVersion: deps.currentVersion });
  });
  nativeUpdater.on("update-not-available", () => {
    operation = null;
    availableVersion = null;
    publish({ status: "not-available", currentVersion: deps.currentVersion });
  });
  nativeUpdater.on("update-available", (info) => {
    operation = null;
    availableVersion = info.version;
    publish({
      status: "available",
      currentVersion: deps.currentVersion,
      version: info.version,
    });
  });
  nativeUpdater.on("download-progress", (progress) => {
    if (!availableVersion) return;
    const percent = Math.min(100, Math.max(0, progress.percent));
    if (
      state.status === "downloading"
      && state.version === availableVersion
      && Math.round(state.percent) === Math.round(percent)
    ) return;
    publish({
      status: "downloading",
      currentVersion: deps.currentVersion,
      version: availableVersion,
      percent,
    });
  });
  nativeUpdater.on("update-downloaded", (info) => {
    operation = null;
    availableVersion = info.version;
    publish({
      status: "downloaded",
      currentVersion: deps.currentVersion,
      version: info.version,
    });
  });
  nativeUpdater.on("error", fail);

  return {
    getState(): DesktopUpdateState {
      return state;
    },

    async checkForUpdates(): Promise<void> {
      if (["checking", "downloading", "downloaded"].includes(state.status)) return;
      operation = "checking";
      publish({ status: "checking", currentVersion: deps.currentVersion });
      try {
        await nativeUpdater.checkForUpdates();
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
    },

    async downloadUpdate(): Promise<void> {
      if (!availableVersion || state.status !== "available") {
        throw new Error("No update is available to download");
      }
      operation = "downloading";
      publish({
        status: "downloading",
        currentVersion: deps.currentVersion,
        version: availableVersion,
        percent: 0,
      });
      try {
        await nativeUpdater.downloadUpdate();
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
    },

    quitAndInstall(): void {
      if (state.status !== "downloaded") {
        throw new Error("No downloaded update is ready to install");
      }
      nativeUpdater.quitAndInstall();
    },
  };
}

export type DesktopUpdater = ReturnType<typeof createDesktopUpdater>;
