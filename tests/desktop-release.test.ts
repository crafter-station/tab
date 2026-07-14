import { describe, it, expect } from "bun:test";
import { EventEmitter } from "node:events";
import { createDesktopUpdater } from "../apps/desktop/src/main/release.ts";

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = false;
  allowPrerelease = true;
  allowDowngrade = true;
  checkCount = 0;
  downloadCount = 0;
  installCount = 0;

  async checkForUpdates() {
    this.checkCount += 1;
    return null;
  }

  async downloadUpdate() {
    this.downloadCount += 1;
    return ["/tmp/Tab.zip"];
  }

  quitAndInstall() {
    this.installCount += 1;
  }
}

describe("Desktop release packaging", () => {
  it("has an electron-builder config that targets macOS direct distribution", async () => {
    const config = await Bun.file("apps/desktop/electron-builder.yml").text();
    expect(config).toInclude("target: dmg");
    expect(config).toInclude("hardenedRuntime: true");
    expect(config).toInclude("gatekeeperAssess: false");
    expect(config).toInclude("entitlements: build/entitlements.mac.plist");
    expect(config).toInclude("icon: ../web/public/brand/tab-mark.png");
    expect(config).toInclude("- universal");
    expect(config).toInclude('artifactName: "${productName}-${version}-${arch}.${ext}"');
    expect(config).toInclude("protocols:");
    expect(config).toInclude("- tab");
    expect(config).toInclude("provider: github");
    expect(config).toInclude("owner: crafter-station");
    expect(config).toInclude("repo: tab");
  });

  it("publishes signed tags with a stable universal download asset", async () => {
    const workflow = await Bun.file(".github/workflows/release-desktop.yml").text();
    expect(workflow).toInclude("tags:");
    expect(workflow).toInclude('"v*"');
    expect(workflow).toInclude("MACOS_CERTIFICATE");
    expect(workflow).toInclude("APPLE_API_KEY_CONTENT");
    expect(workflow).toInclude("APPLE_API_ISSUER");
    expect(workflow).toInclude("Tab.dmg");
    expect(workflow).toInclude("latest-mac.yml");
    expect(workflow).toInclude(".zip.blockmap");
    expect(workflow).toInclude("--draft");
    expect(workflow).toInclude("gh release edit");
  });

  it("has macOS entitlements that do not request Screen Recording or Full Disk Access", async () => {
    const entitlements = await Bun.file(
      "apps/desktop/build/entitlements.mac.plist",
    ).text();
    const lower = entitlements.toLowerCase();
    expect(lower).not.toInclude("screenrecording");
    expect(lower).not.toInclude("ktccservicescreencapture");
    expect(lower).not.toInclude("systempolicyallfiles");
    expect(lower).not.toInclude("kTCCServiceSystemPolicyAllFiles".toLowerCase());
  });

  it("notarizes via electron-builder with API key credentials sourced by the ship scripts", async () => {
    const config = await Bun.file("apps/desktop/electron-builder.yml").text();
    expect(config).toInclude("notarize: true");
    expect(config).toInclude("releaseType: draft");

    const shipScript = await Bun.file("apps/desktop/scripts/build-and-upload.sh").text();
    expect(shipScript).toInclude("APPLE_API_KEY");
    expect(shipScript).toInclude("APPLE_API_KEY_ID");
    expect(shipScript).toInclude("APPLE_API_ISSUER");
    expect(shipScript).toInclude("GH_TOKEN");
    expect(shipScript).toInclude("source .env");
    expect(shipScript).toInclude("--draft=false");
  });

  it("defaults packaged builds to the production web and API origins", async () => {
    const source = await Bun.file("apps/desktop/src/main/env.ts").text();
    expect(source).toInclude('TAB_API_BASE_URL: z.url().default("https://api.tab.cueva.io")');
    expect(source).toInclude('TAB_WEB_BASE_URL: z.url().default("https://tab.cueva.io")');
  });
});

