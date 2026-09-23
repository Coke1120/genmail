import SwiftUI
import AppKit

struct NativeSettingsView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) var dismiss
    @State private var values: JSON = .null
    @State private var baseline: JSON = .null
    @State private var provider = "google"
    @State private var mailOAuth: JSON = .object([:])
    @State private var calendarOAuth: JSON = .object([:])
    @State private var localError = ""
    @State private var status = ""
    @State private var footerPreview: JSON = .null
    private let tabs = [("general", "General", "slider.horizontal.3"), ("mail", "Mail", "envelope"), ("model", "Model", "cpu"), ("permissions", "AI Permissions", "checkmark.shield"), ("calendar", "Calendar", "calendar"), ("about", "About", "info.circle")]
    var dirty: Bool { values != baseline || mailOAuth.object.values.contains { $0.object.values.contains(where: \.nonempty) } || calendarOAuth.object.values.contains { $0.object.values.contains(where: \.nonempty) } }
    var body: some View {
        VStack(spacing: 0) {
            HStack { Text("Your workspace").font(.title2.bold()); Spacer(); if dirty { Text("Unsaved changes").font(.caption).foregroundStyle(.secondary) }; Button("Done") { close() }.keyboardShortcut(.cancelAction).disabled(model.busy) }.padding(22)
            Divider()
            HStack(spacing: 0) {
                List(tabs, id: \.0, selection: $model.settingsTab) { tab in Label(tab.1, systemImage: tab.2).tag(tab.0) }.listStyle(.sidebar).frame(width: 165)
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        switch model.settingsTab {
                        case "mail": mailPage
                        case "model": modelPage
                        case "permissions": permissionsPage
                        case "calendar": calendarPage
                        case "about": aboutPage
                        default: generalPage
                        }
                    }.padding(28).frame(maxWidth: .infinity, alignment: .leading).disabled(model.busy)
                }
            }
            Divider()
            HStack {
                if model.busy { ProgressView().controlSize(.small) }
                Text(localError.isEmpty ? status : localError).foregroundStyle(localError.isEmpty ? Color.secondary : Color.red).font(.callout).textSelection(.enabled)
                Spacer()
            }.padding(14).frame(minHeight: 45)
        }.frame(width: 900, height: min(700, (NSScreen.main?.visibleFrame.height ?? 850) - 100))
        .textFieldStyle(.roundedBorder)
        .interactiveDismissDisabled(dirty || model.busy)
        .onAppear { initialize() }
        .onChange(of: values) { _ in model.dirty("settings", dirty) }
        .onChange(of: mailOAuth) { _ in model.dirty("settings", dirty) }
        .onChange(of: calendarOAuth) { _ in model.dirty("settings", dirty) }
        .onDisappear { model.dirty("settings", false) }
    }
    func initialize() {
        var next = model.state["settings"]
        next["ai"] = next["ai"].picking(["baseUrl", "model", "temperature", "maxTokens"])
        next["ai"]["apiKey"] = .string(""); next["ai"]["clearApiKey"] = .bool(false)
        next["mail"] = .object(["email": .string(""), "imapHost": .string(""), "imapPort": .number(993), "smtpHost": .string(""), "smtpPort": .number(465)])
        next["mail"]["password"] = .string("")
        values = next; baseline = next
        provider = model.state["settings"]["mail"]["provider"].string == "imap" ? "imap" : "google"
    }
    func string(_ group: String, _ key: String) -> Binding<String> {
        Binding(get: { values[group][key].string }, set: { values[group][key] = .string($0) })
    }
    func boolean(_ group: String, _ key: String) -> Binding<Bool> {
        Binding(get: { values[group][key].bool }, set: { values[group][key] = .bool($0) })
    }
    func number(_ group: String, _ key: String) -> Binding<Int> {
        Binding(get: { Int(values[group][key].number) }, set: { values[group][key] = .number(Double($0)) })
    }
    func nestedBool(_ group: String, _ key: String) -> Binding<Bool> {
        Binding(get: { values["policy"][group][key].bool }, set: { values["policy"][group][key] = .bool($0) })
    }
    func field(_ title: String, _ group: String, _ key: String, secure: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.headline)
            if secure { SecureField(title, text: string(group, key)) } else { TextField(title, text: string(group, key)) }
        }
    }
    var generalPage: some View {
        Group {
            SectionHeading(title: "Make yourself at home", detail: "Choose how Morrow looks, writes, and keeps your inbox up to date.")
            field("Display name", "preferences", "displayName")
            GroupBox("Email footer") {
                VStack(alignment: .leading, spacing: 12) {
                    Picker("Format", selection: string("preferences", "signatureFormat")) { Text("Plain text").tag("plain"); Text("HTML").tag("html") }
                    TextArea(title: values["preferences"]["signatureFormat"].string == "html" ? "HTML source" : "Signature", text: string("preferences", "signature"), height: 95)
                    Text("Added to new messages and replies across your accounts. Saved drafts keep their existing footer. HTML supports text styles, tables and links; images and active content are removed.").font(.caption).foregroundStyle(.secondary)
                    Button("Preview Footer") {
                        run {
                            let result = try await model.request("/signature/preview", method: "POST", body: values["preferences"].picking(["signature", "signatureFormat"]))
                            footerPreview = result["footer"]
                        }
                    }
                    if !footerPreview.isNull { FooterPreview(footer: footerPreview) }
                }.padding(8)
                .onChange(of: values["preferences"]["signature"]) { _ in footerPreview = .null }
                .onChange(of: values["preferences"]["signatureFormat"]) { _ in footerPreview = .null }
            }
            HStack {
                Picker("Appearance", selection: string("preferences", "theme")) { Text("System").tag("system"); Text("Light").tag("light"); Text("Dark").tag("dark") }
                Picker("Density", selection: string("preferences", "density")) { Text("Comfortable").tag("comfortable"); Text("Compact").tag("compact"); Text("Spacious").tag("spacious") }
            }
            Toggle("Mark messages read when opened", isOn: boolean("preferences", "markReadOnOpen")).toggleStyle(.checkbox)
            Picker("Reply tone", selection: string("preferences", "replyTone")) { ForEach(["friendly", "professional", "concise", "warm"], id: \.self) { Text($0.capitalized).tag($0) } }
            field("Preferred language", "preferences", "language")
            Picker("Sync while Morrow is open", selection: number("preferences", "syncInterval")) { Text("Manually").tag(0); ForEach([5, 15, 30], id: \.self) { Text("Every \($0) minutes").tag($0) } }
            Button("Save Preferences") { save("preferences") }.buttonStyle(.borderedProminent)
        }
    }
    var modelPage: some View {
        Group {
            SectionHeading(title: "Your inbox. Your model.", detail: "Connect any OpenAI-compatible endpoint, including a local Ollama server.")
            field("API base URL", "ai", "baseUrl")
            Text("Include /v1 when your provider requires it. Remote endpoints require HTTPS.").font(.caption).foregroundStyle(.secondary)
            field("Model ID", "ai", "model")
            field("API key (optional for local models)", "ai", "apiKey", secure: true)
            Text(model.state["settings"]["ai"]["hasApiKey"].bool ? "Leave blank to keep the saved key at the same base URL." : "No key is stored.").font(.caption).foregroundStyle(.secondary)
            Toggle("Remove saved API key", isOn: boolean("ai", "clearApiKey")).toggleStyle(.checkbox)
            HStack {
                Text("Temperature")
                Slider(value: Binding(get: { values["ai"]["temperature"].number }, set: { values["ai"]["temperature"] = .number($0) }), in: 0...2, step: 0.1)
                Text(values["ai"]["temperature"].number, format: .number.precision(.fractionLength(1))).monospacedDigit().frame(width: 35)
            }
            Stepper("Maximum response tokens: \(Int(values["ai"]["maxTokens"].number))", value: number("ai", "maxTokens"), in: 128...4096, step: 128)
            Text("Test connection sends a fixed prompt without mail content. It does not save your settings.").font(.callout).foregroundStyle(.secondary)
            HStack {
                Button("Test Connection") {
                    run {
                        let result = try await model.request("/settings/ai/test", method: "POST", body: values["ai"])
                        status = result["text"].string
                    }
                }
                Button("Save Model") { save("ai") }.buttonStyle(.borderedProminent)
            }
        }
    }
    var permissionsPage: some View {
        Group {
            SectionHeading(title: "Your assistant. Your boundaries.", detail: "These controls are enforced for every AI action and simulation. Manual mail and live calendar actions remain available.")
            Toggle("Enable AI assistance", isOn: boolean("policy", "enabled")).font(.headline).toggleStyle(.checkbox)
            Divider()
            Text("What your assistant can do").font(.title3.bold())
            ForEach(model.features) { feature in
                VStack(alignment: .leading, spacing: 4) {
                    Toggle(feature["label"].string + (feature["mock"].bool ? " · Simulation" : ""), isOn: nestedBool("behaviors", feature.id)).toggleStyle(.checkbox)
                    Text(feature["description"].string).font(.caption).foregroundStyle(.secondary).padding(.leading, 20)
                }
            }
            Divider()
            Text("Which folders it can use").font(.title3.bold())
            ForEach(permissionFolders, id: \.self) { folder in Toggle(folder.capitalized, isOn: nestedBool("folders", folder)).toggleStyle(.checkbox) }
            Divider()
            Text("Which information it can see").font(.title3.bold())
            ForEach([("subject", "Subject lines"), ("body", "Message bodies"), ("sender", "Senders and recipients"), ("contacts", "Local contact notes"), ("calendar", "Simulated calendar context"), ("attachments", "Sample attachment fixtures")], id: \.0) { item in Toggle(item.1, isOn: nestedBool("content", item.0)).toggleStyle(.checkbox) }
            Stepper("Maximum messages per request: \(Int(values["policy"]["maxMessages"].number))", value: number("policy", "maxMessages"), in: 1...25)
            Text("Calendar and attachment scopes here control simulations. AI never reads your connected Google or Outlook calendar.").font(.caption).foregroundStyle(.secondary)
            Button("Save Permissions") { save("policy") }.buttonStyle(.borderedProminent)
        }
    }
    var mailPage: some View {
        Group {
            SectionHeading(title: "Bring your inbox along", detail: "Connect multiple Gmail, Outlook, or IMAP accounts. View them separately or together. Sync imports the latest 50 inbox messages per account.")
            ForEach(model.accounts) { account in
                GroupBox {
                    HStack {
                        VStack(alignment: .leading) { Text(account["provider"].string.uppercased()).font(.caption).foregroundStyle(.secondary); Text(account["email"].string).font(.headline) }
                        Spacer()
                        Button("Use Mailbox") { run { try await model.selectAccount(account.id, folder: "inbox"); status = "Workspace changed." } }
                        if account["provider"].string == "imap" {
                            Button("Edit") {
                                if values["mail"] != baseline["mail"] && !model.confirmDiscard() { return }
                                provider = "imap"; values["mail"] = account["settings"].picking(["email", "imapHost", "imapPort", "smtpHost", "smtpPort"])
                                values["mail"]["password"] = .string(""); baseline["mail"] = values["mail"]
                            }
                        }
                        Button("Disconnect") {
                            guard model.confirm("Disconnect \(account["email"].string)?", detail: "Only this account’s credentials will be removed. Cached mail and drafts remain on this Mac.") else { return }
                            run { model.state = try await model.request("/account/disconnect", method: "POST", body: .object([:]), mailbox: account.id); model.selectedMessage = nil; status = "Mailbox disconnected." }
                        }
                    }.padding(6)
                }
            }
            HStack {
                Button("Combined Inbox") { run { try await model.selectAccount("all", folder: "inbox") } }.disabled(model.accounts.isEmpty)
                Button("Demo Workspace") { run { try await model.selectAccount("demo", folder: "inbox") } }
                Button("Add Another Account") {
                    if values["mail"] != baseline["mail"] && !model.confirmDiscard() { return }
                    values["mail"] = .object(["email": .string(""), "imapHost": .string(""), "imapPort": .number(993), "smtpHost": .string(""), "smtpPort": .number(465), "password": .string("")]); baseline["mail"] = values["mail"]
                }
            }
            Text("Add or reconnect an account").font(.headline)
            Picker("Provider", selection: $provider) { Text("Gmail").tag("google"); Text("Outlook").tag("microsoft"); Text("IMAP / SMTP").tag("imap") }.pickerStyle(.segmented)
            if provider == "imap" {
                field("Email address", "mail", "email")
                field("App password", "mail", "password", secure: true)
                Text("A blank password keeps the existing one only when the email and both servers are unchanged.").font(.caption).foregroundStyle(.secondary)
                field("IMAP hostname", "mail", "imapHost")
                HStack { Text("IMAP TLS port"); TextField("993", value: number("mail", "imapPort"), format: .number.grouping(.never)).frame(width: 100) }
                field("SMTP hostname", "mail", "smtpHost")
                Picker("SMTP security", selection: number("mail", "smtpPort")) { Text("465 · TLS").tag(465); Text("587 · STARTTLS").tag(587) }
                Button("Connect & Sync") { save("mail") }.buttonStyle(.borderedProminent)
            } else {
                oauthForm(provider, calendar: false)
            }
            Text("Read, star, archive, and trash shortcuts stay local. The Move / Labels dialog applies reviewed changes on the provider. Sending contacts your provider only after you review and send. Mail is plain text without attachments.").font(.caption).foregroundStyle(.secondary)
        }
    }
    var calendarPage: some View {
        Group {
            SectionHeading(title: "A little space in your day", detail: "Connect Google and Outlook calendars independently of your mailbox. Both can stay connected together.")
            ForEach(["google", "microsoft"], id: \.self) { id in
                GroupBox(providerLabel(id) + " Calendar") {
                    VStack(alignment: .leading, spacing: 16) {
                        let connection = model.state["settings"]["calendars"].array.first { $0["provider"].string == id } ?? .null
                        if connection["connected"].bool {
                            HStack {
                                Label(connection["email"].string, systemImage: "checkmark.circle.fill").foregroundStyle(morrowGreen)
                                Spacer()
                                Button("Disconnect") {
                                    guard model.confirm("Disconnect \(providerLabel(id)) Calendar?", detail: "Saved credentials will be removed. Existing events will not change.") else { return }
                                    run {
                                        _ = try await model.request("/calendars/\(id)/disconnect", method: "POST", body: .object(["connectionEmail": connection["email"]]))
                                        try await model.reload(); status = "Calendar disconnected."
                                    }
                                }
                            }
                        }
                        oauthForm(id, calendar: true)
                    }.padding(12)
                }
            }
            Text("Calendar creates require your explicit review. Events have no attendees, and no invitations are sent. AI Studio’s scheduling tools remain local simulations.").font(.caption).foregroundStyle(.secondary)
        }
    }
    func oauthForm(_ id: String, calendar: Bool) -> some View {
        let credentials = Binding<JSON>(get: { calendar ? calendarOAuth[id] : mailOAuth[id] }, set: { if calendar { calendarOAuth[id] = $0 } else { mailOAuth[id] = $0 } })
        let clientID = Binding<String>(get: { credentials.wrappedValue["clientId"].string }, set: { credentials.wrappedValue["clientId"] = .string($0) })
        let secret = Binding<String>(get: { credentials.wrappedValue["clientSecret"].string }, set: { credentials.wrappedValue["clientSecret"] = .string($0) })
        let port = model.baseURL?.port ?? 3001
        return VStack(alignment: .leading, spacing: 12) {
            Text(id == "google" ? "Register a Desktop app OAuth client in Google Cloud. Enable the \(calendar ? "Calendar" : "Gmail") API and add yourself as a test user." : "Register a Mobile and desktop application in Microsoft Entra. Enable public client flows; no client secret is needed.").font(.callout).foregroundStyle(.secondary)
            Text("Callback URL").font(.caption.bold())
            Text("http://localhost:\(port)/api/\(calendar ? "calendar-oauth" : "oauth")/\(id)/callback").font(.system(.caption, design: .monospaced)).textSelection(.enabled)
            Text("Desktop loopback ports change each launch. Microsoft matches this localhost path independently of the port.").font(.caption).foregroundStyle(.secondary)
            TextField("Application / client ID", text: clientID)
            if id == "google" { SecureField("Desktop client secret", text: secret) }
            if !calendar {
                Toggle("Allow moving mail and managing labels", isOn: Binding(get: { credentials.wrappedValue["organize"].bool }, set: { credentials.wrappedValue["organize"] = .bool($0) })).toggleStyle(.checkbox)
                Text("Adds Gmail modify or Outlook Mail.ReadWrite permission. Reconnect an existing account to enable provider moves.").font(.caption).foregroundStyle(.secondary)
            }
            HStack {
                Button("Connect \(providerLabel(id))\(calendar ? " Calendar" : " Mail")") {
                    run {
                        let path = calendar ? "/calendars/\(id)/connect" : "/oauth/\(id)/start"
                        let result = try await model.request(path, method: "POST", body: credentials.wrappedValue)
                        try model.openOAuth(result, provider: id, calendar: calendar)
                        credentials.wrappedValue = .object([:]); status = "Complete sign-in in your browser, then return here."
                    }
                }.buttonStyle(.borderedProminent).disabled(clientID.wrappedValue.trimmingCharacters(in: .whitespaces).isEmpty || (id == "google" && secret.wrappedValue.isEmpty))
                Button("Refresh Status") { run { try await model.reload(); status = "Connection status refreshed." } }
            }
        }
    }
    var aboutPage: some View {
        Group {
            HStack(spacing: 16) {
                Image(nsImage: NSApplication.shared.applicationIconImage).resizable().frame(width: 70, height: 70)
                VStack(alignment: .leading) { Text("Morrow Mail").font(.largeTitle.bold()); Text("A little more room to think.").foregroundStyle(.secondary) }
            }
            HStack {
                Link("GitHub", destination: URL(string: "https://github.com/Coke1120/genmail")!)
                Link("GitHub Sponsors", destination: URL(string: "https://github.com/sponsors/Coke1120")!)
                Link("Buy Me a Coffee", destination: URL(string: "https://buymeacoffee.com/Coke1120")!)
            }
            Text("An independent, MIT-licensed alternative inspired by GenMail. A native SwiftUI interface with a private local mail service.")
            Text("19 AI behaviors: model-backed assistance and explicitly labeled local simulations. Nothing sends automatically. Provider setup and consent are required for real accounts.")
            Divider()
            Text("Data on this Mac").font(.headline)
            Text(model.dataDirectory.path).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
            Text("Mail is stored in plaintext SQLite. Credentials are encrypted with a key in the same private folder. Back up both the database and the key.").foregroundStyle(.secondary)
            Button("Show Data Folder") { NSWorkspace.shared.open(model.dataDirectory) }
            Button("Open Setup Guide") { NSWorkspace.shared.open(Bundle.main.resourceURL!.appendingPathComponent("backend/README.md")) }
            Button("Back Up Workspace…") { backup() }
            Text("Version \(Bundle.main.object(forInfoDictionaryKey: "MorrowReleaseVersion") as? String ?? "development") · macOS \(Bundle.main.object(forInfoDictionaryKey: "LSMinimumSystemVersion") as? String ?? "13.5") or later · MIT license").font(.caption).foregroundStyle(.secondary)
        }
    }
    func save(_ group: String) {
        run {
            let result = try await model.request("/settings/\(group)", method: "POST", body: values[group])
            model.state = result
            if group == "preferences" { values[group] = result["settings"][group] }
            if group == "ai" { values[group]["apiKey"] = .string(""); values[group]["clearApiKey"] = .bool(false) }
            if group == "mail" { values[group]["password"] = .string("") }
            baseline[group] = values[group]; model.dirty("settings", dirty)
            status = "\(group == "ai" ? "Model" : group.capitalized) settings saved."
        }
    }
    func run(_ work: @escaping @MainActor () async throws -> Void) {
        localError = ""; status = ""
        model.perform { do { try await work() } catch { localError = error.localizedDescription } }
    }
    func close() { if !dirty || model.confirmDiscard() { dismiss() } }
    func backup() {
        let panel = NSSavePanel(); panel.title = "Back Up Morrow Mail"; panel.nameFieldStringValue = "Morrow-Backup-" + Date().formatted(.iso8601.year().month().day().dateSeparator(.dash))
        panel.canCreateDirectories = true
        guard panel.runModal() == .OK, let destination = panel.url else { return }
        run {
            let resources = Bundle.main.resourceURL!
            let process = Process(); process.executableURL = resources.appendingPathComponent("node")
            process.arguments = [resources.appendingPathComponent("backend/scripts/backup.js").path, destination.path]
            process.environment = ["DATA_DIR": model.dataDirectory.path, "PATH": "/usr/bin:/bin"]
            process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
            try process.run()
            await Task.detached { process.waitUntilExit() }.value
            guard process.terminationStatus == 0 else { throw APIError("Backup failed. Choose a new destination that does not already exist.") }
            status = "Verified backup saved."; NSWorkspace.shared.activateFileViewerSelecting([destination])
        }
    }
}
