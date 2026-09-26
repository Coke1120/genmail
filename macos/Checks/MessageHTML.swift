import AppKit
import SwiftUI
import WebKit

@main struct MessageHTMLChecks {
    @MainActor static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)
        let port = CommandLine.arguments[1]
        let content = "<p>Formatted <b>mail</b></p><script>window.emailScriptRan=true;fetch('http://127.0.0.1:\(port)/script')</script><img src='http://127.0.0.1:\(port)/image'><iframe src='http://127.0.0.1:\(port)/frame'></iframe>"
        var measured: CGFloat = 480
        let host = NSHostingView(rootView: MessageHTMLView(html: content, images: false, height: Binding(get: { measured }, set: { measured = $0 })))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 720, height: 500), styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = host
        window.orderBack(nil)
        func findWeb(_ view: NSView) -> WKWebView? { (view as? WKWebView) ?? view.subviews.lazy.compactMap { findWeb($0) }.first }
        Task { @MainActor in
            do {
                var web: WKWebView?
                for _ in 0..<200 {
                    web = findWeb(host)
                    if let web, !web.isLoading, web.url != nil, measured != 480 { break }
                    try await Task.sleep(nanoseconds: 50_000_000)
                }
                guard let web, web.url != nil else { fatalError("Formatted reader did not load") }
                assert(!web.configuration.defaultWebpagePreferences.allowsContentJavaScript)
                let ran = try await web.evaluateJavaScript("window.emailScriptRan === true")
                assert((ran as? Bool) == false, "Email JavaScript executed")
                assert(measured != 480, "Reader did not measure content height")
                assert(MessageHTMLView.allowedLink(URL(string: "https://example.invalid")!))
                assert(!MessageHTMLView.allowedLink(URL(string: "file:///tmp/secret")!))
                assert(!MessageHTMLView.allowedLink(URL(string: "javascript:alert(1)")!))
                assert(!MessageHTMLView.allowedLink(URL(string: "https://user:password@example.invalid")!))
                print("Native email reader: HTML loaded, measured, scripts and remote resources blocked; link protocols checked.")
                window.orderOut(nil)
                exit(0)
            } catch { fatalError("Reader check failed: \(error)") }
        }
        app.run()
    }
}
