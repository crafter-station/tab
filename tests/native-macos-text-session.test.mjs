import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const nativeHelper = readFileSync(new URL("../apps/desktop/native/macos-input-tap.swift", import.meta.url), "utf8");
const typingContext = readFileSync(new URL("../apps/desktop/src/main/typing-context.ts", import.meta.url), "utf8");
const desktopEventIngress = readFileSync(new URL("../apps/desktop/src/main/desktop-event-ingress.ts", import.meta.url), "utf8");
const nativeHelperPath = new URL("../apps/desktop/native/macos-input-tap.swift", import.meta.url);
const isMacOS = process.platform === "darwin";
let nativeContractExecutable;

if (isMacOS) {
  const nativeContractDirectory = mkdtempSync(join(tmpdir(), "tab-native-contract-"));
  nativeContractExecutable = join(nativeContractDirectory, "macos-input-tap");
  execFileSync("swiftc", [nativeHelperPath.pathname, "-o", nativeContractExecutable]);
  process.on("exit", () => rmSync(nativeContractDirectory, { recursive: true, force: true }));
}

function runExplicitActionContract(scenario) {
  const output = execFileSync(nativeContractExecutable, ["--explicit-action-contract", scenario], { encoding: "utf8" });
  return output.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function runSelectionContract(scenario) {
  return JSON.parse(execFileSync(nativeContractExecutable, ["--selection-contract", scenario], { encoding: "utf8" }));
}

function functionBody(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `Missing ${signature}`);
  const openingBrace = source.indexOf("{", start);
  let depth = 0;

  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, index);
  }

  assert.fail(`Unterminated ${signature}`);
}

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
  assert.match(nativeHelper, /emitTextSessionSnapshotIfChanged\(/);

  assert.match(typingContext, /readonly selectedText\?: string/);
  assert.match(desktopEventIngress, /snapshot\.selectedText === undefined \|\| typeof snapshot\.selectedText === "string"/);
});

test("macOS explicit actions publish a fresh reliable Text Session before suggest-now", { skip: !isMacOS }, () => {
  const events = runExplicitActionContract("reliable");
  assert.deepEqual(events.map((event) => event.type), ["text-session", "suggest-now"]);
  assert.equal(events[0].snapshot.accessibilityReliability, "reliable");
  assert.deepEqual(events[0].snapshot.activeApplication, {
    bundleId: "com.example.editor",
    windowId: "window:7",
  });
});

test("macOS explicit actions fail closed at the process boundary", { skip: !isMacOS }, () => {
  for (const scenario of ["unavailable", "unreliable", "inconsistent", "identity-disagreement", "missing-identity"]) {
    const events = runExplicitActionContract(scenario);
    assert.equal(events.some((event) => event.type === "suggest-now"), false, scenario);
  }
});

test("macOS helper executable proves selected text and range consistency without clipboard reads", { skip: !isMacOS }, () => {
  const selection = runSelectionContract("selection");
  assert.deepEqual(selection.snapshot.selectedRange, { location: 2, length: 5 });
  assert.equal(selection.snapshot.selectedText, "hello");
  assert.equal(selection.reliableExplicitTarget, true);

  const caret = runSelectionContract("caret");
  assert.deepEqual(caret.snapshot.selectedRange, { location: 7, length: 0 });
  assert.equal(caret.snapshot.selectedText, "");
  assert.equal(caret.reliableExplicitTarget, true);

  const contractBody = functionBody(nativeHelper, "func runSelectionContract");
  assert.doesNotMatch(contractBody, /NSPasteboard|clipboard/i);
});

test("macOS helper executable keeps missing or inconsistent selection state unsafe", { skip: !isMacOS }, () => {
  const unavailable = runSelectionContract("unavailable");
  assert.equal(unavailable.snapshot.selectedRange, null);
  assert.equal("selectedText" in unavailable.snapshot, false);
  assert.equal(unavailable.reliableExplicitTarget, false);

  for (const scenario of ["text-without-range", "range-without-text", "inconsistent"]) {
    assert.equal(runSelectionContract(scenario).reliableExplicitTarget, false, scenario);
  }
});

test("macOS helper captures terminal paste and invalidates uncertain edits", () => {
  assert.match(nativeHelper, /CGEventType\.flagsChanged/);
  assert.match(nativeHelper, /"type": "paste", "text": text/);
  assert.match(nativeHelper, /"type": "context-invalidated", "message": "submission"/);
  assert.match(nativeHelper, /"type": "context-invalidated", "message": "navigation_or_unknown_key"/);
  assert.match(nativeHelper, /CGEventType\.leftMouseDown/);
});

test("macOS helper does not invalidate Ghostty when a mouse click switches apps", () => {
  const invalidationBody = functionBody(nativeHelper, "func invalidateGhosttyClickIfStillActive");
  assert.match(invalidationBody, /DispatchQueue\.main\.asyncAfter/);
  assert.match(invalidationBody, /guard activeWindowSnapshot\(\) == clickedWindow else \{ return \}/);
  assert.match(invalidationBody, /"message": "mouse_input"/);
});

test("macOS helper does not turn passive Ghostty output into typing activity", () => {
  assert.match(
    nativeHelper,
    /func emitPolledContextSnapshots\(\)[\s\S]*activeWindow\?\.bundleId != "com\.mitchellh\.ghostty"[\s\S]*emitTextSessionSnapshotIfChanged\(activeWindow: activeWindow\)/,
  );
  assert.match(
    nativeHelper,
    /Timer\.scheduledTimer[\s\S]*emitPolledContextSnapshots\(\)/,
  );
});

test("macOS helper discovers the active window only once per polling cycle", () => {
  const pollingBody = functionBody(nativeHelper, "func emitPolledContextSnapshots()");
  assert.equal(pollingBody.match(/activeWindowSnapshot\(\)/g)?.length, 1);
  assert.match(pollingBody, /emitActiveWindowIfChanged\(snapshot:/);
  assert.match(pollingBody, /emitTextSessionSnapshotIfChanged\(activeWindow:/);
});

test("macOS helper reuses active-window discovery within each input event", () => {
  const callbackStart = nativeHelper.indexOf("let callback: CGEventTapCallBack");
  const callbackEnd = nativeHelper.indexOf("guard let eventTap", callbackStart);
  const callbackBody = nativeHelper.slice(callbackStart, callbackEnd);

  assert.equal(callbackBody.match(/activeWindowSnapshot\(\)/g)?.length, 2);
  assert.doesNotMatch(callbackBody, /emitActiveWindowIfChanged\(\)/);
  assert.doesNotMatch(callbackBody, /emitTextSessionSnapshotIfChanged\(\)/);
});

test("macOS helper reserves Option+Tab for suggestion acceptance", () => {
  assert.match(
    nativeHelper,
    /if keyCode == 48 \{\s+if isGhostty && !flags\.contains\(\.maskAlternate\) \{\s+emit\(\["type": "context-invalidated", "message": "tab"\]\)/,
  );
});
