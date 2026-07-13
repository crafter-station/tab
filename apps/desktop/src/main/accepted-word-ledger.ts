import { readFileSync, renameSync, writeFileSync } from "node:fs";

export type AcceptedWordLedgerEvent = {
  readonly acceptanceId: string;
  readonly localDay: string;
  readonly acceptedAt: string;
  readonly wordCount: number;
  readonly characterCount: number;
  readonly synced: boolean;
};

type AcceptedWordLedgerState = {
  readonly version: 1;
  readonly lastObservedDay: string;
  readonly reconciledUsageByDay: Readonly<Record<string, number>>;
  readonly events: readonly AcceptedWordLedgerEvent[];
};

export type AcceptedWordLedgerStorage = {
  load(): unknown;
  save(state: AcceptedWordLedgerState): void;
};

function localDay(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function isLedgerEvent(value: unknown): value is AcceptedWordLedgerEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.acceptanceId === "string" &&
    typeof event.localDay === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(event.localDay) &&
    typeof event.acceptedAt === "string" &&
    Number.isInteger(event.wordCount) &&
    Number(event.wordCount) >= 0 &&
    Number.isInteger(event.characterCount) &&
    Number(event.characterCount) >= 0 &&
    typeof event.synced === "boolean"
  );
}

function normalizeState(value: unknown, day: string): AcceptedWordLedgerState {
  if (!value || typeof value !== "object") {
    return {
      version: 1,
      lastObservedDay: day,
      reconciledUsageByDay: {},
      events: [],
    };
  }
  const state = value as Record<string, unknown>;
  const reconciledUsageByDay = state.reconciledUsageByDay;
  const hasValidReconciledUsage =
    reconciledUsageByDay === undefined ||
    (reconciledUsageByDay !== null &&
      typeof reconciledUsageByDay === "object" &&
      Object.entries(reconciledUsageByDay).every(
        ([key, usage]) =>
          /^\d{4}-\d{2}-\d{2}$/.test(key) &&
          Number.isInteger(usage) &&
          Number(usage) >= 0,
      ));
  if (
    state.version !== 1 ||
    typeof state.lastObservedDay !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(state.lastObservedDay) ||
    !hasValidReconciledUsage ||
    !Array.isArray(state.events) ||
    !state.events.every(isLedgerEvent)
  ) {
    return {
      version: 1,
      lastObservedDay: day,
      reconciledUsageByDay: {},
      events: [],
    };
  }
  return {
    version: 1,
    lastObservedDay: state.lastObservedDay,
    reconciledUsageByDay:
      (reconciledUsageByDay as Record<string, number> | undefined) ?? {},
    events: state.events,
  };
}

export function createMemoryAcceptedWordLedgerStorage(
  initial: unknown = null,
): AcceptedWordLedgerStorage {
  let state = structuredClone(initial);
  return {
    load: () => structuredClone(state),
    save: (next) => {
      state = structuredClone(next);
    },
  };
}

export function createFileAcceptedWordLedgerStorage(
  filePath: string,
): AcceptedWordLedgerStorage {
  return {
    load: () => {
      try {
        return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
      } catch {
        return null;
      }
    },
    save: (state) => {
      const temporaryPath = `${filePath}.tmp`;
      writeFileSync(temporaryPath, JSON.stringify(state), { mode: 0o600 });
      renameSync(temporaryPath, filePath);
    },
  };
}

export function createAcceptedWordLedger(deps: {
  storage: AcceptedWordLedgerStorage;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());
  let state = normalizeState(deps.storage.load(), localDay(now()));

  function observeDay(): string {
    const observed = localDay(now());
    if (observed > state.lastObservedDay) {
      state = {
        ...state,
        lastObservedDay: observed,
        reconciledUsageByDay: {},
        events: state.events.filter(
          (event) => !event.synced || event.localDay === observed,
        ),
      };
      deps.storage.save(state);
    }
    return state.lastObservedDay;
  }

  function getCurrentUsage(): number {
    const day = observeDay();
    const reconciledUsage = state.reconciledUsageByDay[day];
    return state.events.reduce(
      (total, event) =>
        event.localDay === day &&
        (reconciledUsage === undefined || !event.synced)
          ? total + event.wordCount
          : total,
      reconciledUsage ?? 0,
    );
  }

  return {
    getCurrentDay: observeDay,
    getCurrentUsage,
    reconcileUsage(day: string, usage: number): void {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
        !Number.isInteger(usage) ||
        usage < 0
      ) {
        return;
      }
      const current = state.reconciledUsageByDay[day] ?? 0;
      if (usage <= current) return;
      state = {
        ...state,
        reconciledUsageByDay: {
          ...state.reconciledUsageByDay,
          [day]: usage,
        },
      };
      deps.storage.save(state);
    },
    canAccept(limit: number | null): boolean {
      return limit === null || getCurrentUsage() < limit;
    },
    record(
      event: Omit<AcceptedWordLedgerEvent, "localDay" | "synced">,
    ): AcceptedWordLedgerEvent {
      const existing = state.events.find(
        (candidate) => candidate.acceptanceId === event.acceptanceId,
      );
      if (existing) return existing;
      const recorded: AcceptedWordLedgerEvent = {
        ...event,
        localDay: observeDay(),
        synced: false,
      };
      state = { ...state, events: [...state.events, recorded] };
      deps.storage.save(state);
      return recorded;
    },
    getPending(): readonly AcceptedWordLedgerEvent[] {
      return state.events.filter((event) => !event.synced);
    },
    markSynced(acceptanceId: string): void {
      let changed = false;
      const events = state.events.map((event) => {
        if (event.acceptanceId !== acceptanceId || event.synced) return event;
        changed = true;
        return { ...event, synced: true };
      });
      if (!changed) return;
      state = {
        ...state,
        events: events.filter(
          (event) => !event.synced || event.localDay === state.lastObservedDay,
        ),
      };
      deps.storage.save(state);
    },
  };
}

export type AcceptedWordLedger = ReturnType<typeof createAcceptedWordLedger>;
