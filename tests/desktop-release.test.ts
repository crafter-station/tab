import { describe, it, expect } from "bun:test";
import { createUpdateChecker } from "../apps/desktop/src/release.ts";
import { DesktopReleaseFeedSchema } from "../packages/contracts/src/index.ts";

describe("Desktop release packaging", () => {
  it("has an electron-builder config that targets macOS direct distribution", async () => {
    const config = await Bun.file("apps/desktop/electron-builder.yml").text();
    expect(config).toInclude("target: dmg");
    expect(config).toInclude("hardenedRuntime: true");
    expect(config).toInclude("gatekeeperAssess: false");
    expect(config).toInclude("entitlements: build/entitlements.mac.plist");
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

  it("has a notarization script that skips when signing credentials are missing", async () => {
    const script = await Bun.file("apps/desktop/scripts/notarize.cjs").text();
    expect(script).toInclude("notarize");
    expect(script).toInclude("APPLE_ID");
    expect(script).toInclude("APPLE_TEAM_ID");
  });
});

describe("Desktop update checker", () => {
  function makeFeed(version: string, url: string) {
    return { version, url, notes: "Bug fixes and improvements." };
  }

  it("reports an update when the feed version is newer", async () => {
    const calls: Array<{ version: string; url: string }> = [];
    const checker = createUpdateChecker({
      currentVersion: "0.1.0",
      feedUrl: "https://example.com/latest.json",
      fetch: async () =>
        new Response(
          JSON.stringify(makeFeed("0.2.0", "https://example.com/tabb.dmg")),
        ),
      onUpdateAvailable: (version, url) => calls.push({ version, url }),
    });

    const result = await checker.checkForUpdates();

    expect(result).toBe(true);
    expect(calls).toEqual([
      { version: "0.2.0", url: "https://example.com/tabb.dmg" },
    ]);
  });

  it("does not report an update when the feed version is the same", async () => {
    const calls: Array<{ version: string; url: string }> = [];
    const checker = createUpdateChecker({
      currentVersion: "0.2.0",
      feedUrl: "https://example.com/latest.json",
      fetch: async () =>
        new Response(
          JSON.stringify(makeFeed("0.2.0", "https://example.com/tabb.dmg")),
        ),
      onUpdateAvailable: (version, url) => calls.push({ version, url }),
    });

    const result = await checker.checkForUpdates();

    expect(result).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("does not report an update when the feed cannot be reached", async () => {
    const calls: Array<{ version: string; url: string }> = [];
    const checker = createUpdateChecker({
      currentVersion: "0.1.0",
      feedUrl: "https://example.com/latest.json",
      fetch: async () => new Response("not json", { status: 500 }),
      onUpdateAvailable: (version, url) => calls.push({ version, url }),
    });

    const result = await checker.checkForUpdates();

    expect(result).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("validates feed responses with the shared schema", () => {
    const valid = {
      version: "0.2.0",
      url: "https://example.com/tabb.dmg",
      notes: "Bug fixes.",
    };
    expect(DesktopReleaseFeedSchema.safeParse(valid).success).toBe(true);
    expect(
      DesktopReleaseFeedSchema.safeParse({
        version: "0.2.0",
        url: "not-a-url",
      }).success,
    ).toBe(false);
  });
});
