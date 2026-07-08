import AppKit
import ApplicationServices
import Foundation

func emit(_ payload: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return }
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
}

struct ActiveWindowSnapshot: Equatable {
  let bundleId: String
  let windowId: String
}

func activeWindowSnapshot() -> ActiveWindowSnapshot? {
  guard let app = NSWorkspace.shared.frontmostApplication,
        let bundleId = app.bundleIdentifier else {
    return nil
  }

  let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
  guard let windowInfoList = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
    return ActiveWindowSnapshot(bundleId: bundleId, windowId: "app:\(app.processIdentifier)")
  }

  for windowInfo in windowInfoList {
    guard let ownerPid = windowInfo[kCGWindowOwnerPID as String] as? pid_t,
          ownerPid == app.processIdentifier,
          let layer = windowInfo[kCGWindowLayer as String] as? Int,
          layer == 0,
          let windowNumber = windowInfo[kCGWindowNumber as String] as? UInt32 else {
      continue
    }
    return ActiveWindowSnapshot(bundleId: bundleId, windowId: "window:\(windowNumber)")
  }

  return ActiveWindowSnapshot(bundleId: bundleId, windowId: "app:\(app.processIdentifier)")
}

var lastActiveWindowSnapshot: ActiveWindowSnapshot?
var lastTextSessionSnapshotKey: String?
let textSessionContextLimit = 500

typealias TextSessionPayload = [String: Any]

func emitActiveWindowIfChanged() {
  guard let snapshot = activeWindowSnapshot() else { return }
  if snapshot == lastActiveWindowSnapshot { return }
  lastActiveWindowSnapshot = snapshot
  emit(["type": "active-app", "bundleId": snapshot.bundleId, "windowId": snapshot.windowId])
}

func copyAXAttribute(_ element: AXUIElement, _ attribute: String) -> Any? {
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else {
    return nil
  }
  return value
}

func stringAXAttribute(_ element: AXUIElement, _ attribute: String) -> String? {
  return copyAXAttribute(element, attribute) as? String
}

func focusedAXElement(for app: NSRunningApplication) -> AXUIElement? {
  let appElement = AXUIElementCreateApplication(app.processIdentifier)
  return copyAXAttribute(appElement, kAXFocusedUIElementAttribute as String) as? AXUIElement
}

func selectedTextRange(from element: AXUIElement) -> CFRange? {
  guard let value = copyAXAttribute(element, kAXSelectedTextRangeAttribute as String) else { return nil }
  guard let axValue = value as? AXValue else { return nil }
  guard AXValueGetType(axValue) == .cfRange else { return nil }

  var range = CFRange(location: 0, length: 0)
  guard AXValueGetValue(axValue, .cfRange, &range) else { return nil }
  return range
}

func boundedContext(from value: String?, selectedRange: CFRange?) -> [String: String]? {
  guard let value = value, let selectedRange = selectedRange else { return nil }
  let utf16Length = value.utf16.count
  guard selectedRange.location >= 0, selectedRange.location <= utf16Length else { return nil }

  let caretStart = min(max(selectedRange.location, 0), utf16Length)
  let caretEnd = min(max(selectedRange.location + selectedRange.length, caretStart), utf16Length)
  let beforeStart = max(0, caretStart - textSessionContextLimit)
  let afterEnd = min(utf16Length, caretEnd + textSessionContextLimit)
  let nsValue = value as NSString

  return [
    "beforeCaret": nsValue.substring(with: NSRange(location: beforeStart, length: caretStart - beforeStart)),
    "afterCaret": nsValue.substring(with: NSRange(location: caretEnd, length: afterEnd - caretEnd)),
  ]
}

