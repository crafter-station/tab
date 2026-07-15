import path from "node:path";

export const LOCAL_RUNTIME_ARCHITECTURES = ["arm64", "x64"] as const;

export type LocalRuntimeArchitecture =
  (typeof LOCAL_RUNTIME_ARCHITECTURES)[number];

type LocalRuntimeRelease = {
  readonly repository: string;
  readonly release: string;
  readonly directory: string;
  readonly artifacts: Record<
    LocalRuntimeArchitecture,
    { readonly fileName: string; readonly sha256: string }
  >;
};

export const LOCAL_RUNTIME_RELEASES = {
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
} as const satisfies Record<string, LocalRuntimeRelease>;

export type LocalRuntimeName = keyof typeof LOCAL_RUNTIME_RELEASES;

export function requireLocalRuntimeArchitecture(
  architecture: string,
): LocalRuntimeArchitecture {
  if (architecture === "arm64" || architecture === "x64") {
    return architecture;
  }
  throw new Error(`Unsupported local runtime architecture: ${architecture}`);
}

export function getLocalRuntimeExecutablePath(
  runtimeRoot: string,
  runtimeName: LocalRuntimeName,
  architecture: LocalRuntimeArchitecture,
): string {
  return path.join(
    getLocalRuntimeDirectory(runtimeRoot, runtimeName, architecture),
    "llama-server",
  );
}

export function getLocalRuntimeDirectory(
  runtimeRoot: string,
  runtimeName: LocalRuntimeName,
  architecture: LocalRuntimeArchitecture,
): string {
  return path.join(runtimeRoot, runtimeName, architecture);
}
