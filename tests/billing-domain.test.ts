import { describe, expect, it } from "bun:test";
import {
  countAcceptedWords,
  getAllowancePeriods,
  getPlanCapabilities,
  isPaidPlanId,
  isPlanId,
  planCapabilities,
  projectBillingStatus,
  shouldCountDeepComplete,
} from "../packages/billing/src/index.ts";

describe("local-first plan capabilities", () => {
  it("defines Free, Pro, and Max as the launch plans", () => {
    expect(Object.keys(planCapabilities)).toEqual(["free", "pro", "max"]);
    expect(isPlanId("free")).toBe(true);
    expect(isPlanId("pro")).toBe(true);
    expect(isPlanId("max")).toBe(true);
    expect(isPaidPlanId("free")).toBe(false);
    expect(isPaidPlanId("pro")).toBe(true);
    expect(isPaidPlanId("max")).toBe(true);
  });

  it("keeps local and Deep Complete allowances independent", () => {
    expect(planCapabilities.free.localAcceptedWordsPerDay).toBe(100);
    expect(planCapabilities.free.deepCompletesPerMonth).toBe(10);
    expect(planCapabilities.pro.localAcceptedWordsPerDay).toBeNull();
    expect(planCapabilities.pro.deepCompletesPerMonth).toBe(300);
    expect(planCapabilities.max.localAcceptedWordsPerDay).toBeNull();
    expect(planCapabilities.max.deepCompletesPerMonth).toBe(1_000);
  });

  it("defines launch pricing, devices, and paid capabilities", () => {
    expect(planCapabilities.free.personalDeviceLimit).toBe(1);
    expect(planCapabilities.pro.personalDeviceLimit).toBe(3);
    expect(planCapabilities.pro.monthlyPriceUsd).toBe(10);
    expect(planCapabilities.max.monthlyPriceUsd).toBe(20);
    expect(planCapabilities.max.personalDeviceLimit).toBe(3);
    expect(planCapabilities.free.continuousMemoryExtraction).toBe(false);
    expect(planCapabilities.pro.continuousMemoryExtraction).toBe(true);
    expect(planCapabilities.max.continuousMemoryExtraction).toBe(true);
  });
});

describe("Accepted Word counting", () => {
  it("counts words after insertion without counting punctuation or emoji", () => {
    expect(countAcceptedWords("Hello, world! 👋")).toBe(2);
    expect(countAcceptedWords("... — 👩‍💻")).toBe(0);
  });

  it("keeps contractions word-like and supports multilingual text", () => {
    expect(countAcceptedWords("don't stop")).toBe(2);
    expect(countAcceptedWords("你好世界")).toBeGreaterThan(0);
    expect(countAcceptedWords("Café déjà vu 123")).toBe(3);
  });
});

describe("Deep Complete accounting", () => {
  it("counts only a returned explicit Suggestion", () => {
    expect(shouldCountDeepComplete(1)).toBe(true);
    expect(shouldCountDeepComplete(0)).toBe(false);
  });
});

describe("billing status projection", () => {
  it("uses an explicit local day and an account-authoritative UTC month", () => {
    expect(
      getAllowancePeriods({
        now: new Date("2026-12-31T23:30:00.000Z"),
        localDay: "2027-01-01",
        localResetAt: new Date("2027-01-02T08:00:00.000Z"),
      }),
    ).toEqual({
      localAcceptedWords: {
        period: "2027-01-01",
        resetAt: "2027-01-02T08:00:00.000Z",
      },
      deepCompletes: {
        period: "2026-12",
        resetAt: "2027-01-01T00:00:00.000Z",
      },
    });
  });

  it("degrades expired cached paid facts to Free and resets stale allowances", () => {
    const status = projectBillingStatus({
      entitlement: {
        planId: "pro",
        source: "paid",
        effectiveEnd: "2026-07-01T00:00:00.000Z",
      },
      now: new Date("2026-07-13T12:00:00.000Z"),
      localDay: "2026-07-13",
      localResetAt: new Date("2026-07-14T07:00:00.000Z"),
      localAcceptedWords: { period: "2026-07-12", used: 80 },
      deepCompletes: { period: "2026-06", used: 200 },
      activeDevices: 2,
    });

    expect(status).toMatchObject({
      planId: "free",
      entitlementSource: "free",
      capabilities: getPlanCapabilities("free"),
      localAcceptedWords: {
        period: "2026-07-13",
        used: 0,
        limit: 100,
        remaining: 100,
        resetAt: "2026-07-14T07:00:00.000Z",
        exhausted: false,
      },
      deepCompletes: {
        period: "2026-07",
        used: 0,
        limit: 10,
        remaining: 10,
        resetAt: "2026-08-01T00:00:00.000Z",
        exhausted: false,
      },
      devices: { active: 2, limit: 1, canLink: false },
      upgradeUrl: "/pricing",
    });
  });

  it("projects paid capabilities while cached access remains effective", () => {
    const status = projectBillingStatus({
      entitlement: {
        planId: "max",
        source: "paid",
        effectiveEnd: "2026-08-01T00:00:00.000Z",
      },
      now: new Date("2026-07-13T12:00:00.000Z"),
      localDay: "2026-07-13",
      localResetAt: new Date("2026-07-14T07:00:00.000Z"),
      localAcceptedWords: { period: "2026-07-13", used: 120 },
      deepCompletes: { period: "2026-07", used: 400 },
      activeDevices: 1,
    });

    expect(status.planId).toBe("max");
    expect(status.capabilities).toEqual(getPlanCapabilities("max"));
    expect(status.localAcceptedWords.limit).toBeNull();
    expect(status.deepCompletes.remaining).toBe(600);
    expect(status.accessEndsAt).toBe("2026-08-01T00:00:00.000Z");
  });

  it("does not move a cached local allowance backward after a clock rollback", () => {
    const status = projectBillingStatus({
      entitlement: { planId: "free", source: "free" },
      now: new Date("2026-07-12T12:00:00.000Z"),
      localDay: "2026-07-12",
      localResetAt: new Date("2026-07-13T07:00:00.000Z"),
      localAcceptedWords: {
        period: "2026-07-13",
        used: 80,
        resetAt: "2026-07-14T07:00:00.000Z",
      },
      deepCompletes: { period: "2026-07", used: 0 },
      activeDevices: 1,
    });

    expect(status.localAcceptedWords).toMatchObject({
      period: "2026-07-13",
      used: 80,
      remaining: 20,
      resetAt: "2026-07-14T07:00:00.000Z",
    });
  });
});
