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
  readonly mode: "local" | "cloud";
  readonly model: string;
  readonly createdAt: string;
};

const MAX_COMPLETION_HISTORY = 100;

export function createCompletionHistory(
  onChange: (entries: readonly CompletionHistoryEntry[]) => void,
) {
  let entries: CompletionHistoryEntry[] = [];

  function record(entry: Omit<CompletionHistoryEntry, "id" | "createdAt">): void {
    entries = [
      {
        ...entry,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      },
      ...entries,
    ].slice(0, MAX_COMPLETION_HISTORY);
    onChange(entries);
  }

  return {
    record,
    getEntries: (): readonly CompletionHistoryEntry[] => entries,
  };
}
