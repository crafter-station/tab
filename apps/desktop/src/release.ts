import { DesktopReleaseFeedSchema } from "@tabb/contracts";

export type UpdateCheckerDependencies = {
  currentVersion: string;
  feedUrl: string;
  fetch?: typeof globalThis.fetch;
  onUpdateAvailable?: (version: string, url: string) => void;
};

function parseVersion(version: string): number[] {
  return version
    .split(".")
    .map((part) => parseInt(part, 10))
    .filter((part) => !Number.isNaN(part));
}

function compareVersions(a: string, b: string): number {
  const aParts = parseVersion(a);
  const bParts = parseVersion(b);
  const length = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < length; i++) {
    const aPart = aParts[i] ?? 0;
    const bPart = bParts[i] ?? 0;
    if (aPart > bPart) return 1;
    if (aPart < bPart) return -1;
  }

  return 0;
}

export function createUpdateChecker(deps: UpdateCheckerDependencies) {
  const http = deps.fetch ?? globalThis.fetch;

  return {
    async checkForUpdates(): Promise<boolean> {
      try {
        const response = await http(deps.feedUrl);
        if (!response.ok) {
          return false;
        }

        const raw = (await response.json()) as unknown;
        const parsed = DesktopReleaseFeedSchema.safeParse(raw);
        if (!parsed.success) {
          return false;
        }

        const feed = parsed.data;
        if (compareVersions(feed.version, deps.currentVersion) > 0) {
          deps.onUpdateAvailable?.(feed.version, feed.url);
          return true;
        }

        return false;
      } catch {
        return false;
      }
    },
  };
}

export type UpdateChecker = ReturnType<typeof createUpdateChecker>;
