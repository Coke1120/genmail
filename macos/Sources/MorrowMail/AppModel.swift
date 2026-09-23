import SwiftUI
import AppKit
import Security

@MainActor
final class AppModel: ObservableObject {
    @Published var state: JSON = .null
    @Published var busy = false
    @Published var starting = true
    @Published var error = ""
    @Published var notice = ""
    @Published var section = "inbox"
    @Published var selectedMessage: String?
    @Published var compose: Draft?
    @Published var organizing: JSON?
    @Published var searchFocus = 0
    @Published var showSettings = false
    @Published var settingsTab = "general"
    @Published var assistantAction = "summary"
    @Published var unsavedForms = Set<String>()
    private var process: Process?
    private var input: Pipe?
    private var output: Pipe?
    private var token = ""
    private(set) var baseURL: URL?
    private var periodic: Task<Void, Never>?
    private var refreshing = false
    private var shuttingDown = false
    private var launchAttempt = 0
    let dataDirectory: URL
    let session: URLSession

    init() {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 65
        config.timeoutIntervalForResource = 90
        config.httpCookieStorage = nil
        session = URLSession(configuration: config)
        if let override = ProcessInfo.processInfo.environment["MORROW_DATA_DIR"], override.hasPrefix("/") {
            dataDirectory = URL(fileURLWithPath: override)
        } else {
            dataDirectory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Morrow Mail", isDirectory: true)
        }
    }
    var account: String { state["account"]["id"].string }
    var accounts: [JSON] { state["accounts"].array }
    var combined: Bool { account == "all" }
    var senderAccounts: [JSON] { accounts + [.object(["id": .string("demo"), "email": .string("Demo workspace (simulated)")])] }
    var messages: [JSON] { state["messages"].array }
    var features: [JSON] { state["features"].array }
    var preferences: JSON { state["settings"]["preferences"] }
    var policy: JSON { state["settings"]["policy"] }
    var current: JSON? { messages.first { $0.viewID == selectedMessage } }
    var colorScheme: ColorScheme? {
        switch preferences["theme"].string { case "light": return .light; case "dark": return .dark; default: return nil }
    }
    var canNavigate: Bool { !busy && unsavedForms.isEmpty && compose == nil && organizing == nil && !showSettings }

