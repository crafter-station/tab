import { existsSync } from "node:fs";
import { join } from "node:path";
import { MAX_SUGGESTION_TOKENS } from "@tab/suggestion-policy";
import type {
  LocalInferenceStatus,
  LocalModelCatalogState,
  LocalModelId,
} from "@tab/contracts";
import type { SuggestionSource } from "./suggestion-source.ts";
import {
  createLocalInferencePrototype,
  QWEN_25_3B_Q4_K_M,
  type LocalInferencePrototypeOptions,
  type LocalInferenceTiming,
  type LocalModelConfiguration,
} from "./local-inference-prototype.ts";

export const BONSAI_8B_Q2_0: LocalModelConfiguration = {
  id: "ternary-bonsai-8b-q2_0",
  modelRevision: "c2aefbeb4b24469cd11579c3384b990404c17a30",
  artifactSha256: "3c8d70470a5d97e5a2b9410ddd899cb740116591462626c60cb2fead6448f60b",
  runtimeVersion: "9591",
  runtimeCommit: "62061f910",
  maxTokens: MAX_SUGGESTION_TOKENS,
  temperature: 0.3,
} as const;

export type LocalModelCatalogEntry = {
  readonly name: string;
  readonly description: string;
  readonly downloadSizeBytes: number;
  readonly fileName: string;
  readonly modelUrl: string;
  readonly modelPath: string;
  readonly executablePath: string;
  readonly requiresCatalogAccess: boolean;
  readonly experimental: boolean;
  readonly recommended: boolean;
  readonly license: string;
  readonly supportSummary: string;
  readonly configuration: LocalModelConfiguration;
};

type LocalInferenceRuntime = {
  start(): Promise<void>;
  downloadModel(options?: { readonly startAfterDownload?: boolean }): Promise<void>;
  verifyInstallation(): Promise<boolean>;
  stop(): void;
  getSuggestion: SuggestionSource;
  getStatus(): LocalInferenceStatus;
  getLastTiming(): LocalInferenceTiming | null;
};

type RuntimeFactory = (options: LocalInferencePrototypeOptions) => LocalInferenceRuntime;

export type LocalModelManagerOptions = {
  readonly entries: readonly LocalModelCatalogEntry[];
  readonly selectedModelId: LocalModelId;
  readonly port?: number;
  readonly getMemories?: LocalInferencePrototypeOptions["getMemories"];
  readonly getCustomWritingInstructions?: LocalInferencePrototypeOptions["getCustomWritingInstructions"];
  readonly onDiagnostic?: LocalInferencePrototypeOptions["onDiagnostic"];
  readonly onStatusChange?: (status: LocalInferenceStatus) => void;
  readonly onCatalogChange?: (state: LocalModelCatalogState) => void;
  readonly onSelectedModelChange?: (modelId: LocalModelId) => void;
  readonly canAccessCatalog?: () => boolean;
  readonly runtimeFactory?: RuntimeFactory;
  readonly modelExists?: (path: string) => boolean;
};

