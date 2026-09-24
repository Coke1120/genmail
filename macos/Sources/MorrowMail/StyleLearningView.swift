import SwiftUI

struct StyleLearningView: View {
    @EnvironmentObject var model: AppModel
    @Binding var dirty: Bool
    @State private var options: JSON = .null
    @State private var voice = ""
    @State private var error = ""
    var value: JSON { model.state["workspace"]["styleLearning"] }
    var preview: JSON { value["preview"] }
    var changed: Bool { options != value["settings"] || voice != preview["voice"].string }
    func flag(_ key: String) -> Binding<Bool> {
        Binding(get: { options[key].bool }, set: { options[key] = .bool($0); if key == "enabled" && !$0 { options["weekly"] = .bool(false) } })
    }
    func number(_ key: String) -> Binding<Int> { Binding(get: { Int(options[key].number) }, set: { options[key] = .number(Double($0)) }) }
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            SectionHeading(title: "Learn my writing style", detail: "Optional, per account. Only your own Sent text is analyzed. Contact and project memory remain separate. Importing mail does not use AI tokens.")
            Text(model.state["account"]["mode"].string == "live" ? model.state["account"].id : "Choose an individual connected account in the sidebar.").font(.headline)
            VStack(alignment: .leading, spacing: 16) {
                Toggle("Enable writing-style learning for this account", isOn: flag("enabled")).toggleStyle(.checkbox)
                Toggle("Analyze newly sent mail weekly", isOn: flag("weekly")).toggleStyle(.checkbox).disabled(!options["enabled"].bool)
                Text("Weekly analysis uses cached Sent mail and this budget while Morrow is open. Enable mail refresh to capture mail sent elsewhere. Updates always require review and Save; a pending preview pauses the next analysis.").font(.caption).foregroundStyle(.secondary)
                Picker("Sent history", selection: number("months")) { ForEach([1, 3, 6, 12], id: \.self) { Text("Last \($0) month(s)").tag($0) } }
                Stepper("Maximum samples: \(Int(options["maxSamples"].number))", value: number("maxSamples"), in: 1...50)
                Text("Also limited by AI Permissions → Maximum messages (currently \(Int(model.policy["maxMessages"].number))).").font(.caption).foregroundStyle(.secondary)
                HStack { Text("Token budget per analysis"); TextField("16000", value: number("tokenBudget"), format: .number.grouping(.never)).frame(width: 120) }
                Text("4,000–64,000 tokens. Conservative UTF-8 estimate including response allowance; custom model billing may differ. No currency estimate.").font(.caption).foregroundStyle(.secondary)
                HStack {
                    Button("Save Learning Settings") { action("settings", body: options) }.buttonStyle(.borderedProminent).disabled(preview["status"].string == "running")
                    Button("Preview Samples · No AI Call") { action("preview") }.disabled(changed || !value["permitted"].bool || preview["status"].string == "running")
                }
                if !value["permitted"].bool { Text("Requires saved learning opt-in plus AI Permissions: AI on, Email Brain, Sent, and email body access.").font(.callout).foregroundStyle(.secondary) }
                if !preview.isNull { previewPanel }
                if !value["profile"].isNull {
                    GroupBox("Saved writing style") {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(value["profile"]["active"].bool ? "Active for writing and replies" : "Inactive under current permissions or source scope").font(.caption).foregroundStyle(.secondary)
                            Text(value["profile"]["voice"].string).textSelection(.enabled)
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(6)
                    }
                }
                Button("Delete Learned Style & Stop Learning") {
                    guard model.confirm("Delete this account’s learned style?", detail: "The style and sample preview will be deleted, and learning turned off. Mail is retained.") else { return }
                    action("profile", method: "DELETE")
                }
            }.disabled(model.busy || model.state["account"]["mode"].string != "live")
            if !error.isEmpty { Text(error).foregroundStyle(.red).textSelection(.enabled) }
        }
        .onAppear { load() }
        .onChange(of: value["settings"]) { _ in if !dirty { load() } }
        .onChange(of: preview.id) { _ in if !dirty { load() } }
        .onChange(of: preview["voice"]) { _ in if !dirty { load() } }
        .onChange(of: options) { _ in dirty = changed }
        .onChange(of: voice) { _ in dirty = changed }
        .onDisappear { dirty = false }
    }
    var previewPanel: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 12) {
                Text("\(preview["status"].string.capitalized) · \(Int(preview["sampleCount"].number)) / \(Int(preview["eligible"].number)) useful samples").font(.headline)
                Text("Estimated tokens ≤ \(Int(preview["estimatedTokens"].number)) · Budget \(Int(preview["tokenBudget"].number)) · Effective sample cap \(Int(preview["effectiveCap"].number))").font(.caption)
                Text("Quote/signature removal is heuristic. Review the exact text below.").font(.caption).foregroundStyle(.secondary)
                DisclosureGroup("Review text sent to the model") {
                    ForEach(Array(preview["samples"].array.enumerated()), id: \.offset) { index, sample in
                        VStack(alignment: .leading) { Text("Sample \(index + 1)").font(.caption.bold()); Text(sample["body"].string).textSelection(.enabled); Divider() }.padding(.vertical, 6)
                    }
                }
                if preview["error"].nonempty { Text(preview["error"].string).foregroundStyle(.orange) }
                if preview["status"].string == "prepared" {
                    Button("Analyze These Samples · Uses AI") { action("generate", body: .object(["previewId": .string(preview.id)])) }.buttonStyle(.borderedProminent).disabled(changed)
                }
                if preview["status"].string == "ready" {
                    TextArea(title: "Review and edit proposed style", text: $voice, height: 150)
                    Text(preview["usage"]["total_tokens"].isNull ? "Provider token usage not supplied." : "Provider-reported tokens: \(Int(preview["usage"]["total_tokens"].number))").font(.caption)
                    Button("Save Approved Style") { action("apply", body: .object(["previewId": .string(preview.id), "voice": .string(voice)])) }.buttonStyle(.borderedProminent).disabled(voice.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || voice.count > 2000 || options != value["settings"])
                }
            }.padding(8).frame(maxWidth: .infinity, alignment: .leading)
        }
    }
    func load() { options = value["settings"]; voice = preview["voice"].string; dirty = false }
    func action(_ path: String, body: JSON = .object([:]), method: String = "POST") {
        let owner = model.state["account"].id
        if ["settings", "preview"].contains(path) && preview["status"].string == "ready" && !model.confirm("Replace the current style proposal?", detail: "Your approved style will be retained.") { return }
        error = ""
        model.perform {
            do { model.state = try await model.request("/style/\(path)", method: method, body: body, mailbox: owner); load() }
            catch { self.error = error.localizedDescription; try? await model.reload() }
        }
    }
}