func caretBounds(from element: AXUIElement, selectedRange: CFRange?) -> [String: Double]? {
  guard var range = selectedRange else { return nil }
  range.length = 0
  guard let rangeValue = AXValueCreate(.cfRange, &range) else { return nil }

  var boundsValue: CFTypeRef?
  guard AXUIElementCopyParameterizedAttributeValue(
    element,
    kAXBoundsForRangeParameterizedAttribute as CFString,
    rangeValue,
    &boundsValue
  ) == .success else {
    return nil
  }

  guard let axValue = boundsValue as? AXValue else { return nil }
  guard AXValueGetType(axValue) == .cgRect else { return nil }

  var bounds = CGRect.zero
  guard AXValueGetValue(axValue, .cgRect, &bounds) else { return nil }
  return [
    "x": bounds.origin.x,
    "y": bounds.origin.y,
    "width": bounds.size.width,
    "height": bounds.size.height,
  ]
}

func elementIdentity(_ element: AXUIElement, bundleId: String) -> String? {
  if let identifier = stringAXAttribute(element, "AXIdentifier"), !identifier.isEmpty {
    return "ax:\(bundleId):identifier:\(identifier)"
  }

  guard let role = stringAXAttribute(element, kAXRoleAttribute as String), !role.isEmpty else {
    return nil
  }

  let subrole = stringAXAttribute(element, kAXSubroleAttribute as String) ?? "unknown-subrole"
  return "ax:\(bundleId):\(role):\(subrole)"
}

func isSecureLikeTextElement(_ element: AXUIElement) -> Bool {
  let metadata = [
    stringAXAttribute(element, kAXRoleAttribute as String),
    stringAXAttribute(element, kAXSubroleAttribute as String),
    stringAXAttribute(element, kAXDescriptionAttribute as String),
    stringAXAttribute(element, kAXTitleAttribute as String),
  ]
  .compactMap { $0?.lowercased() }
  .joined(separator: " ")

  return metadata.contains("secure") || metadata.contains("password")
}

func activeApplicationPayload(from snapshot: ActiveWindowSnapshot?) -> [String: String]? {
  guard let snapshot = snapshot else { return nil }
  return ["bundleId": snapshot.bundleId, "windowId": snapshot.windowId]
}

func jsonValue(_ value: Any?) -> Any {
  return value ?? NSNull()
}

func fallbackTextSessionSnapshot(activeWindow: ActiveWindowSnapshot?, reliability: String) -> TextSessionPayload {
  return [
    "activeApplication": jsonValue(activeApplicationPayload(from: activeWindow)),
    "focusedElementId": NSNull(),
    "textElementId": NSNull(),
    "selectedRange": NSNull(),
    "caretIdentity": NSNull(),
    "secureLike": false,
    "accessibilityReliability": reliability,
  ]
}

func selectedRangePayload(_ range: CFRange?) -> [String: Int]? {
  return range.map { ["location": Int($0.location), "length": Int($0.length)] }
}

func caretIdentity(from range: CFRange?) -> String? {
  return range.map { "range:\($0.location):\($0.length)" }
}

func textSessionSnapshot() -> TextSessionPayload? {
  let activeWindow = activeWindowSnapshot()
  guard AXIsProcessTrusted(),
        let app = NSWorkspace.shared.frontmostApplication,
        let bundleId = app.bundleIdentifier else {
    return fallbackTextSessionSnapshot(activeWindow: activeWindow, reliability: "unavailable")
  }

  guard let element = focusedAXElement(for: app) else {
    return fallbackTextSessionSnapshot(activeWindow: activeWindow, reliability: "unreliable")
  }

  let selectedRange = selectedTextRange(from: element)
  let selectedText = stringAXAttribute(element, kAXSelectedTextAttribute as String)
  let value = stringAXAttribute(element, kAXValueAttribute as String)
  let surroundingContext = boundedContext(from: value, selectedRange: selectedRange)
  let caretBounds = caretBounds(from: element, selectedRange: selectedRange)
  let identity = elementIdentity(element, bundleId: bundleId)
  let reliability = selectedRange != nil || selectedText != nil || surroundingContext != nil ? "reliable" : "unreliable"
  let secureLike = isSecureLikeTextElement(element)

  var snapshot: TextSessionPayload = [
    "activeApplication": jsonValue(activeApplicationPayload(from: activeWindow)),
    "focusedElementId": jsonValue(identity),
    "textElementId": jsonValue(identity),
    "selectedRange": jsonValue(selectedRangePayload(selectedRange)),
    "caretIdentity": jsonValue(caretIdentity(from: selectedRange)),
    "secureLike": secureLike,
    "accessibilityReliability": reliability,
  ]

  if let selectedText = selectedText {
    snapshot["selectedText"] = selectedText
  }
  if let surroundingContext = surroundingContext {
    snapshot["surroundingContext"] = surroundingContext
  }
  if let caretBounds = caretBounds {
    snapshot["caretBounds"] = caretBounds
  }

  return snapshot
}

