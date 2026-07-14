import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const desktopRoot = path.resolve(import.meta.dir, "..");

const runtimes = {
  qwen: {
    repository: "ggml-org/llama.cpp",
    release: "b9910",
    directory: "llama-b9910",
    artifacts: {
      arm64: {
        fileName: "llama-b9910-bin-macos-arm64.tar.gz",
        sha256: "1121afc2b6f019d763fede47a9b7595daac4719589cd9681cc44ed9148fbeadb",
      },
      x64: {
        fileName: "llama-b9910-bin-macos-x64.tar.gz",
        sha256: "b850733ad1659fc17a20390c8c7173af77aced9c6bd8f2578d35593858aff0dc",
      },
    },
  },
  bonsai: {
    repository: "PrismML-Eng/llama.cpp",
    release: "prism-b9591-62061f9",
    directory: "llama-prism-b9591-62061f9",
    artifacts: {
      arm64: {
        fileName: "llama-prism-b9591-62061f9-bin-macos-arm64.tar.gz",
        sha256: "e8dd4d8a23704afb02eda7136be3ed05f875c02bb82f413a5e897c9a50f774a8",
      },
      x64: {
        fileName: "llama-prism-b9591-62061f9-bin-macos-x64.tar.gz",
        sha256: "32c37d209bf92d4e9c0ea99baf54d8e46ca0d06d56ecea69f485378bca5deed3",
      },
    },
  },
} as const;

type RuntimeName = keyof typeof runtimes;
type RuntimeArchitecture = keyof (typeof runtimes)[RuntimeName]["artifacts"];

async function prepareRuntime(runtimeName: RuntimeName, architecture: RuntimeArchitecture): Promise<void> {
  const runtime = runtimes[runtimeName];
  const outputDirectory = path.join(desktopRoot, "dist", "local-runtime", runtimeName, architecture);
  const outputExecutable = path.join(outputDirectory, "llama-server");
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
          dereference: false,
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
const architectures: RuntimeArchitecture[] = requestedArchitecture === "arm64" || requestedArchitecture === "x64"
  ? [requestedArchitecture]
  : ["arm64", "x64"];

await Promise.all(
  (Object.keys(runtimes) as RuntimeName[]).flatMap((runtimeName) =>
    architectures.map((architecture) => prepareRuntime(runtimeName, architecture))),
);
console.log(`Prepared pinned local inference runtimes for ${architectures.join(" and ")}.`);
