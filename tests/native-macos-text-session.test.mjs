import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const nativeHelper = readFileSync(new URL("../apps/desktop/native/macos-input-tap.swift", import.meta.url), "utf8");
const typingContext = readFileSync(new URL("../apps/desktop/src/main/typing-context.ts", import.meta.url), "utf8");
const mainProcess = readFileSync(new URL("../apps/desktop/src/main/index.ts", import.meta.url), "utf8");

test("macOS helper emits Accessibility Text Session snapshots accepted by desktop", () => {
  assert.match(nativeHelper, /AXIsProcessTrusted/);
  assert.match(nativeHelper, /kAXFocusedUIElementAttribute/);
  assert.match(nativeHelper, /kAXSelectedTextRangeAttribute/);
  assert.match(nativeHelper, /kAXSelectedTextAttribute/);
  assert.match(nativeHelper, /kAXBoundsForRangeParameterizedAttribute/);
  assert.match(nativeHelper, /"type": "text-session"/);
  assert.match(nativeHelper, /"accessibilityReliability"/);
  assert.match(nativeHelper, /"selectedText"/);
  assert.match(nativeHelper, /emitTextSessionSnapshotIfChanged\(\)/);

  assert.match(typingContext, /readonly selectedText\?: string/);
  assert.match(mainProcess, /snapshot\.selectedText === undefined \|\| typeof snapshot\.selectedText === "string"/);
});