export function createLocalModelManager(options: LocalModelManagerOptions) {
  if (options.entries.length === 0) throw new Error("Local Model Catalog cannot be empty");
  const entries = new Map(options.entries.map((entry) => [entry.configuration.id, entry]));
  if (entries.size !== options.entries.length) throw new Error("Local Model Catalog IDs must be unique");
  const runtimeFactory = options.runtimeFactory ?? createLocalInferencePrototype;
  const modelExists = options.modelExists ?? existsSync;
  const runtimes = new Map<LocalModelId, LocalInferenceRuntime>();
  let selectedModelId = entries.has(options.selectedModelId)
    ? options.selectedModelId
    : options.entries[0]!.configuration.id;

  function requireEntry(modelId: LocalModelId): LocalModelCatalogEntry {
    const entry = entries.get(modelId);
    if (!entry) throw new Error(`Unsupported local model: ${modelId}`);
    return entry;
  }

  function isAvailable(entry: LocalModelCatalogEntry): boolean {
    return !entry.requiresCatalogAccess || Boolean(options.canAccessCatalog?.());
  }

  function requireAvailableEntry(modelId: LocalModelId): LocalModelCatalogEntry {
    const entry = requireEntry(modelId);
    if (!isAvailable(entry)) throw new Error("This local model requires model catalog access");
    return entry;
  }

  function getRuntime(modelId: LocalModelId): LocalInferenceRuntime {
    const existing = runtimes.get(modelId);
    if (existing) return existing;
    const entry = requireEntry(modelId);
    const runtime = runtimeFactory({
      executablePath: entry.executablePath,
      modelPath: entry.modelPath,
      modelUrl: entry.modelUrl,
      model: entry.configuration,
      port: options.port,
      getMemories: options.getMemories,
      getCustomWritingInstructions: options.getCustomWritingInstructions,
      onDiagnostic: options.onDiagnostic,
      onStatusChange: (status) => {
        if (modelId === selectedModelId) options.onStatusChange?.(status);
        options.onCatalogChange?.(getCatalogState());
      },
    });
    runtimes.set(modelId, runtime);
    return runtime;
  }

  function getCatalogState(): LocalModelCatalogState {
    return {
      selectedModelId,
      models: options.entries.map((entry) => ({
        id: entry.configuration.id,
        name: entry.name,
        description: entry.description,
        downloadSizeBytes: entry.downloadSizeBytes,
        selected: entry.configuration.id === selectedModelId,
        downloaded: modelExists(entry.modelPath),
        available: isAvailable(entry),
        requiresCatalogAccess: entry.requiresCatalogAccess,
        experimental: entry.experimental,
        recommended: entry.recommended,
        license: entry.license,
        supportSummary: entry.supportSummary,
        status: runtimes.get(entry.configuration.id)?.getStatus() ?? { status: "stopped" },
      })),
    };
  }

  async function selectModel(modelId: LocalModelId): Promise<void> {
    requireAvailableEntry(modelId);
    if (modelId === selectedModelId) {
      await getRuntime(modelId).start();
      return;
    }
    const nextRuntime = getRuntime(modelId);
    if (!await nextRuntime.verifyInstallation()) {
      throw new Error("The local model or its runtime failed verification");
    }
    getRuntime(selectedModelId).stop();
    selectedModelId = modelId;
    options.onSelectedModelChange?.(modelId);
    options.onCatalogChange?.(getCatalogState());
    options.onStatusChange?.(nextRuntime.getStatus());
    await nextRuntime.start();
  }

  async function downloadModel(modelId: LocalModelId = selectedModelId): Promise<void> {
    requireAvailableEntry(modelId);
    const runtime = getRuntime(modelId);
    await runtime.downloadModel({ startAfterDownload: false });
    if (modelId === selectedModelId) await runtime.start();
    options.onCatalogChange?.(getCatalogState());
  }

  async function reconcileAccess(): Promise<void> {
    if (isAvailable(requireEntry(selectedModelId))) return;
    const fallback = options.entries.find(isAvailable);
    if (!fallback) throw new Error("No local model is available");
    const fallbackId = fallback.configuration.id;
    getRuntime(selectedModelId).stop();
    selectedModelId = fallbackId;
    options.onSelectedModelChange?.(fallbackId);
    options.onCatalogChange?.(getCatalogState());
  }

  async function start(): Promise<void> {
    await reconcileAccess();
    await getRuntime(selectedModelId).start();
  }

  return {
    start,
    stop: () => getRuntime(selectedModelId).stop(),
    selectModel,
    downloadModel,
    getSuggestion: ((snapshot, requestOptions) =>
      getRuntime(selectedModelId).getSuggestion(snapshot, requestOptions)) satisfies SuggestionSource,
    getStatus: (): LocalInferenceStatus => getRuntime(selectedModelId).getStatus(),
    getLastTiming: (): LocalInferenceTiming | null => getRuntime(selectedModelId).getLastTiming(),
    getSelectedModelId: (): LocalModelId => selectedModelId,
    getCatalogState,
    reconcileAccess,
  };
}

export function createDefaultLocalModelCatalog(options: {
  readonly modelsDirectory: string;
  readonly qwenModelPath?: string;
  readonly qwenModelUrl?: string;
  readonly qwenExecutablePath: string;
  readonly bonsaiExecutablePath?: string;
}): readonly LocalModelCatalogEntry[] {
  return [
    {
      name: "Qwen 2.5 3B",
      description: "Balanced model for everyday Automatic Suggestions.",
      downloadSizeBytes: 2_104_932_768,
      fileName: "Qwen2.5-3B-Instruct-Q4_K_M.gguf",
      modelPath: options.qwenModelPath ?? join(options.modelsDirectory, "Qwen2.5-3B-Instruct-Q4_K_M.gguf"),
      modelUrl: options.qwenModelUrl
        ?? "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/7dabda4d13d513e3e842b20f0d435c732f172cbe/qwen2.5-3b-instruct-q4_k_m.gguf",
      executablePath: options.qwenExecutablePath,
      requiresCatalogAccess: false,
      experimental: false,
      recommended: true,
      license: "Apache-2.0",
      supportSummary: "Tab's default model for this Mac.",
      configuration: QWEN_25_3B_Q4_K_M,
    },
    {
      name: "Ternary Bonsai 8B",
      description: "Experimental higher-capability model with an efficient 2-bit footprint.",
      downloadSizeBytes: 2_182_184_672,
      fileName: "Ternary-Bonsai-8B-Q2_0.gguf",
      modelPath: join(options.modelsDirectory, "Ternary-Bonsai-8B-Q2_0.gguf"),
      modelUrl: "https://huggingface.co/prism-ml/Ternary-Bonsai-8B-gguf/resolve/c2aefbeb4b24469cd11579c3384b990404c17a30/Ternary-Bonsai-8B-Q2_0.gguf",
      executablePath: options.bonsaiExecutablePath ?? options.qwenExecutablePath,
      requiresCatalogAccess: false,
      experimental: true,
      recommended: false,
      license: "Apache-2.0",
      supportSummary: "Validation is in progress; no Mac hardware tier is supported yet.",
      configuration: BONSAI_8B_Q2_0,
    },
  ];
}
