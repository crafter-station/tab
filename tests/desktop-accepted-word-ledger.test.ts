import { describe, expect, it } from "bun:test";
import {
  createAcceptedWordLedger,
  createMemoryAcceptedWordLedgerStorage,
} from "../apps/desktop/src/main/accepted-word-ledger.ts";

describe("Accepted Word ledger", () => {
  it("records a cap-crossing Acceptance in full, then blocks later Free acceptances", () => {
    const storage = createMemoryAcceptedWordLedgerStorage();
    const ledger = createAcceptedWordLedger({
      storage,
      now: () => new Date(2026, 6, 12, 12),
    });

    ledger.record({
      acceptanceId: "accept-1",
      acceptedAt: "2026-07-12T16:00:00.000Z",
      wordCount: 98,
      characterCount: 300,
    });
    expect(ledger.canAccept(100)).toBe(true);

    ledger.record({
      acceptanceId: "accept-2",
      acceptedAt: "2026-07-12T16:01:00.000Z",
      wordCount: 4,
      characterCount: 20,
    });
    expect(ledger.getCurrentUsage()).toBe(102);
    expect(ledger.canAccept(100)).toBe(false);
  });

  it("survives restart and synchronizes each Acceptance idempotently", () => {
    const storage = createMemoryAcceptedWordLedgerStorage();
    const first = createAcceptedWordLedger({
      storage,
      now: () => new Date(2026, 6, 12, 12),
    });
    first.record({
      acceptanceId: "accept-1",
      acceptedAt: "2026-07-12T12:00:00.000Z",
      wordCount: 2,
      characterCount: 11,
    });
    first.record({
      acceptanceId: "accept-1",
      acceptedAt: "2026-07-12T12:00:00.000Z",
      wordCount: 2,
      characterCount: 11,
    });

    const restarted = createAcceptedWordLedger({
      storage,
      now: () => new Date(2026, 6, 12, 13),
    });
    expect(restarted.getCurrentUsage()).toBe(2);
    expect(restarted.getPending()).toHaveLength(1);
    restarted.markSynced("accept-1");
    expect(restarted.getPending()).toEqual([]);
  });

  it("combines reconciled account usage with only unsynced local events", () => {
    const storage = createMemoryAcceptedWordLedgerStorage();
    const ledger = createAcceptedWordLedger({
      storage,
      now: () => new Date(2026, 6, 12, 12),
    });
    ledger.record({
      acceptanceId: "accept-synced",
      acceptedAt: "2026-07-12T12:00:00.000Z",
      wordCount: 10,
      characterCount: 50,
    });
    ledger.reconcileUsage("2026-07-12", 90);
    ledger.markSynced("accept-synced");
    ledger.record({
      acceptanceId: "accept-pending",
      acceptedAt: "2026-07-12T12:01:00.000Z",
      wordCount: 12,
      characterCount: 60,
    });

    expect(ledger.getCurrentUsage()).toBe(102);
    expect(ledger.canAccept(100)).toBe(false);

    const restarted = createAcceptedWordLedger({
      storage,
      now: () => new Date(2026, 6, 12, 13),
    });
    expect(restarted.getCurrentUsage()).toBe(102);
  });

  it("keeps reconciled usage monotonic and allows unlimited plans", () => {
    const ledger = createAcceptedWordLedger({
      storage: createMemoryAcceptedWordLedgerStorage(),
      now: () => new Date(2026, 6, 12, 12),
    });
    ledger.reconcileUsage("2026-07-12", 120);
    ledger.reconcileUsage("2026-07-12", 20);

    expect(ledger.getCurrentUsage()).toBe(120);
    expect(ledger.canAccept(100)).toBe(false);
    expect(ledger.canAccept(null)).toBe(true);
  });

  it("resets on a later local day and never moves backward after clock rollback", () => {
    let now = new Date(2026, 6, 12, 23, 59);
    const ledger = createAcceptedWordLedger({
      storage: createMemoryAcceptedWordLedgerStorage(),
      now: () => now,
    });
    ledger.record({
      acceptanceId: "accept-1",
      acceptedAt: now.toISOString(),
      wordCount: 100,
      characterCount: 500,
    });
    expect(ledger.canAccept(100)).toBe(false);

    now = new Date(2026, 6, 13, 0, 1);
    expect(ledger.getCurrentUsage()).toBe(0);
    now = new Date(2026, 6, 11, 12);
    expect(ledger.getCurrentDay()).toBe("2026-07-13");
  });

  it("tolerates corrupt persisted state", () => {
    const ledger = createAcceptedWordLedger({
      storage: { load: () => null, save: () => undefined },
      now: () => new Date(2026, 6, 12, 12),
    });
    expect(ledger.getCurrentUsage()).toBe(0);
    expect(ledger.canAccept(100)).toBe(true);
  });

  it("keeps pending Acceptances scoped to the active account", () => {
    let userId: string | undefined = "user-a";
    const storage = createMemoryAcceptedWordLedgerStorage();
    const ledger = createAcceptedWordLedger({
      storage,
      getUserId: () => userId,
      now: () => new Date(2026, 6, 12, 12),
    });
    ledger.record({
      acceptanceId: "accept-a",
      acceptedAt: "2026-07-12T12:00:00.000Z",
      wordCount: 8,
      characterCount: 40,
    });

    userId = "user-b";
    expect(ledger.getCurrentUsage()).toBe(0);
    expect(ledger.getPending()).toEqual([]);
    ledger.record({
      acceptanceId: "accept-b",
      acceptedAt: "2026-07-12T12:01:00.000Z",
      wordCount: 3,
      characterCount: 15,
    });
    expect(ledger.getPending().map((event) => event.acceptanceId)).toEqual([
      "accept-b",
    ]);

    userId = "user-a";
    expect(ledger.getCurrentUsage()).toBe(8);
    expect(ledger.getPending().map((event) => event.acceptanceId)).toEqual([
      "accept-a",
    ]);
  });
});
