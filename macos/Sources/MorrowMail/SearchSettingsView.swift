import SwiftUI

struct NativeSearchSettingsView: View {
    @EnvironmentObject var model: AppModel
    @Binding var dirty: Bool
    @Binding var operationBusy: Bool
    @State private var value: JSON = .null
    @State private var options: JSON = .null
    @State private var baseline: JSON = .null
    @State private var error = ""
    @State private var busy = false
    var indexing: Bool { value["job"]["status"].string == "running" }
    var changed: Bool { options != baseline }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            SectionHeading(title: "Search & Semantic Indexing", detail: "Keyword search stays local. Smart search (智慧搜尋) uses a separate embedding model, only within your approved scope. Indexing is optional and each batch needs review.")
            if options.isNull { ProgressView("Loading search settings…") }
            else {
                configuration.disabled(busy || indexing)
                Text("\(Int(value["indexed"].number)) / \(Int(value["eligible"].number)) eligible messages indexed · \(Int(value["pending"].number)) pending").font(.headline)
                Text(value["local"].bool ? "Local embedding endpoint" : "Remote embedding endpoint — approved mail text leaves this device").font(.callout)
                Text("Only downloaded mail is searchable. New or modified mail needs another reviewed batch; indexing never starts a paid request automatically.").font(.caption).foregroundStyle(.secondary)
                if !value["job"].isNull { jobPanel }
                Button("Clear Semantic Index / Cancel Batch") {
                    if model.confirm("Delete semantic vectors and cancel indexing?", detail: "Your mail and keyword index stay available.") { action("index/clear") }
                }.disabled(busy)
            }
            if busy { ProgressView().controlSize(.small) }
            if !error.isEmpty { Text(error).foregroundStyle(.red).textSelection(.enabled) }
        }
        .task { do { let next = try await model.request("/search/settings"); initialize(next) } catch { self.error = error.localizedDescription } }
        .task(id: indexing) {
            guard indexing else { return }
            while !Task.isCancelled {
                do { try await Task.sleep(nanoseconds: 1_500_000_000); value = try await model.request("/search/settings"); error = "" } catch { if Task.isCancelled { return }; self.error = error.localizedDescription }
            }
        }
        .onChange(of: options) { _ in dirty = changed }
        .onChange(of: busy) { _ in operationBusy = busy || indexing }
        .onChange(of: indexing) { _ in operationBusy = busy || indexing }
        .onDisappear { dirty = false; operationBusy = false }
    }
    var configuration: some View {
        VStack(alignment: .leading, spacing: 14) {
            Toggle("Enable Smart Search", isOn: flag("enabled")).toggleStyle(.checkbox)
            Picker("Embedding protocol", selection: text("protocol")) { Text("OpenAI-compatible /embeddings").tag("openai"); Text("Ollama native /api/embed").tag("ollama") }
            field("Embedding base URL", "baseUrl")
            Text("Local OpenAI-compatible: http://127.0.0.1:11434/v1. Ollama native: http://127.0.0.1:11434. Remote endpoints require HTTPS.").font(.caption).foregroundStyle(.secondary)
            field("Embedding model ID", "model")
            Text("Use an embedding model, not a chat-only model. A change of model or scope invalidates existing vectors.").font(.caption).foregroundStyle(.secondary)
            VStack(alignment: .leading) { Text("Embedding API key").font(.caption); SecureField("Optional for local models", text: text("apiKey")) }
            Text(value["settings"]["hasApiKey"].bool ? "Leave blank to keep the saved key at the same base URL." : "No embedding API key saved.").font(.caption).foregroundStyle(.secondary)
            Toggle("Remove saved key", isOn: flag("clearApiKey")).toggleStyle(.checkbox)
            GroupBox("Accounts to index") { VStack(alignment: .leading) { ForEach(model.accounts) { account in
                Toggle(account["email"].string, isOn: Binding(get: { options["accounts"].array.contains(.string(account.id)) }, set: { selected in
                    var values = options["accounts"].array.filter { $0 != .string(account.id) }; if selected { values.append(.string(account.id)) }; options["accounts"] = .array(values)
                })).toggleStyle(.checkbox)
            } }.frame(maxWidth: .infinity, alignment: .leading).padding(6) }
            HStack(alignment: .top) { scopeGroup("Folders", "folders"); scopeGroup("Allowed Content", "content") }
            Text("Global AI permissions also apply. Unchecked fields and folders are excluded before embedding requests. Each account is indexed in separate requests.").font(.caption).foregroundStyle(.secondary)
            Picker("Index history", selection: number("months")) { ForEach([1, 3, 6, 12], id: \.self) { Text("Last \($0) month(s)").tag($0) } }
            HStack { Text("Estimated token budget per batch"); TextField("16000", value: number("tokenBudget"), format: .number.grouping(.never)).frame(width: 120) }
            Text("4,000–64,000 tokens. Conservative UTF-8 estimate, not a billing guarantee. Batches also respect the global message limit and at most 50 text chunks. Unchanged text is reused.").font(.caption).foregroundStyle(.secondary)
            HStack {
                Button("Save Search Settings") { action("settings", body: options) }.buttonStyle(.borderedProminent)
                Button("Preview Next Batch · No AI Call") { action("index/preview") }.disabled(changed || !options["enabled"].bool || !value["permitted"].bool)
            }
        }
    }
    var jobPanel: some View {
        GroupBox("Indexing batch") {
            VStack(alignment: .leading, spacing: 8) {
                Text("\(value["job"]["status"].string) · \(Int(value["job"]["completed"].number)) / \(Int(value["job"]["sampleCount"].number)) messages").font(.headline)
                Text("\(Int(value["job"]["chunks"].number)) chunks · estimated tokens ≤ \(Int(value["job"]["estimatedTokens"].number)) · \(Int(value["job"]["oversized"].number)) oversized messages excluded.").font(.caption)
                if value["job"]["error"].nonempty { Text(value["job"]["error"].string).foregroundStyle(.red) }
                if !value["samples"].array.isEmpty {
                    DisclosureGroup("Review excerpts (first three messages)") {
                        ForEach(Array(value["samples"].array.enumerated()), id: \.offset) { item in VStack(alignment: .leading) { Text(item.element["account"].string).bold(); Text(item.element["text"].string).textSelection(.enabled) }.font(.caption).padding(.vertical, 6) }
                    }
                }
                if value["job"]["status"].string == "prepared" { Button("Index Reviewed Batch · Uses Embeddings") { action("index/run", body: .object(["previewId": .string(value["job"].id)])) }.buttonStyle(.borderedProminent).disabled(changed || busy) }
            }.frame(maxWidth: .infinity, alignment: .leading).padding(8)
        }
    }
    func text(_ key: String) -> Binding<String> { Binding(get: { options[key].string }, set: { options[key] = .string($0) }) }
    func flag(_ key: String) -> Binding<Bool> { Binding(get: { options[key].bool }, set: { options[key] = .bool($0) }) }
    func number(_ key: String) -> Binding<Int> { Binding(get: { Int(options[key].number) }, set: { options[key] = .number(Double($0)) }) }
    func field(_ title: String, _ key: String) -> some View { VStack(alignment: .leading, spacing: 3) { Text(title).font(.caption); TextField(title, text: text(key)) } }
    func scopeGroup(_ title: String, _ group: String) -> some View {
        GroupBox(title) { VStack(alignment: .leading) { ForEach(options[group].object.keys.sorted(), id: \.self) { key in Toggle(key == "sender" ? "Sender / To / Cc / Bcc" : key.capitalized, isOn: Binding(get: { options[group][key].bool }, set: { options[group][key] = .bool($0) })).toggleStyle(.checkbox) } }.frame(maxWidth: .infinity, alignment: .leading).padding(6) }
    }
    func initialize(_ next: JSON) {
        value = next; var fields = next["settings"].picking(["enabled", "baseUrl", "model", "protocol", "accounts", "months", "tokenBudget", "folders", "content"])
        fields["apiKey"] = .string(""); fields["clearApiKey"] = .bool(false); options = fields; baseline = fields; dirty = false
    }
    func action(_ path: String, body: JSON = .object([:])) {
        guard !busy else { return }; busy = true; error = ""
        Task { defer { busy = false }; do { let next = try await model.request("/search/" + path, method: "POST", body: body); if path == "settings" { initialize(next) } else { value = next } } catch { self.error = error.localizedDescription } }
    }
}
