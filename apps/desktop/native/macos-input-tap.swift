import AppKit
import ApplicationServices
import Carbon.HIToolbox
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
var lastAppContextSnapshotKey: String?
let textSessionContextLimit = 500
let terminalContextLimit = 12_000
let appContextNodeLimit = 120
let appContextDepthLimit = 7
var deadKeyState: UInt32 = 0

typealias TextSessionPayload = [String: Any]

func emitActiveWindowIfChanged(snapshot: ActiveWindowSnapshot? = activeWindowSnapshot()) {
  guard let snapshot = snapshot else { return }
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

func axUIElement(_ value: Any?) -> AXUIElement? {
  guard let value = value, CFGetTypeID(value as CFTypeRef) == AXUIElementGetTypeID() else { return nil }
  return (value as! AXUIElement)
}

func axValue(_ value: Any?) -> AXValue? {
  guard let value = value, CFGetTypeID(value as CFTypeRef) == AXValueGetTypeID() else { return nil }
  return (value as! AXValue)
}

func stringAXAttribute(_ element: AXUIElement, _ attribute: String) -> String? {
  return copyAXAttribute(element, attribute) as? String
}

func boundedStringAXAttribute(_ element: AXUIElement, _ attribute: String, maxLength: Int = 500) -> String? {
  guard let value = stringAXAttribute(element, attribute)?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
    return nil
  }
  return String(value.prefix(maxLength))
}

func addBoundedStringAXAttribute(
  _ attribute: String,
  from element: AXUIElement,
  to payload: inout [String: Any],
  as key: String,
  maxLength: Int = 500
) {
  if let value = boundedStringAXAttribute(element, attribute, maxLength: maxLength) {
    payload[key] = value
  }
}

func focusedAXElement(for app: NSRunningApplication) -> AXUIElement? {
  let appElement = AXUIElementCreateApplication(app.processIdentifier)
  return axUIElement(copyAXAttribute(appElement, kAXFocusedUIElementAttribute as String))
}

func focusedAXWindow(for app: NSRunningApplication) -> AXUIElement? {
  let appElement = AXUIElementCreateApplication(app.processIdentifier)
  return axUIElement(copyAXAttribute(appElement, kAXFocusedWindowAttribute as String))
}

func isGhosttyBundleId(_ bundleId: String) -> Bool {
  return bundleId == "com.mitchellh.ghostty"
}

func selectedTextRange(from element: AXUIElement) -> CFRange? {
  guard let axValue = axValue(copyAXAttribute(element, kAXSelectedTextRangeAttribute as String)) else { return nil }
  guard AXValueGetType(axValue) == .cfRange else { return nil }

  var range = CFRange(location: 0, length: 0)
  guard AXValueGetValue(axValue, .cfRange, &range) else { return nil }
  return range
}

