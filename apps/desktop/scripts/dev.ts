import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const desktopRoot = path.resolve(import.meta.dir, "..");
const workspaceRoot = path.resolve(desktopRoot, "../..");
const devRoot = path.join(desktopRoot, ".dev");
const devSrc = path.join(devRoot, "src");
const devAssets = path.join(devRoot, "assets");

async function buildEntry(entrypoint: string, outfile: string, format: "esm" | "cjs") {
  const result = await Bun.build({
    entrypoints: [entrypoint],
    outdir: path.dirname(outfile),
    naming: path.basename(outfile),
    target: "node",
    format,
    external: ["electron"],
    sourcemap: "external",
  });

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log);
    }
    throw new Error(`Failed to build ${entrypoint}`);
  }
}

async function copyRuntimeFiles() {
  await Bun.write(
    path.join(devRoot, "package.json"),
    JSON.stringify({ type: "module", main: "src/main.js" }, null, 2),
  );

  for (const fileName of ["index.html", "onboarding.html", "settings.html"]) {
    await Bun.write(
      path.join(devSrc, fileName),
      Bun.file(path.join(desktopRoot, "src", fileName)),
    );
  }
}

async function writePlaceholderTrayIcon() {
  const iconPath = path.join(devAssets, "iconTemplate.png");
  const transparentPngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8AABQMBgAottDkAAAAASUVORK5CYII=";

  await Bun.write(iconPath, Buffer.from(transparentPngBase64, "base64"));
  return iconPath;
}

async function main() {
  const buildOnly = process.argv.includes("--build-only");

  rmSync(devRoot, { recursive: true, force: true });
  mkdirSync(devSrc, { recursive: true });
  mkdirSync(devAssets, { recursive: true });

  await Promise.all([
    buildEntry(path.join(desktopRoot, "src", "main.ts"), path.join(devSrc, "main.js"), "esm"),
    buildEntry(path.join(desktopRoot, "src", "preload.ts"), path.join(devSrc, "preload.cjs"), "cjs"),
    copyRuntimeFiles(),
  ]);

  const trayIconPath = await writePlaceholderTrayIcon();
  if (buildOnly) {
    console.log(`Built desktop dev app at ${devRoot}`);
    return;
  }

  const child = Bun.spawn(["bunx", "electron", devRoot], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      TABB_PRELOAD_PATH: path.join(devSrc, "preload.cjs"),
      TABB_TRAY_ICON_PATH: trayIconPath,
      TABB_DEVICE_ID: process.env.TABB_DEVICE_ID ?? "dev-device",
    },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  process.exitCode = await child.exited;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
