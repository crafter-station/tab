import type { MemoryExtractionCounts, MemoryExtractionRequest } from "@tab/contracts";
import {
  MEMORY_EXTRACTION_WINDOW_POLICY,
  getOldestMemoryExtractionTimestampMs,
  totalMemoryExtractionCharacters,
} from "@tab/memory-policy";
import type { MemoryExtractionAppendInput, MemoryExtractionEntry, MemoryExtractionWindow } from "./memory-extraction-window.ts";

export type MemoryExtractionDispatchClient = {
  readonly extractMemory: (request: MemoryExtractionRequest) => Promise<MemoryExtractionCounts>;
};

export type MemoryExtractionDispatcherDependencies<TTimer = ReturnType<typeof setTimeout>> = {
  readonly window: MemoryExtractionWindow;
  readonly client: MemoryExtractionDispatchClient;
  readonly clientMetadata?: MemoryExtractionRequest["clientMetadata"];
  readonly now?: () => Date;
  readonly createBatchId?: () => string;
  readonly setTimeout?: (callback: () => void, delayMs: number) => TTimer;
  readonly clearTimeout?: (timer: TTimer) => void;
  readonly idleMs?: number;
  readonly minIdleCharacters?: number;
  readonly minIdleEntries?: number;
  readonly maxWindowAgeMs?: number;
  readonly maxRetries?: number;
  readonly initialRetryDelayMs?: number;
  readonly failedBatchTtlMs?: number;
};

type PendingBatch = {
  readonly batchId: string;
  readonly entries: readonly MemoryExtractionEntry[];
  readonly createdAtMs: number;
  attempts: number;
};

type FlushReason = "idle" | "max_age" | "manual";

