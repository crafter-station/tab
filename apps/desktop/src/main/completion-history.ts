export type CompletionHistoryEntry = {
  readonly id: string;
  readonly input: string;
  readonly output: string;
  readonly latencyMs: number;
  readonly firstTextMs?: number | null;
  readonly promptTokens?: number;
  readonly promptMs?: number;
  readonly predictedTokens?: number;
  readonly predictedMs?: number;
  readonly promptCacheHit?: boolean;
  readonly mode: "local";
  readonly model: string;
  readonly createdAt: string;
};

const MAX_COMPLETION_HISTORY = 100;

type StagedLocalSuggestion = Omit<CompletionHistoryEntry, "id" | "createdAt" | "mode">;

export function createCompletionHistory(
  onChange: (entries: readonly CompletionHistoryEntry[]) => void,
) {
  let entries: CompletionHistoryEntry[] = [];
  const stagedLocalSuggestions = new Map<string, StagedLocalSuggestion>();

  function stageLocalSuggestion(id: string, entry: StagedLocalSuggestion): void {
    stagedLocalSuggestions.set(id, entry);
    if (stagedLocalSuggestions.size > MAX_COMPLETION_HISTORY) {
      const oldestId = stagedLocalSuggestions.keys().next().value;
      if (oldestId) stagedLocalSuggestions.delete(oldestId);
    }
  }

  function acceptLocalSuggestion(id: string): void {
    const entry = stagedLocalSuggestions.get(id);
    if (!entry) return;
    stagedLocalSuggestions.delete(id);
    entries = [
      {
        ...entry,
        id,
        mode: "local" as const,
        createdAt: new Date().toISOString(),
      },
      ...entries,
    ].slice(0, MAX_COMPLETION_HISTORY);
    onChange(entries);
  }

  return {
    stageLocalSuggestion,
    acceptLocalSuggestion,
    getEntries: (): readonly CompletionHistoryEntry[] => entries,
  };
}
