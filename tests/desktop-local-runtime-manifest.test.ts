import { describe, expect, test } from "bun:test";
import {
  LOCAL_RUNTIME_ARCHITECTURES,
  LOCAL_RUNTIME_RELEASES,
  getLocalRuntimeDirectory,
  getLocalRuntimeExecutablePath,
  requireLocalRuntimeArchitecture,
} from "../apps/desktop/local-runtime-manifest.ts";

describe("desktop local runtime manifest", () => {
  test("projects the shared packaged executable layout", () => {
    expect(getLocalRuntimeDirectory("/runtime", "qwen", "arm64")).toBe(
      "/runtime/qwen/arm64",
    );
    expect(getLocalRuntimeExecutablePath("/runtime", "qwen", "arm64")).toBe(
      "/runtime/qwen/arm64/llama-server",
    );
    expect(getLocalRuntimeExecutablePath("/runtime", "bonsai", "x64")).toBe(
      "/runtime/bonsai/x64/llama-server",
    );
  });

  test("rejects architectures without a pinned runtime", () => {
    expect(requireLocalRuntimeArchitecture("arm64")).toBe("arm64");
    expect(() => requireLocalRuntimeArchitecture("ia32")).toThrow(
      "Unsupported local runtime architecture: ia32",
    );
  });

  test("pins a verified artifact for every runtime and architecture", () => {
    expect(Object.keys(LOCAL_RUNTIME_RELEASES)).toEqual(["qwen", "bonsai"]);

    for (const runtime of Object.values(LOCAL_RUNTIME_RELEASES)) {
      expect(runtime.repository).not.toBeEmpty();
      expect(runtime.release).not.toBeEmpty();
      expect(runtime.directory).not.toBeEmpty();
      for (const architecture of LOCAL_RUNTIME_ARCHITECTURES) {
        expect(runtime.artifacts[architecture].fileName).toEndWith(
          `macos-${architecture}.tar.gz`,
        );
        expect(runtime.artifacts[architecture].sha256).toMatch(/^[a-f0-9]{64}$/);
      }
    }
  });
});
