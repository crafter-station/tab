import { describe, expect, it } from "bun:test";
import {
  BONSAI_8B_Q2_0,
  createDefaultLocalModelCatalog,
  createLocalModelManager,
} from "../apps/desktop/src/main/local-model-catalog.ts";
import type { LocalInferenceStatus } from "../apps/desktop/src/main/local-inference-prototype.ts";

describe("Local Model Catalog", () => {
  it("contains the pinned Qwen and Ternary Bonsai artifacts", () => {
    const catalog = createDefaultLocalModelCatalog({
      modelsDirectory: "/models",
      qwenExecutablePath: "/runtime/llama-server",
      bonsaiExecutablePath: "/runtime/prism-llama-server",
    });

    expect(catalog.map((model) => model.configuration.id)).toEqual([
      "qwen2.5-3b-instruct-q4_k_m",
      "ternary-bonsai-8b-q2_0",
    ]);
    expect(catalog[1]).toMatchObject({
      name: "Ternary Bonsai 8B",
      downloadSizeBytes: 2_182_184_672,
      fileName: "Ternary-Bonsai-8B-Q2_0.gguf",
      executablePath: "/runtime/prism-llama-server",
      configuration: BONSAI_8B_Q2_0,
    });
    expect(catalog[1]?.modelUrl).toContain(
      "/resolve/c2aefbeb4b24469cd11579c3384b990404c17a30/Ternary-Bonsai-8B-Q2_0.gguf",
    );
  });

  it("downloads a model without replacing the selected runtime, then switches explicitly", async () => {
    const entries = createDefaultLocalModelCatalog({
      modelsDirectory: "/models",
      qwenExecutablePath: "/runtime/llama-server",
      bonsaiExecutablePath: "/runtime/prism-llama-server",
    });
    const downloadedPaths = new Set([entries[0]!.modelPath]);
    const qwenId = entries[0]!.configuration.id;
    const bonsaiId = entries[1]!.configuration.id;
    const actions: string[] = [];
    const selections: string[] = [];

    const manager = createLocalModelManager({
      entries,
      selectedModelId: qwenId,
      canAccessCatalog: () => true,
      modelExists: (path) => downloadedPaths.has(path),
      onSelectedModelChange: (modelId) => selections.push(modelId),
      runtimeFactory: (options) => {
        let status: LocalInferenceStatus = { status: "stopped" };
        return {
          start: async () => {
            actions.push(`start:${options.model?.id}`);
            status = { status: "ready", modelId: options.model!.id };
            options.onStatusChange?.(status);
          },
          downloadModel: async () => {
            actions.push(`download:${options.model?.id}`);
            downloadedPaths.add(options.modelPath);
            status = { status: "stopped" };
            options.onStatusChange?.(status);
          },
          verifyInstallation: async () => true,
          stop: () => {
            actions.push(`stop:${options.model?.id}`);
            status = { status: "stopped" };
            options.onStatusChange?.(status);
          },
          getSuggestion: async () => null,
          getStatus: () => status,
          getLastTiming: () => null,
        };
      },
    });

    await manager.start();
    await manager.downloadModel(bonsaiId);

    expect(manager.getSelectedModelId()).toBe(qwenId);
    expect(manager.getCatalogState().models[1]?.downloaded).toBe(true);
    expect(actions).not.toContain(`start:${bonsaiId}`);

    await manager.selectModel(bonsaiId);

    expect(selections).toEqual([bonsaiId]);
    expect(manager.getSelectedModelId()).toBe(bonsaiId);
    expect(actions.slice(-2)).toEqual([
      `stop:${qwenId}`,
      `start:${bonsaiId}`,
    ]);
  });

  it("enforces paid catalog access before downloading or selecting Bonsai", async () => {
    const entries = createDefaultLocalModelCatalog({
      modelsDirectory: "/models",
      qwenExecutablePath: "/runtime/llama-server",
      bonsaiExecutablePath: "/runtime/prism-llama-server",
    });
    const manager = createLocalModelManager({
      entries,
      selectedModelId: entries[0]!.configuration.id,
      canAccessCatalog: () => false,
    });
    const bonsaiId = entries[1]!.configuration.id;

    expect(manager.getCatalogState().models[1]?.available).toBe(false);
    await expect(manager.downloadModel(bonsaiId)).rejects.toThrow("requires model catalog access");
    await expect(manager.selectModel(bonsaiId)).rejects.toThrow("requires model catalog access");
  });

  it("keeps the working selection when another installation fails verification", async () => {
    const entries = createDefaultLocalModelCatalog({
      modelsDirectory: "/models",
      qwenExecutablePath: "/runtime/llama-server",
      bonsaiExecutablePath: "/runtime/prism-llama-server",
    });
    const actions: string[] = [];
    const qwenId = entries[0]!.configuration.id;
    const bonsaiId = entries[1]!.configuration.id;
    const manager = createLocalModelManager({
      entries,
      selectedModelId: qwenId,
      canAccessCatalog: () => true,
      runtimeFactory: (options) => ({
        start: async () => {},
        downloadModel: async () => {},
        verifyInstallation: async () => options.model?.id !== bonsaiId,
        stop: () => actions.push(`stop:${options.model?.id}`),
        getSuggestion: async () => null,
        getStatus: () => ({ status: "stopped" }),
        getLastTiming: () => null,
      }),
    });

    await expect(manager.selectModel(bonsaiId)).rejects.toThrow("failed verification");

    expect(manager.getSelectedModelId()).toBe(qwenId);
    expect(actions).toEqual([]);
  });
});