export function createMemoryExtractionDispatcher<TTimer = ReturnType<typeof setTimeout>>(
  deps: MemoryExtractionDispatcherDependencies<TTimer>,
) {
  const now = deps.now ?? (() => new Date());
  const createBatchId = deps.createBatchId ?? (() => crypto.randomUUID());
  const scheduleTimeout = deps.setTimeout ?? ((callback, delayMs) => setTimeout(callback, delayMs) as TTimer);
  const cancelTimeout = deps.clearTimeout ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const idleMs = deps.idleMs ?? MEMORY_EXTRACTION_WINDOW_POLICY.idleMs;
  const minIdleCharacters = deps.minIdleCharacters ?? MEMORY_EXTRACTION_WINDOW_POLICY.minIdleCharacters;
  const minIdleEntries = deps.minIdleEntries ?? MEMORY_EXTRACTION_WINDOW_POLICY.minIdleEntries;
  const maxWindowAgeMs = deps.maxWindowAgeMs ?? MEMORY_EXTRACTION_WINDOW_POLICY.maxAgeMs;
  const maxRetries = deps.maxRetries ?? MEMORY_EXTRACTION_WINDOW_POLICY.maxRetries;
  const initialRetryDelayMs = deps.initialRetryDelayMs ?? MEMORY_EXTRACTION_WINDOW_POLICY.initialRetryDelayMs;
  const failedBatchTtlMs = deps.failedBatchTtlMs ?? MEMORY_EXTRACTION_WINDOW_POLICY.failedBatchTtlMs;
  let idleTimer: TTimer | null = null;
  let maxAgeTimer: TTimer | null = null;
  let retryTimer: TTimer | null = null;
  let pendingBatch: PendingBatch | null = null;
  let inFlight = false;

  function clearTimer(timer: TTimer | null): null {
    if (timer !== null) cancelTimeout(timer);
    return null;
  }

  function hasIdleThreshold(entries: readonly MemoryExtractionEntry[]): boolean {
    return entries.length >= minIdleEntries || totalMemoryExtractionCharacters(entries) >= minIdleCharacters;
  }

  function entryIds(entries: readonly MemoryExtractionEntry[]): string[] {
    return entries.map((entry) => entry.id);
  }

  function clearBatchEntries(batch: PendingBatch): void {
    deps.window.clearEntries(entryIds(batch.entries));
  }

  function hasExhaustedRetries(batch: PendingBatch): boolean {
    return batch.attempts >= maxRetries;
  }

  function hasExpired(batch: PendingBatch): boolean {
    return now().getTime() - batch.createdAtMs >= failedBatchTtlMs;
  }

  function shouldDropFailedBatch(batch: PendingBatch): boolean {
    return hasExhaustedRetries(batch) || hasExpired(batch);
  }

  function scheduleRetry(batch: PendingBatch): void {
    const retryDelayMs = initialRetryDelayMs * 2 ** (batch.attempts - 1);
    retryTimer = scheduleTimeout(() => {
      retryTimer = null;
      void attemptPendingBatch();
    }, retryDelayMs);
  }

  function buildRequest(batch: PendingBatch): MemoryExtractionRequest {
    if (deps.clientMetadata) {
      return {
        batchId: batch.batchId,
        entries: [...batch.entries],
        clientMetadata: deps.clientMetadata,
      };
    }

    return {
      batchId: batch.batchId,
      entries: [...batch.entries],
    };
  }

  function scheduleIdleFlush(): void {
    idleTimer = scheduleTimeout(() => {
      idleTimer = null;
      void flush("idle");
    }, idleMs);
  }

  function scheduleMaxAgeFlush(entries: readonly MemoryExtractionEntry[]): void {
    const oldestTimestampMs = getOldestMemoryExtractionTimestampMs(entries);
    const delayMs = Math.max(0, oldestTimestampMs + maxWindowAgeMs - now().getTime());

    maxAgeTimer = scheduleTimeout(() => {
      maxAgeTimer = null;
      void flush("max_age");
    }, delayMs);
  }

  function scheduleFlush(): void {
    if (pendingBatch || inFlight) return;

    const entries = deps.window.getEntries();
    idleTimer = clearTimer(idleTimer);
    maxAgeTimer = clearTimer(maxAgeTimer);
    if (entries.length === 0) return;

    if (hasIdleThreshold(entries)) scheduleIdleFlush();
    scheduleMaxAgeFlush(entries);
  }

  async function attemptPendingBatch(): Promise<void> {
    const batch = pendingBatch;
    if (!batch || inFlight) return;

    inFlight = true;
    batch.attempts += 1;

    try {
      await deps.client.extractMemory(buildRequest(batch));
      clearBatchEntries(batch);
      pendingBatch = null;
    } catch {
      if (shouldDropFailedBatch(batch)) {
        clearBatchEntries(batch);
        pendingBatch = null;
      } else {
        scheduleRetry(batch);
      }
    } finally {
      inFlight = false;
      if (!pendingBatch) scheduleFlush();
    }
  }

  async function flush(reason: FlushReason): Promise<void> {
    if (pendingBatch || inFlight) return;

    idleTimer = clearTimer(idleTimer);
    maxAgeTimer = clearTimer(maxAgeTimer);

    const entries = deps.window.getEntries();
    if (entries.length === 0) return;
    if (reason === "idle" && !hasIdleThreshold(entries)) {
      scheduleFlush();
      return;
    }

    pendingBatch = {
      batchId: createBatchId(),
      entries,
      createdAtMs: now().getTime(),
      attempts: 0,
    };
    await attemptPendingBatch();
  }

  function append(input: MemoryExtractionAppendInput): boolean {
    const appended = deps.window.append(input);
    if (appended) scheduleFlush();
    return appended;
  }

  function stop(): void {
    idleTimer = clearTimer(idleTimer);
    maxAgeTimer = clearTimer(maxAgeTimer);
    retryTimer = clearTimer(retryTimer);
  }

  return {
    append,
    flush: () => flush("manual"),
    stop,
  };
}

export type MemoryExtractionDispatcher = ReturnType<typeof createMemoryExtractionDispatcher>;