describe("Desktop updater", () => {
  it("checks without automatically downloading stable updates", async () => {
    const nativeUpdater = new FakeUpdater();
    const updater = createDesktopUpdater({
      currentVersion: "0.1.0",
      nativeUpdater,
    });

    await updater.checkForUpdates();

    expect(nativeUpdater.checkCount).toBe(1);
    expect(nativeUpdater.autoDownload).toBe(false);
    expect(nativeUpdater.autoInstallOnAppQuit).toBe(true);
    expect(nativeUpdater.allowPrerelease).toBe(false);
    expect(nativeUpdater.allowDowngrade).toBe(false);
    expect(updater.getState()).toEqual({ status: "checking", currentVersion: "0.1.0" });
  });

  it("publishes availability, progress, and downloaded states", async () => {
    const nativeUpdater = new FakeUpdater();
    const states: string[] = [];
    const updater = createDesktopUpdater({
      currentVersion: "0.1.0",
      nativeUpdater,
      onChange: (state) => states.push(state.status),
    });

    nativeUpdater.emit("update-available", { version: "0.2.0" });
    expect(updater.getState()).toEqual({
      status: "available",
      currentVersion: "0.1.0",
      version: "0.2.0",
    });

    await updater.downloadUpdate();
    nativeUpdater.emit("download-progress", { percent: 42.4 });
    nativeUpdater.emit("update-downloaded", { version: "0.2.0" });

    expect(nativeUpdater.downloadCount).toBe(1);
    expect(states).toEqual(["available", "downloading", "downloading", "downloaded"]);
    expect(updater.getState()).toEqual({
      status: "downloaded",
      currentVersion: "0.1.0",
      version: "0.2.0",
    });
  });

  it("only installs an update after it has downloaded", () => {
    const nativeUpdater = new FakeUpdater();
    const updater = createDesktopUpdater({ currentVersion: "0.1.0", nativeUpdater });

    expect(() => updater.quitAndInstall()).toThrow("No downloaded update is ready to install");
    nativeUpdater.emit("update-downloaded", { version: "0.2.0" });
    updater.quitAndInstall();

    expect(nativeUpdater.installCount).toBe(1);
  });

  it("reports an up-to-date result and clamps download progress", () => {
    const nativeUpdater = new FakeUpdater();
    const updater = createDesktopUpdater({ currentVersion: "0.1.0", nativeUpdater });

    nativeUpdater.emit("update-not-available", { version: "0.1.0" });
    expect(updater.getState()).toEqual({ status: "not-available", currentVersion: "0.1.0" });

    nativeUpdater.emit("update-available", { version: "0.2.0" });
    nativeUpdater.emit("download-progress", { percent: 120 });
    expect(updater.getState()).toEqual({
      status: "downloading",
      currentVersion: "0.1.0",
      version: "0.2.0",
      percent: 100,
    });
  });

  it("publishes a retryable user-facing error", async () => {
    const nativeUpdater = new FakeUpdater();
    const updater = createDesktopUpdater({ currentVersion: "0.1.0", nativeUpdater });

    nativeUpdater.emit("error", new Error("provider token and URL details"));

    expect(updater.getState()).toEqual({
      status: "error",
      currentVersion: "0.1.0",
      message: "Tab could not check for updates. Check your connection and try again.",
    });

    await updater.checkForUpdates();
    expect(updater.getState()).toEqual({ status: "checking", currentVersion: "0.1.0" });
  });

  it("uses a download-specific error without exposing provider details", async () => {
    const nativeUpdater = new FakeUpdater();
    nativeUpdater.downloadUpdate = async () => {
      throw new Error("private provider response");
    };
    const updater = createDesktopUpdater({ currentVersion: "0.1.0", nativeUpdater });
    nativeUpdater.emit("update-available", { version: "0.2.0" });

    await expect(updater.downloadUpdate()).rejects.toThrow("private provider response");
    expect(updater.getState()).toEqual({
      status: "error",
      currentVersion: "0.1.0",
      message: "The update could not be downloaded. Check your connection and try again.",
    });
  });
});
