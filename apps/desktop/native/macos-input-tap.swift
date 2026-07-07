import AppKit
import ApplicationServices
import Foundation

func emit(_ payload: [String: String]) {
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

func emitActiveWindowIfChanged() {
  guard let snapshot = activeWindowSnapshot() else { return }
  if snapshot == lastActiveWindowSnapshot { return }
  lastActiveWindowSnapshot = snapshot
  emit(["type": "active-app", "bundleId": snapshot.bundleId, "windowId": snapshot.windowId])
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
}
CFRunLoopRun()