func textSessionSnapshotKey(_ snapshot: [String: Any]) -> String? {
  guard JSONSerialization.isValidJSONObject(snapshot),
        let data = try? JSONSerialization.data(withJSONObject: snapshot, options: [.sortedKeys]) else {
    return nil
  }
  return String(data: data, encoding: .utf8)
}

func emitTextSessionSnapshotIfChanged() {
  guard let snapshot = textSessionSnapshot(), let key = textSessionSnapshotKey(snapshot) else { return }
  if key == lastTextSessionSnapshotKey { return }
  lastTextSessionSnapshotKey = key
  emit(["type": "text-session", "snapshot": snapshot])
}

func normalizedText(from event: CGEvent) -> String? {
  var length = 0
  var chars = [UniChar](repeating: 0, count: 16)
  event.keyboardGetUnicodeString(maxStringLength: chars.count, actualStringLength: &length, unicodeString: &chars)
  if length == 0 { return nil }

  let text = String(utf16CodeUnits: chars, count: length)
    .replacingOccurrences(of: "\r", with: "\n")
  if text.isEmpty { return nil }
  if text.unicodeScalars.allSatisfy({ CharacterSet.controlCharacters.contains($0) && $0 != "\n" && $0 != "\t" }) {
    return nil
  }
  return text
}

let callback: CGEventTapCallBack = { _, type, event, _ in
  guard type == .keyDown else { return Unmanaged.passUnretained(event) }

  let flags = event.flags
  let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
  let isDeleteKey = keyCode == 51 || keyCode == 117

  if isDeleteKey {
    if flags.contains(.maskCommand) || flags.contains(.maskControl) || flags.contains(.maskHelp) {
      return Unmanaged.passUnretained(event)
    }

    emitActiveWindowIfChanged()
    emitTextSessionSnapshotIfChanged()
    emit(["type": "delete", "unit": flags.contains(.maskAlternate) ? "token" : "character"])
    return Unmanaged.passUnretained(event)
  }

  if keyCode == 48 {
    return Unmanaged.passUnretained(event)
  }

  if flags.contains(.maskCommand) || flags.contains(.maskControl) || flags.contains(.maskHelp) {
    return Unmanaged.passUnretained(event)
  }

  guard let text = normalizedText(from: event) else {
    return Unmanaged.passUnretained(event)
  }

  emitActiveWindowIfChanged()
  emitTextSessionSnapshotIfChanged()
  emit(["type": "text", "text": text])
  return Unmanaged.passUnretained(event)
}

guard let eventTap = CGEvent.tapCreate(
  tap: .cgSessionEventTap,
  place: .headInsertEventTap,
  options: .listenOnly,
  eventsOfInterest: CGEventMask(1 << CGEventType.keyDown.rawValue),
  callback: callback,
  userInfo: nil
) else {
  emit(["type": "error", "message": "Failed to create macOS input tap. Check Input Monitoring permission."])
  exit(1)
}

let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
CGEvent.tapEnable(tap: eventTap, enable: true)
emit(["type": "ready"])
Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { _ in
  emitActiveWindowIfChanged()
  emitTextSessionSnapshotIfChanged()
}
CFRunLoopRun()
