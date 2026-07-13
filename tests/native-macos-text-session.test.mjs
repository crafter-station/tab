import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const nativeHelper = readFileSync(new URL("../apps/desktop/native/macos-input-tap.swift", import.meta.url), "utf8");
const typingContext = readFileSync(new URL("../apps/desktop/src/main/typing-context.ts", import.meta.url), "utf8");
const desktopEventIngress = readFileSync(new URL("../apps/desktop/src/main/desktop-event-ingress.ts", import.meta.url), "utf8");

test("macOS helper emits Accessibility Text Session snapshots accepted by desktop", () => {
  assert.match(nativeHelper, /AXIsProcessTrusted/);
  assert.match(nativeHelper, /kAXFocusedUIElementAttribute/);
  assert.match(nativeHelper, /kAXSelectedTextRangeAttribute/);
  assert.match(nativeHelper, /kAXSelectedTextAttribute/);
  assert.match(nativeHelper, /kAXBoundsForRangeParameterizedAttribute/);
  assert.match(nativeHelper, /AXSelectedTextMarkerRange/);
  assert.match(nativeHelper, /AXBoundsForTextMarkerRange/);
  assert.match(nativeHelper, /"type": "text-session"/);
  assert.match(nativeHelper, /"accessibilityReliability"/);
  assert.match(nativeHelper, /"selectedText"/);
  assert.match(nativeHelper, /"terminalContents"/);
  assert.match(nativeHelper, /"terminalTitle"/);
  assert.match(nativeHelper, /kAXStringForRangeParameterizedAttribute/);
  assert.match(nativeHelper, /emitTextSessionSnapshotIfChanged\(\)/);

  assert.match(typingContext, /readonly selectedText\?: string/);
  assert.match(desktopEventIngress, /snapshot\.selectedText === undefined \|\| typeof snapshot\.selectedText === "string"/);
});

test("macOS helper captures terminal paste and invalidates uncertain edits", () => {
  assert.match(nativeHelper, /CGEventType\.flagsChanged/);
  assert.match(nativeHelper, /"type": "paste", "text": text/);
  assert.match(nativeHelper, /"type": "context-invalidated", "message": "submission"/);
  assert.match(nativeHelper, /"type": "context-invalidated", "message": "navigation_or_unknown_key"/);
  assert.match(nativeHelper, /CGEventType\.leftMouseDown/);
});

test("macOS helper does not turn passive Ghostty output into typing activity", () => {
  assert.match(
    nativeHelper,
    /func emitPolledContextSnapshots\(\)[\s\S]*activeWindowSnapshot\(\)\?\.bundleId != "com\.mitchellh\.ghostty"[\s\S]*emitTextSessionSnapshotIfChanged\(\)/,
  );
  assert.match(
    nativeHelper,
    /Timer\.scheduledTimer[\s\S]*emitPolledContextSnapshots\(\)/,
  );
});

test("macOS helper reserves Option+Tab for suggestion acceptance", () => {
  assert.match(
    nativeHelper,
    /if keyCode == 48 \{\s+if isGhostty && !flags\.contains\(\.maskAlternate\) \{\s+emit\(\["type": "context-invalidated", "message": "tab"\]\)/,
  );
});
