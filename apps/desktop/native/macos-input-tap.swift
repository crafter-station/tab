import AppKit
import ApplicationServices
import Foundation

func emit(_ payload: [String: String]) {
  guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return }
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
}

func activeBundleId() -> String {
  NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? ""
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
  if flags.contains(.maskCommand) || flags.contains(.maskControl) || flags.contains(.maskHelp) {
    return Unmanaged.passUnretained(event)
  }

  guard let text = normalizedText(from: event) else {
    return Unmanaged.passUnretained(event)
  }

  let bundleId = activeBundleId()
  if !bundleId.isEmpty {
    emit(["type": "active-app", "bundleId": bundleId])
  }
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
CFRunLoopRun()