func terminalContents(from element: AXUIElement) -> String? {
  if let characterCount = copyAXAttribute(element, kAXNumberOfCharactersAttribute as String) as? NSNumber {
    var range = CFRange(
      location: max(0, characterCount.intValue - terminalContextLimit),
      length: min(characterCount.intValue, terminalContextLimit)
    )
    if let rangeValue = AXValueCreate(.cfRange, &range) {
      var value: CFTypeRef?
      if AXUIElementCopyParameterizedAttributeValue(
        element,
        kAXStringForRangeParameterizedAttribute as CFString,
        rangeValue,
        &value
      ) == .success, let text = value as? String {
        return text
      }
    }
  }

  return stringAXAttribute(element, kAXValueAttribute as String)
    .map { String($0.suffix(terminalContextLimit)) }
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

func rectPayload(_ bounds: CGRect) -> [String: Double]? {
  guard bounds.width > 0, bounds.height > 0 else { return nil }
  return [
    "x": bounds.origin.x,
    "y": bounds.origin.y,
    "width": bounds.size.width,
    "height": bounds.size.height,
  ]
}

func caretBoundsForTextMarkerRange(from element: AXUIElement) -> [String: Double]? {
  guard let markerRange = copyAXAttribute(element, "AXSelectedTextMarkerRange") else { return nil }

  var boundsValue: CFTypeRef?
  guard AXUIElementCopyParameterizedAttributeValue(
    element,
    "AXBoundsForTextMarkerRange" as CFString,
    markerRange as CFTypeRef,
    &boundsValue
  ) == .success else {
    return nil
  }

  guard let axValue = axValue(boundsValue), AXValueGetType(axValue) == .cgRect else { return nil }
  var bounds = CGRect.zero
  guard AXValueGetValue(axValue, .cgRect, &bounds) else { return nil }
  guard bounds.height > 0 else { return nil }
  // Chromium exposes the zero-length marker's remaining line width. Its origin
  // is the caret, so collapse that rectangle back to a caret-width anchor.
  return [
    "x": bounds.origin.x,
    "y": bounds.origin.y,
    "width": 1,
    "height": bounds.size.height,
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
    return caretBoundsForTextMarkerRange(from: element)
  }

  guard let axValue = axValue(boundsValue), AXValueGetType(axValue) == .cgRect else {
    return caretBoundsForTextMarkerRange(from: element)
  }

  var bounds = CGRect.zero
  guard AXValueGetValue(axValue, .cgRect, &bounds) else {
    return caretBoundsForTextMarkerRange(from: element)
  }
  return rectPayload(bounds) ?? caretBoundsForTextMarkerRange(from: element)
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

func textSessionSnapshot(activeWindow: ActiveWindowSnapshot? = activeWindowSnapshot()) -> TextSessionPayload? {
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
  let ghostty = isGhosttyBundleId(bundleId)
  let value = ghostty ? nil : stringAXAttribute(element, kAXValueAttribute as String)
  let surroundingContext = boundedContext(from: value, selectedRange: selectedRange)
  let caretBounds = caretBounds(from: element, selectedRange: selectedRange)
  let identity = elementIdentity(element, bundleId: bundleId)
  let terminalContents = ghostty ? terminalContents(from: element) : nil
  let reliability = selectedRange != nil || selectedText != nil || surroundingContext != nil || terminalContents != nil
    ? "reliable"
    : "unreliable"
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
  if let terminalContents = terminalContents {
    snapshot["terminalContents"] = terminalContents
    snapshot["terminalTitle"] = stringAXAttribute(element, kAXTitleAttribute as String)
      ?? focusedAXWindow(for: app).flatMap { stringAXAttribute($0, kAXTitleAttribute as String) }
      ?? ""
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

func emitTextSessionSnapshotIfChanged(activeWindow: ActiveWindowSnapshot? = activeWindowSnapshot()) {
  guard let snapshot = textSessionSnapshot(activeWindow: activeWindow), let key = textSessionSnapshotKey(snapshot) else { return }
  if key == lastTextSessionSnapshotKey { return }
  lastTextSessionSnapshotKey = key
  emit(["type": "text-session", "snapshot": snapshot])
}

func isWhatsAppBundleId(_ bundleId: String) -> Bool {
  return bundleId == "net.whatsapp.WhatsApp" || bundleId == "net.whatsapp.WhatsAppDesktop" || bundleId == "desktop.WhatsApp"
}

func accessibilityNodePayload(from element: AXUIElement, depth: Int, remainingNodes: inout Int) -> [String: Any]? {
  if remainingNodes <= 0 { return nil }
  remainingNodes -= 1

  var payload: [String: Any] = [:]
  let stringAttributes: [(attribute: String, key: String, maxLength: Int)] = [
    (kAXRoleAttribute as String, "role", 120),
    (kAXSubroleAttribute as String, "subrole", 120),
    (kAXTitleAttribute as String, "title", 500),
    (kAXValueAttribute as String, "value", 500),
    (kAXDescriptionAttribute as String, "description", 500),
    ("AXIdentifier", "identifier", 120),
  ]
  for attribute in stringAttributes {
    addBoundedStringAXAttribute(
      attribute.attribute,
      from: element,
      to: &payload,
      as: attribute.key,
      maxLength: attribute.maxLength
    )
  }

  if depth < appContextDepthLimit,
     let children = copyAXAttribute(element, kAXChildrenAttribute as String) as? [AXUIElement] {
    let childPayloads = children.compactMap { child in
      accessibilityNodePayload(from: child, depth: depth + 1, remainingNodes: &remainingNodes)
    }
    if !childPayloads.isEmpty {
      payload["children"] = childPayloads
    }
  }

  return payload.isEmpty ? nil : payload
}

func appContextTreeSnapshot() -> [String: Any]? {
  guard AXIsProcessTrusted(),
        let app = NSWorkspace.shared.frontmostApplication,
        let bundleId = app.bundleIdentifier,
        isWhatsAppBundleId(bundleId) else {
    return nil
  }

  let appElement = AXUIElementCreateApplication(app.processIdentifier)
  let rootElement = axUIElement(copyAXAttribute(appElement, kAXFocusedWindowAttribute as String)) ?? appElement
  var remainingNodes = appContextNodeLimit
  return accessibilityNodePayload(from: rootElement, depth: 0, remainingNodes: &remainingNodes)
}

func emitAppContextTreeSnapshotIfChanged() {
  guard let snapshot = appContextTreeSnapshot(), let key = textSessionSnapshotKey(snapshot) else { return }
  if key == lastAppContextSnapshotKey { return }
  lastAppContextSnapshotKey = key
  emit(["type": "app-context-tree", "provider": "whatsapp-conversation", "tree": snapshot])
}

func emitPolledContextSnapshots() {
  let activeWindow = activeWindowSnapshot()
  emitActiveWindowIfChanged(snapshot: activeWindow)
  // Ghostty output can include Tab's own diagnostics. Polling it would turn
  // those output changes into a self-sustaining suggestion refresh loop.
  if activeWindow?.bundleId != "com.mitchellh.ghostty" {
    emitTextSessionSnapshotIfChanged(activeWindow: activeWindow)
  }
  emitAppContextTreeSnapshotIfChanged()
}

func invalidateGhosttyClickIfStillActive(_ clickedWindow: ActiveWindowSnapshot) {
  // Frontmost application changes can settle after the global mouse event.
  // Do not invalidate the Ghostty session when this click actually switched apps.
  DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
    guard activeWindowSnapshot() == clickedWindow else { return }
    emitTextSessionSnapshotIfChanged(activeWindow: clickedWindow)
    emit(["type": "context-invalidated", "message": "mouse_input"])
  }
}

func currentKeyboardLayout() -> UnsafePointer<UCKeyboardLayout>? {
  guard let inputSource = TISCopyCurrentKeyboardLayoutInputSource()?.takeRetainedValue(),
        let layoutData = TISGetInputSourceProperty(inputSource, kTISPropertyUnicodeKeyLayoutData) else {
    return nil
  }

  let data = unsafeBitCast(layoutData, to: CFData.self)
  guard let bytes = CFDataGetBytePtr(data) else { return nil }
  return UnsafeRawPointer(bytes).assumingMemoryBound(to: UCKeyboardLayout.self)
}

func carbonModifierState(from flags: CGEventFlags) -> UInt32 {
  var modifiers = UInt32(0)
  if flags.contains(.maskShift) { modifiers |= UInt32(shiftKey) }
  if flags.contains(.maskAlternate) { modifiers |= UInt32(optionKey) }
  if flags.contains(.maskAlphaShift) { modifiers |= UInt32(alphaLock) }
  return modifiers >> 8
}

func fallbackText(from event: CGEvent) -> String? {
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

func normalizedText(from event: CGEvent) -> String? {
  guard let layout = currentKeyboardLayout() else {
    return fallbackText(from: event)
  }

  let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
  var length = 0
  var chars = [UniChar](repeating: 0, count: 16)
  let status = UCKeyTranslate(
    layout,
    UInt16(keyCode),
    UInt16(kUCKeyActionDown),
    carbonModifierState(from: event.flags),
    UInt32(LMGetKbdType()),
    OptionBits(0),
    &deadKeyState,
    chars.count,
    &length,
    &chars
  )

  guard status == noErr else {
    return fallbackText(from: event)
  }

  if length == 0 { return nil }
  let text = String(utf16CodeUnits: chars, count: length)
    .replacingOccurrences(of: "\r", with: "\n")
  if text.isEmpty { return nil }
  if text.unicodeScalars.allSatisfy({ CharacterSet.controlCharacters.contains($0) && $0 != "\n" && $0 != "\t" }) {
    return nil
  }
  return text
}

let doubleOptionPressNanoseconds: CGEventTimestamp = 400_000_000
var lastOptionKeyUpTimestamp: CGEventTimestamp = 0

let callback: CGEventTapCallBack = { _, type, event, _ in
  let flags = event.flags
  let keyCode = event.getIntegerValueField(.keyboardEventKeycode)

  if type == .flagsChanged {
    if keyCode == 58 || keyCode == 61 {
      if flags.contains(.maskAlternate) {
        return Unmanaged.passUnretained(event)
      }

      let timestamp = event.timestamp
      if lastOptionKeyUpTimestamp > 0 && timestamp - lastOptionKeyUpTimestamp <= doubleOptionPressNanoseconds {
        lastOptionKeyUpTimestamp = 0
        emit(["type": "suggest-now"])
      } else {
        lastOptionKeyUpTimestamp = timestamp
      }
    }
    return Unmanaged.passUnretained(event)
  }

  if type == .leftMouseDown || type == .rightMouseDown || type == .otherMouseDown {
    let activeWindow = activeWindowSnapshot()
    if let activeWindow = activeWindow, activeWindow.bundleId == "com.mitchellh.ghostty" {
      invalidateGhosttyClickIfStillActive(activeWindow)
    }
    return Unmanaged.passUnretained(event)
  }

  guard type == .keyDown else { return Unmanaged.passUnretained(event) }
  lastOptionKeyUpTimestamp = 0

  let activeWindow = activeWindowSnapshot()
  let activeBundleId = activeWindow?.bundleId
  let isGhostty = activeBundleId == "com.mitchellh.ghostty"
  let isDeleteKey = keyCode == 51

  if isDeleteKey {
    if flags.contains(.maskCommand) || flags.contains(.maskControl) || flags.contains(.maskHelp) {
      if isGhostty {
        emit(["type": "context-invalidated", "message": "modified_delete"])
      }
      return Unmanaged.passUnretained(event)
    }

    emitActiveWindowIfChanged(snapshot: activeWindow)
    emitTextSessionSnapshotIfChanged(activeWindow: activeWindow)
    emitAppContextTreeSnapshotIfChanged()
    emit(["type": "delete", "unit": flags.contains(.maskAlternate) ? "token" : "character"])
    return Unmanaged.passUnretained(event)
  }

  if keyCode == 117 {
    if isGhostty {
      emit(["type": "context-invalidated", "message": "forward_delete"])
    }
    return Unmanaged.passUnretained(event)
  }

  let isCommandPaste = keyCode == 9 && flags.contains(.maskCommand)
    && !flags.contains(.maskControl) && !flags.contains(.maskHelp)
  if isCommandPaste {
    guard isGhostty else { return Unmanaged.passUnretained(event) }
    emitActiveWindowIfChanged(snapshot: activeWindow)
    emitTextSessionSnapshotIfChanged(activeWindow: activeWindow)
    if let text = NSPasteboard.general.string(forType: .string) {
      emit(["type": "paste", "text": text])
    } else if isGhostty {
      emit(["type": "context-invalidated", "message": "unsupported_paste"])
    }
    return Unmanaged.passUnretained(event)
  }

  let isPlainReturn = (keyCode == 36 || keyCode == 76)
    && !flags.contains(.maskShift) && !flags.contains(.maskAlternate)
    && !flags.contains(.maskCommand) && !flags.contains(.maskControl)
  if isPlainReturn && isGhostty {
    emit(["type": "context-invalidated", "message": "submission"])
    return Unmanaged.passUnretained(event)
  }

  if keyCode == 48 {
    if isGhostty && !flags.contains(.maskAlternate) {
      emit(["type": "context-invalidated", "message": "tab"])
    }
    return Unmanaged.passUnretained(event)
  }

  if flags.contains(.maskCommand) || flags.contains(.maskControl) || flags.contains(.maskHelp) {
    if isGhostty {
      emit(["type": "context-invalidated", "message": "shortcut"])
    }
    return Unmanaged.passUnretained(event)
  }

  guard let text = normalizedText(from: event) else {
    if isGhostty {
      emit(["type": "context-invalidated", "message": "navigation_or_unknown_key"])
    }
    return Unmanaged.passUnretained(event)
  }

  emitActiveWindowIfChanged(snapshot: activeWindow)
  emitTextSessionSnapshotIfChanged(activeWindow: activeWindow)
  emitAppContextTreeSnapshotIfChanged()
  emit(["type": "text", "text": text])
  return Unmanaged.passUnretained(event)
}

let keyDownMask = CGEventMask(1) << CGEventType.keyDown.rawValue
let flagsChangedMask = CGEventMask(1) << CGEventType.flagsChanged.rawValue
let leftMouseDownMask = CGEventMask(1) << CGEventType.leftMouseDown.rawValue
let rightMouseDownMask = CGEventMask(1) << CGEventType.rightMouseDown.rawValue
let otherMouseDownMask = CGEventMask(1) << CGEventType.otherMouseDown.rawValue
let eventMask = keyDownMask | flagsChangedMask | leftMouseDownMask | rightMouseDownMask | otherMouseDownMask

guard let eventTap = CGEvent.tapCreate(
  tap: .cgSessionEventTap,
  place: .headInsertEventTap,
  options: .listenOnly,
  eventsOfInterest: eventMask,
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
  emitPolledContextSnapshots()
}
CFRunLoopRun()