    func start() async {
        guard process == nil else { return }
        starting = true; error = ""; shuttingDown = false; launchAttempt += 1
        let attempt = launchAttempt
        do {
            let resources = Bundle.main.resourceURL!
            let backend = resources.appendingPathComponent("backend/server/native.js")
            let node = resources.appendingPathComponent("node")
            guard FileManager.default.isExecutableFile(atPath: node.path), FileManager.default.fileExists(atPath: backend.path) else {
                throw APIError("Build and open Morrow Mail.app with npm run macos:build. The app includes its own runtime.")
            }
            var random = [UInt8](repeating: 0, count: 32)
            guard SecRandomCopyBytes(kSecRandomDefault, random.count, &random) == errSecSuccess else { throw APIError("The system could not create a private session.") }
            token = random.map { String(format: "%02x", $0) }.joined()
            let child = Process(), input = Pipe(), output = Pipe()
            child.executableURL = node; child.arguments = [backend.path]
            child.currentDirectoryURL = resources.appendingPathComponent("backend")
            // Do not inherit NODE_OPTIONS, preload paths, or shell secrets.
            child.environment = ["PATH": "/usr/bin:/bin", "HOME": FileManager.default.homeDirectoryForCurrentUser.path, "NODE_ENV": "production"]
            child.standardInput = input; child.standardOutput = output
            child.standardError = FileHandle.nullDevice
            child.terminationHandler = { [weak self] _ in
                Task { @MainActor in
                    guard let self, self.launchAttempt == attempt, !self.shuttingDown else { return }
                    self.baseURL = nil; self.process = nil; self.starting = false
                    self.error = "The local service stopped. Your saved data is retained. Quit and reopen Morrow Mail."
                }
            }
            try child.run()
            self.process = child; self.input = input; self.output = output
            let config = JSON.object(["token": .string(token), "dataDirectory": .string(dataDirectory.path)])
            var data = try JSONEncoder().encode(config); data.append(0x0a)
            try input.fileHandleForWriting.write(contentsOf: data)
            // Read asynchronously so a failed child cannot freeze the window.
            let pipe = output.fileHandleForReading
            let line = try await Task.detached { () throws -> Data in
                var collected = Data()
                for try await byte in pipe.bytes {
                    if byte == 10 { return collected }
                    collected.append(byte)
                    if collected.count > 1024 { break }
                }
                throw APIError("The local service did not start. Check that the data folder is writable.")
            }.value
            let ready = try JSONDecoder().decode(JSON.self, from: line)
            let port = Int(ready["port"].number)
            guard (1...65535).contains(port) else { throw APIError("The local service returned an invalid address.") }
            baseURL = URL(string: "http://127.0.0.1:\(port)")!
            try await reload()
            starting = false
            periodic = Task { [weak self] in
                var lastSync = Date()
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 30_000_000_000)
                    guard !Task.isCancelled, let self else { return }
                    let minutes = self.preferences["syncInterval"].number
                    if minutes > 0 && Date().timeIntervalSince(lastSync) >= minutes * 60 && self.canNavigate && self.account != "demo" {
                        lastSync = Date()
                        self.perform { try await self.sync() }
                    }
                }
            }
        } catch {
            self.error = error.localizedDescription; starting = false
            stop()
        }
    }
    func stop() {
        shuttingDown = true; periodic?.cancel()
        try? input?.fileHandleForWriting.close()
        if process?.isRunning == true { process?.terminate() }
        process = nil; input = nil; output = nil; baseURL = nil
    }
    func request(_ path: String, method: String = "GET", body: JSON? = nil, mailbox: String? = nil) async throws -> JSON {
        guard let baseURL, let url = URL(string: "/api" + path, relativeTo: baseURL)?.absoluteURL else { throw APIError("The local service is not connected.") }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let owner = mailbox ?? account
        if !owner.isEmpty { request.setValue(owner, forHTTPHeaderField: "X-Genmail-Account") }
        if let body { request.httpBody = try JSONEncoder().encode(body); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.url?.host == baseURL.host, http.url?.port == baseURL.port else { throw APIError("The local service returned an unexpected response.") }
        guard data.count <= 32 * 1024 * 1024 else { throw APIError("The response was too large. Narrow your request.") }
        let result = try JSONDecoder().decode(JSON.self, from: data)
        guard (200...299).contains(http.statusCode) else { throw APIError(payload: result) }
        return result
    }
    func reload() async throws {
        guard !refreshing else { return }
        refreshing = true; defer { refreshing = false }
        let next = try await request("/state")
        guard !next["account"].isNull, !next["messages"].isNull else { throw APIError("Morrow received an incomplete workspace.") }
        state = next
        if let selectedMessage, !messages.contains(where: { $0.viewID == selectedMessage }) { self.selectedMessage = nil }
    }
    func refreshWhenActive() {
        guard !starting, baseURL != nil, !busy, compose == nil else { return }
        perform { try await self.reload() }
    }
    func perform(_ work: @escaping @MainActor () async throws -> Void) {
        guard !busy else { return }
        busy = true; error = ""
        Task {
            defer { busy = false }
            do { try await work() } catch { self.error = error.localizedDescription }
        }
    }
    func selectAccount(_ id: String, folder: String? = nil) async throws {
        state = try await request("/account/select", method: "POST", body: .object(["accountId": .string(id)]))
        selectedMessage = nil
        if let folder { section = folder }
    }
    func openAssistant(_ action: String, message: JSON) {
        perform {
            if self.account != message["accountId"].string { try await self.selectAccount(message["accountId"].string) }
            self.selectedMessage = message.viewID; self.assistantAction = action; self.section = "studio"
        }
    }
    func sync() async throws {
        state = try await request("/sync", method: "POST", body: .object([:]))
        let failures = state["syncErrors"].array.map { $0["accountId"].string }
        notice = failures.isEmpty ? "Inbox synced." : "Some accounts could not sync: " + failures.joined(separator: ", ") + ". Reconnect them in Settings."
    }
    func preference(_ key: String, _ value: String) {
        perform { self.state = try await self.request("/settings/preferences", method: "POST", body: .object([key: .string(value)])) }
    }
    func canOrganize(_ message: JSON) -> Bool {
        let provider = accounts.first { $0.id == message["accountId"].string }?["provider"].string ?? ""
        return !provider.isEmpty && (message["remoteId"].nonempty ? message["remoteId"].string : message.id).hasPrefix(provider + ":")
    }
    func patch(_ message: JSON, _ values: JSON) {
        perform {
            _ = try await self.request("/messages/" + encodedPath(message.id), method: "PATCH", body: values, mailbox: message["accountId"].string)
            try await self.reload()
        }
    }
    func newDraft(_ value: Draft? = nil) {
        guard !busy, compose == nil else { return }
        guard unsavedForms.isEmpty else { notice = "Save your current changes before opening a new draft."; return }
        var draft = value ?? Draft()
        if draft.accountID.isEmpty { draft.accountID = combined ? accounts.first?.id ?? "demo" : account }
        if value == nil, preferences["signature"].nonempty { draft.body = "\n\n" + preferences["signature"].string }
        compose = draft
    }
    func settings(_ tab: String = "general") {
        guard compose == nil, unsavedForms.subtracting(["settings"]).isEmpty else { notice = "Save your current changes before opening Settings."; return }
        settingsTab = tab; showSettings = true
    }
    func allowed(_ action: String) -> Bool { policy["enabled"].bool && policy["behaviors"][action].bool }
    func openOAuth(_ result: JSON, provider: String, calendar: Bool) throws {
        let path = "/api/\(calendar ? "calendar-oauth" : "oauth")/\(provider)/authorize"
        guard let url = URL(string: result["url"].string), url.scheme == "http", url.host == "localhost", url.port == baseURL?.port,
              url.path == path, URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.contains(where: { $0.name == "state" && !($0.value ?? "").isEmpty }) == true,
              NSWorkspace.shared.open(url) else { throw APIError("Morrow could not open the provider sign-in page.") }
        notice = "Finish signing in in your browser, then return to Morrow."
    }
    func confirmDiscard(_ message: String = "Discard unsaved changes?") -> Bool {
        let alert = NSAlert(); alert.messageText = message
        alert.informativeText = "Changes you have not saved will be lost."
        alert.addButton(withTitle: "Keep Editing"); alert.addButton(withTitle: "Discard")
        return alert.runModal() == .alertSecondButtonReturn
    }
    func confirm(_ title: String, detail: String) -> Bool {
        let alert = NSAlert(); alert.messageText = title; alert.informativeText = detail
        alert.addButton(withTitle: "Cancel"); alert.addButton(withTitle: "Continue")
        return alert.runModal() == .alertSecondButtonReturn
    }
    func dirty(_ key: String, _ value: Bool) { if value { unsavedForms.insert(key) } else { unsavedForms.remove(key) } }
}
