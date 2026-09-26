import AppKit

// Standalone fixture, without starting the service or opening any workspace:
// swiftc -D MORROW_WINDOW_CHECKS -parse-as-library macos/Sources/MorrowMail/{Models,AppModel,MorrowMailApp}.swift macos/Checks/WindowAssertions.swift -o /tmp/morrow-window-checks
// /tmp/morrow-window-checks
@main
struct WindowAssertions {
    @MainActor static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)
        let model = AppModel(), delegate = MorrowDelegate()
        let window = NSWindow(contentRect: NSRect(x: 50, y: 50, width: 400, height: 260), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Morrow window lifecycle fixture"
        window.isReleasedWhenClosed = false
        let guardDelegate = WindowGuard.Coordinator(model)
        window.delegate = guardDelegate
        delegate.model = model; delegate.mainWindow = window
        defer { window.delegate = nil; window.close() }

        assert(!delegate.applicationShouldTerminateAfterLastWindowClosed(app))
        model.unsavedForms.insert("fixture-draft")
        model.busy = true
        window.makeKeyAndOrderFront(nil)
        assert(!guardDelegate.windowShouldClose(window))
        assert(!window.isVisible)
        assert(model.busy && model.unsavedForms.contains("fixture-draft"), "Closing must keep pending work and edits alive.")
        assert(!delegate.applicationShouldHandleReopen(app, hasVisibleWindows: false))
        assert(window.isVisible, "Dock reopen must reveal the same window.")
        assert(delegate.mainWindow === window && model.unsavedForms.contains("fixture-draft"))
        model.busy = false
        assert(!guardDelegate.windowShouldClose(window))
        assert(!delegate.applicationShouldHandleReopen(app, hasVisibleWindows: false))
        assert(window.isVisible && model.unsavedForms.contains("fixture-draft"))
        assert(MorrowDelegate().applicationShouldTerminate(app) == .terminateNow)
        print("Window close/reopen preserves pending work and unsaved forms.")
    }
}
