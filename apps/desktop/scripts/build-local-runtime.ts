import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  LOCAL_RUNTIME_ARCHITECTURES,
  LOCAL_RUNTIME_RELEASES,
  getLocalRuntimeDirectory,
  getLocalRuntimeExecutablePath,
  type LocalRuntimeArchitecture,
  type LocalRuntimeName,
} from "../local-runtime-manifest.ts";

const desktopRoot = path.resolve(import.meta.dir, "..");

async function prepareRuntime(runtimeName: LocalRuntimeName, architecture: LocalRuntimeArchitecture): Promise<void> {
  const runtime = LOCAL_RUNTIME_RELEASES[runtimeName];
  const runtimeRoot = path.join(desktopRoot, "dist", "local-runtime");
  const outputDirectory = getLocalRuntimeDirectory(
    runtimeRoot,
    runtimeName,
    architecture,
  );
  const outputExecutable = getLocalRuntimeExecutablePath(
    runtimeRoot,
    runtimeName,
    architecture,
  );
  if (existsSync(outputExecutable) && existsSync(path.join(outputDirectory, "LICENSE"))) return;

  const artifact = runtime.artifacts[architecture];
  const url = `https://github.com/${runtime.repository}/releases/download/${runtime.release}/${artifact.fileName}`;
  const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "tab-local-runtime-"));
  const archivePath = path.join(temporaryDirectory, artifact.fileName);

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Runtime download failed (${response.status})`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== artifact.sha256) throw new Error("Runtime download failed integrity verification");
    await Bun.write(archivePath, bytes);

    const extractedDirectory = path.join(temporaryDirectory, runtime.directory);
    await Bun.$`tar -xzf ${archivePath} -C ${temporaryDirectory}`.quiet();
    mkdirSync(outputDirectory, { recursive: true });
    for (const fileName of readdirSync(extractedDirectory)) {
      if (fileName === "llama-server" || fileName === "LICENSE" || fileName.endsWith(".dylib")) {
        cpSync(path.join(extractedDirectory, fileName), path.join(outputDirectory, fileName), {
          // Universal packaging merges the x64 and arm64 app trees. Materialize
          // archive symlinks so duplicate dylib link chains cannot collide.
          dereference: true,
        });
      }
    }
    chmodSync(outputExecutable, 0o755);
  } catch (error) {
    rmSync(outputDirectory, { recursive: true, force: true });
    throw error;
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

if (process.platform !== "darwin") {
  console.log("Skipping macOS local inference runtime build on non-macOS platform.");
  process.exit(0);
}

rmSync(path.join(desktopRoot, "dist", "local-runtime", "arm64"), { recursive: true, force: true });
rmSync(path.join(desktopRoot, "dist", "local-runtime", "x64"), { recursive: true, force: true });

const requestedArchitecture = process.argv[2];
const architectures: LocalRuntimeArchitecture[] = requestedArchitecture === "arm64" || requestedArchitecture === "x64"
  ? [requestedArchitecture]
  : [...LOCAL_RUNTIME_ARCHITECTURES];

await Promise.all(
  (Object.keys(LOCAL_RUNTIME_RELEASES) as LocalRuntimeName[]).flatMap((runtimeName) =>
    architectures.map((architecture) => prepareRuntime(runtimeName, architecture))),
);
console.log(`Prepared pinned local inference runtimes for ${architectures.join(" and ")}.`);
