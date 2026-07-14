import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = new URL("..", import.meta.url).pathname;

function readText(path) {
  return readFileSync(join(root, path), "utf8");
}

function sourceFiles(directory) {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("production logging", () => {
  it("strips console calls from production desktop bundles", () => {
    const desktopPackage = JSON.parse(readText("apps/desktop/package.json"));
    assert.match(desktopPackage.scripts["build:main"], /--drop=console/);
    assert.match(desktopPackage.scripts["build:preload"], /--drop=console/);

    const rendererConfig = readText("apps/desktop/electron.vite.config.ts");
    assert.match(rendererConfig, /drop:\s*\["console"\]/);
    assert.match(readText("apps/desktop/src/main/index.ts"), /app\.isPackaged\) autoUpdater\.logger = null/);
  });

  it("does not emit application logs from the production API runtime", () => {
    const apiSources = sourceFiles("apps/api/src");
    for (const path of apiSources) {
      const source = readText(path);
      assert.doesNotMatch(source, /console\.(?:debug|info|log|warn|error)\s*\(/, path);
    }

    assert.doesNotMatch(readText("apps/api/src/index.ts"), /app\.use\("\*", logger\(\)\)/);
    assert.match(readText("apps/api/src/auth.ts"), /logger:\s*\{\s*disabled:\s*true/);
  });
});
