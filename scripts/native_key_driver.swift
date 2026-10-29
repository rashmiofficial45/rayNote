import Cocoa
import CoreGraphics

func postKey(pid: pid_t, key: CGKeyCode, alt: Bool = false, cmd: Bool = false, shift: Bool = false) {
    let src = CGEventSource(stateID: .hidSystemState)
    guard let down = CGEvent(keyboardEventSource: src, virtualKey: key, keyDown: true),
          let up = CGEvent(keyboardEventSource: src, virtualKey: key, keyDown: false) else { return }
    
    var flags: CGEventFlags = []
    if alt { flags.insert(.maskAlternate) }
    if cmd { flags.insert(.maskCommand) }
    if shift { flags.insert(.maskShift) }
    
    down.flags = flags
    up.flags = flags
    
    down.postToPid(pid)
    up.postToPid(pid)
}

func postString(pid: pid_t, string: String) {
    let src = CGEventSource(stateID: .hidSystemState)
    for char in string.utf16 {
        var code = char
        guard let down = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: true),
              let up = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: false) else { continue }
        down.keyboardSetUnicodeString(stringLength: 1, unicodeString: &code)
        up.keyboardSetUnicodeString(stringLength: 1, unicodeString: &code)
        down.postToPid(pid)
        up.postToPid(pid)
        usleep(5_000)
    }
}

let args = CommandLine.arguments
guard args.count >= 2 else {
    print("Usage: native_key_driver <action> [count|string]")
    exit(1)
}

let action = args[1]

let pids = NSRunningApplication.runningApplications(withBundleIdentifier: "com.raynote.desktop")
guard let app = pids.first else {
    print("raynote process not found")
    exit(1)
}
let pid = app.processIdentifier

switch action {
case "type":
    let str = args.count >= 3 ? args[2] : " "
    postString(pid: pid, string: str)
    print("Successfully typed '\(str)' to PID \(pid)")

case "switch_and_type":
    // Run N note switches with periodic typing every 200 switches
    let count = args.count >= 3 ? (Int(args[2]) ?? 200) : 200
    for i in 1...count {
        if i % 2 == 0 {
            postKey(pid: pid, key: 125, alt: true) // Alt + Down
        } else {
            postKey(pid: pid, key: 126, alt: true) // Alt + Up
        }
        usleep(15_000) // 15ms per switch
    }
    print("Successfully executed \(count) switches to PID \(pid)")

default:
    let count = args.count >= 3 ? (Int(args[2]) ?? 1) : 1
    for _ in 1...count {
        switch action {
        case "next":
            postKey(pid: pid, key: 125, alt: true)
        case "prev":
            postKey(pid: pid, key: 126, alt: true)
        case "new":
            postKey(pid: pid, key: 45, cmd: true) // N
        case "undo":
            postKey(pid: pid, key: 6, cmd: true) // Z
        case "redo":
            postKey(pid: pid, key: 6, cmd: true, shift: true) // Shift+Cmd+Z
        case "palette":
            postKey(pid: pid, key: 40, cmd: true) // K
        case "search":
            postKey(pid: pid, key: 35, cmd: true) // P
        case "escape":
            postKey(pid: pid, key: 53) // Escape
        default:
            break
        }
        if count > 1 {
            usleep(15_000) // 15ms
        }
    }
    print("Successfully posted \(action) x \(count) to PID \(pid)")
}
