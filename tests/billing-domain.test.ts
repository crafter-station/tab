import { describe, expect, it } from "bun:test";
import {
  countAcceptedWords,
  isPlanId,
  planCapabilities,
  shouldCountDeepComplete,
} from "../packages/billing/src/index.ts";

describe("local-first plan capabilities", () => {
  it("defines Free, Pro, and Max as the launch plans", () => {
    expect(Object.keys(planCapabilities)).toEqual(["free", "pro", "max"]);
    expect(isPlanId("free")).toBe(true);
    expect(isPlanId("pro")).toBe(true);
    expect(isPlanId("max")).toBe(true);
  });

  it("keeps local and Deep Complete allowances independent", () => {
    expect(planCapabilities.free.localAcceptedWordsPerDay).toBe(100);
    expect(planCapabilities.free.deepCompletesPerMonth).toBe(10);
    expect(planCapabilities.pro.localAcceptedWordsPerDay).toBeNull();
    expect(planCapabilities.pro.deepCompletesPerMonth).toBe(300);
    expect(planCapabilities.max.localAcceptedWordsPerDay).toBeNull();
    expect(planCapabilities.max.deepCompletesPerMonth).toBe(1_000);
  });

  it("defines the launch trial, pricing, devices, and paid capabilities", () => {
    expect(planCapabilities.free.trialDays).toBe(30);
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
