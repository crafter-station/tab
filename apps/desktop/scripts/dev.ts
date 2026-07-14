import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { env } from "../src/main/env.ts";

const desktopRoot = path.resolve(import.meta.dir, "..");
const workspaceRoot = path.resolve(desktopRoot, "../..");
const devRoot = path.join(desktopRoot, ".dev");
const devSrc = path.join(devRoot, "src");
const devAssets = path.join(devRoot, "assets");
const appRendererHtmlPath = path.join(desktopRoot, "dist", "renderer", "app.html");
const overlayRendererHtmlPath = path.join(desktopRoot, "dist", "renderer", "overlay.html");

async function buildEntry(entrypoint: string, outfile: string, format: "esm" | "cjs") {
  const result = await Bun.build({
    entrypoints: [entrypoint],
    outdir: path.dirname(outfile),
    naming: path.basename(outfile),
    target: "node",
    format,
    external: ["electron", "electron-updater"],
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
    JSON.stringify({ name: "tab-dev", productName: "Tab", type: "module", main: "src/main.js" }, null, 2),
  );

}

async function buildRenderer() {
  const child = Bun.spawn(["bunx", "electron-vite", "build"], {
    cwd: desktopRoot,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error("Failed to build desktop renderer");
  }
}

async function copyTrayIcon() {
  const iconPath = path.join(devAssets, "iconTemplate.png");
  await Bun.write(iconPath, Bun.file(path.join(desktopRoot, "assets", "iconTemplate.png")));
  return iconPath;
}

async function buildNativeInputTap() {
  const inputTapPath = path.join(devRoot, "macos-input-tap");
  if (process.platform !== "darwin") return null;

  const child = Bun.spawn(["bun", path.join(desktopRoot, "scripts", "build-native.ts"), inputTapPath], {
    cwd: workspaceRoot,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error("Failed to build macOS input tap");
  }
  return inputTapPath;
}

async function buildLocalRuntime() {
  if (process.platform !== "darwin") return null;
  const runtimeRoot = path.join(desktopRoot, "dist", "local-runtime");
  const child = Bun.spawn(["bun", path.join(desktopRoot, "scripts", "build-local-runtime.ts"), process.arch], {
    cwd: workspaceRoot,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error("Failed to prepare the local inference runtime");
  return {
    qwen: path.join(runtimeRoot, "qwen", process.arch, "llama-server"),
    bonsai: path.join(runtimeRoot, "bonsai", process.arch, "llama-server"),
  };
}

async function main() {
  const buildOnly = process.argv.includes("--build-only");

  rmSync(devRoot, { recursive: true, force: true });
  mkdirSync(devSrc, { recursive: true });
  mkdirSync(devAssets, { recursive: true });

  await Promise.all([
    buildEntry(path.join(desktopRoot, "src", "main", "index.ts"), path.join(devSrc, "main.js"), "esm"),
    buildEntry(path.join(desktopRoot, "src", "preload", "index.ts"), path.join(devSrc, "preload.cjs"), "cjs"),
    buildRenderer(),
    copyRuntimeFiles(),
  ]);

  const [trayIconPath, inputTapPath, localRuntimePaths] = await Promise.all([
    copyTrayIcon(),
    buildNativeInputTap(),
    buildLocalRuntime(),
  ]);
  if (buildOnly) {
    console.log(`Built desktop dev app at ${devRoot}`);
    return;
  }

  const child = Bun.spawn(["bunx", "electron", devRoot], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      TAB_PRELOAD_PATH: path.join(devSrc, "preload.cjs"),
      TAB_APP_RENDERER_PATH: appRendererHtmlPath,
      TAB_OVERLAY_RENDERER_PATH: overlayRendererHtmlPath,
      TAB_TRAY_ICON_PATH: trayIconPath,
      ...(inputTapPath ? { TAB_INPUT_TAP_PATH: inputTapPath } : {}),
      ...(localRuntimePaths ? {
        TAB_LOCAL_INFERENCE_EXECUTABLE: localRuntimePaths.qwen,
        TAB_BONSAI_INFERENCE_EXECUTABLE: localRuntimePaths.bonsai,
      } : {}),
      TAB_DEVICE_ID: env.TAB_DEVICE_ID,
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
