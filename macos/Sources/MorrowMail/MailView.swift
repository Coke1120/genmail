import SwiftUI
import AppKit

struct MailWorkspace: View {
    @AppStorage("collapsedMailAccounts") private var collapsedAccounts = "[]"
    @EnvironmentObject var model: AppModel
    var filtered: [JSON] {
        if !model.searchResponse.isNull { return model.searchResponse["messages"].array }
        return model.listedMessages
    }
    var body: some View {
        Group {
            if model.starting {
                VStack(spacing: 20) { Image(systemName: "sunrise.fill").font(.system(size: 48)).foregroundStyle(morrowGreen); Text("Morrow Mail").font(.largeTitle); ProgressView("Opening your workspace…") }.frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if model.state.isNull {
                VStack { EmptyPane(title: "Morrow couldn’t start", detail: model.error, symbol: "exclamationmark.triangle"); Button("Try Again") { Task { await model.start() } }.padding(.bottom, 40) }
            } else {
              VStack(spacing: 0) {
                NavigationSplitView {
                    sidebar.navigationSplitViewColumnWidth(min: 220, ideal: 240, max: 300)
                } detail: {
                    if model.section == "studio" {
                        if model.combined {
                            VStack(spacing: 16) {
                                EmptyPane(title: "Choose an account for AI Studio", detail: "Each mailbox has its own AI context, skills, and activity.", symbol: "envelope.badge.shield.half.filled")
                                ForEach(model.accounts) { account in Button(account["email"].string) { model.perform { try await model.selectAccount(account.id) } } }
                                Button("Use Demo Workspace") { model.perform { try await model.selectAccount("demo") } }
                            }.padding(30)
                        } else { StudioView().id(model.account) }
                    }
                    else if model.section == "calendar" { NativeCalendarView() }
                    else {
                        VStack(spacing: 0) {
                          NativeMailSearch().id(model.account + ":" + model.section)
                          HSplitView {
                            messageList.frame(minWidth: 260, idealWidth: 310, maxWidth: 360)
                            if let message = model.current {
                                if model.messageDetail.viewID == message.viewID { MessageReader(message: message).frame(minWidth: 320) }
                                else {
                                    VStack {
                                        if model.error.isEmpty { ProgressView("Loading message…") }
                                        else { Button("Retry loading message") { Task { await model.loadMessage() } } }
                                    }.frame(minWidth: 320, maxWidth: .infinity)
                                }
                            }
                            else { EmptyPane(title: "A little room to think", detail: "Choose a message to read, or compose something new.", symbol: "envelope.open").frame(minWidth: 320) }
                          }
                        }
                    }
                }
                .toolbar {
                    ToolbarItemGroup {
                        if model.busy { ProgressView().controlSize(.small) }
                        Button { model.perform { try await model.sync() } } label: { Label("Sync Mail", systemImage: "arrow.clockwise") }.disabled(!model.canNavigate).help("Sync latest 50 messages per selected import folder")
                        Button { model.newDraft() } label: { Label("Compose", systemImage: "square.and.pencil") }.disabled(model.busy).help("New message (⌘N)")
                    }
                }
                    if !model.error.isEmpty { statusBar(model.error, error: true) }
                    else if !model.notice.isEmpty { statusBar(model.notice, error: false) }
                    else if model.busy { HStack { ProgressView().controlSize(.small); Text("Working…").foregroundStyle(.secondary); Spacer() }.padding(9).background(.bar) }
              }
            }
        }
        .task(id: model.mailQueryKey) { await model.loadMailPage() }
        .task(id: (model.current?.viewID ?? "") + model.state["revision"].string) { await model.loadMessage() }
        .onChange(of: model.section) { section in if section != "studio" { model.selectedMessage = nil; model.messageDetail = .null }; model.mailPage = .null }
        .sheet(item: $model.compose) { draft in ComposeView(initial: draft).environmentObject(model) }
        .sheet(item: $model.organizing) { message in OrganizeMailView(message: message).environmentObject(model) }
        .sheet(isPresented: $model.showSettings) { NativeSettingsView().environmentObject(model) }
    }
    var sidebar: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "sunrise.fill").font(.title2).foregroundStyle(morrowGreen)
                VStack(alignment: .leading) { Text("Morrow").font(.title2.weight(.bold)); Text("A calmer kind of inbox").font(.caption).foregroundStyle(.secondary) }
                Spacer()
            }.padding(18)
            List(selection: Binding(get: { mailFolders.contains(model.section) ? model.account + "\n" + model.section : model.section }, set: { value in
                guard model.canNavigate else { return }
                let parts = value.components(separatedBy: "\n")
                if parts.count == 2 {
                    if parts[0] == model.account { model.section = parts[1] }
                    else { model.perform { try await model.selectAccount(parts[0], folder: parts[1]) } }
                } else { model.section = value }
            })) {
                if !model.accounts.isEmpty {
                    accountGroup("all", title: "All accounts", subtitle: "Combined mail", symbol: "tray.2")
                    ForEach(model.accounts) { account in
                        accountGroup(account.id, title: account["email"].string, subtitle: account["provider"].string == "imap" ? "IMAP" : providerLabel(account["provider"].string), symbol: "envelope")
                    }
                }
                accountGroup("demo", title: "Demo workspace", subtitle: "Sample mail", symbol: "leaf")
                Section("Workspace") {
                    Label("AI Studio", systemImage: "sparkles").tag("studio")
                    Label("Calendar", systemImage: "calendar").tag("calendar")
                }
            }.listStyle(.sidebar)
            Button { model.settings("mail") } label: { Label("Add account", systemImage: "plus") }.buttonStyle(.plain).padding(12).disabled(model.busy)
            Divider()
            Button { model.settings() } label: { Label("Settings & connections", systemImage: "gearshape") }
                .buttonStyle(.plain).disabled(model.busy).frame(maxWidth: .infinity, alignment: .leading).padding(18).fixedSize(horizontal: false, vertical: true)
        }
    }
    func accountGroup(_ account: String, title: String, subtitle: String, symbol: String) -> some View {
        let collapsed = Set((try? JSONDecoder().decode([String].self, from: Data(collapsedAccounts.utf8))) ?? [])
        return DisclosureGroup(isExpanded: Binding(get: { !collapsed.contains(account) }, set: { expanded in
            var next = collapsed
            if expanded { next.remove(account) } else { next.insert(account) }
            if let data = try? JSONEncoder().encode(next.sorted()), let value = String(data: data, encoding: .utf8) { collapsedAccounts = value }
        })) { folderRows(account) } label: {
            HStack(spacing: 8) {
                Image(systemName: symbol).foregroundStyle(morrowGreen)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.system(size: 12, weight: .semibold)).lineLimit(2).fixedSize(horizontal: false, vertical: true)
                    Text(subtitle).font(.caption2).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                let count = folderCount(account, "inbox")
                if count > 0 { Text("\(count)").font(.caption2.monospacedDigit()).foregroundStyle(.secondary) }
            }.padding(.vertical, 5).help(title)
        }.accessibilityIdentifier("accountGroup.\(account)")
    }
    func folderRows(_ account: String) -> some View {
        ForEach(mailFolders, id: \.self) { folder in
            HStack {
                Label(folder.capitalized, systemImage: ["inbox": "tray", "starred": "star", "sent": "paperplane", "drafts": "doc", "archive": "archivebox", "trash": "trash"][folder]!)
                Spacer()
                let count = folderCount(account, folder)
                if count > 0 && ["inbox", "drafts"].contains(folder) { Text("\(count)").font(.caption.monospacedDigit()).foregroundStyle(.secondary) }
            }.tag(account + "\n" + folder).accessibilityIdentifier("mailbox.\(account).\(folder)")
        }
    }
    func folderCount(_ account: String, _ folder: String) -> Int {
        if account == "demo" { return Int(folder == "inbox" ? model.state["demoStats"]["unread"].number : model.state["demoStats"]["counts"][folder].number) }
        return model.accounts.filter { account == "all" || $0.id == account }.reduce(0) { $0 + Int(folder == "inbox" ? $1["unread"].number : $1["counts"][folder].number) }
    }
    var messageList: some View {
        VStack(spacing: 0) {
            HStack { VStack(alignment: .leading, spacing: 3) { Text(model.section.capitalized).font(.title2.bold()); Text(model.combined ? "All accounts" : model.account == "demo" ? "Demo workspace" : model.account).font(.caption).foregroundStyle(.secondary).lineLimit(1) }; Spacer(); Toggle(isOn: $model.unreadOnly) { Image(systemName: "line.3.horizontal.decrease.circle") }.toggleStyle(.button).help("Show unread only").accessibilityLabel("Show unread only").disabled(!model.searchResponse.isNull) }.padding(16)
            HStack {
                Menu {
                    ForEach(["compact", "comfortable", "spacious"], id: \.self) { density in
                        Button { model.preference("density", density) } label: { Label(density.capitalized, systemImage: model.preferences["density"].string == density ? "checkmark" : "text.alignleft") }
                    }
                } label: { Label("View", systemImage: "list.bullet") }
                Menu {
                    ForEach(mailSortOptions, id: \.0) { option in
                        Button { model.preference("sort", option.0) } label: { Label(option.1, systemImage: model.preferences["sort"].string == option.0 ? "checkmark" : "arrow.up.arrow.down") }
                    }
                } label: { Label("Sort", systemImage: "arrow.up.arrow.down") }.disabled(!model.searchResponse.isNull)
            }.disabled(model.busy).padding(.horizontal, 14).padding(.bottom, 10)
            Divider()
            if filtered.isEmpty {
                VStack {
                    EmptyPane(title: model.searchResponse.isNull && !model.unreadOnly ? "All clear" : "No matching messages", detail: model.searchResponse.isNull ? "There are no messages in this view." : "Adjust the search filters or import more mail.", symbol: "tray")
                    if model.unreadOnly { Button("Clear Unread Filter") { model.unreadOnly = false }.padding(.bottom, 24) }
                }
            }
            else {
                List(filtered, id: \.viewID, selection: $model.selectedMessage) { message in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Circle().fill(message["read"].bool ? .clear : morrowGreen).frame(width: 6, height: 6)
                            Text(["sent", "drafts"].contains(message["folder"].string) ? "To: " + message["to"].string : message["fromName"].string).fontWeight(message["read"].bool ? .regular : .semibold).lineLimit(1)
                            Spacer(minLength: 2)
                            if message["starred"].bool { Image(systemName: "star.fill").foregroundStyle(.orange).font(.caption) }
                        }
                        searchHighlighted(message["searchSubject"], fallback: message["subject"].nonempty ? message["subject"].string : "(No subject)").font(.system(size: 13, weight: .medium)).lineLimit(1)
                        if model.preferences["density"].string != "compact" { searchHighlighted(message["searchSnippet"], fallback: message["preview"].string).foregroundStyle(.secondary).font(.caption).lineLimit(model.preferences["density"].string == "spacious" ? 4 : 2) }
                        if model.combined || !model.searchResponse.isNull { Text(message["accountId"].string).font(.caption2).foregroundStyle(morrowGreen).lineLimit(1) }
                        if message["searchMatch"].nonempty { Text(message["folder"].string + " · " + message["searchMatch"].string).font(.caption2).foregroundStyle(.secondary) }
                        Text(dateLabel(message["date"].string)).font(.caption2).foregroundStyle(.tertiary)
                        if message["deliveryStatus"].string == "unconfirmed" { Label("Check delivery", systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(.orange) }
                    }.padding(.vertical, model.preferences["density"].string == "compact" ? 3 : model.preferences["density"].string == "spacious" ? 14 : 8).tag(message.viewID)
                    .contextMenu {
                        if model.canOrganize(message) { Button("Move / Labels on Provider…") { model.organizing = message } }
                        Button(message["starred"].bool ? "Unstar" : "Star") { model.patch(message, .object(["starred": .bool(!message["starred"].bool)])) }
                        Button(message["read"].bool ? "Mark Unread" : "Mark Read") { model.patch(message, .object(["read": .bool(!message["read"].bool)])) }
                        if message["folder"].string != "drafts" { Button("Archive Locally") { model.patch(message, .object(["folder": .string("archive")])) } }
                        Button("Move to Local Trash") { model.patch(message, .object(["folder": .string("trash")])) }
                    }
                }.listStyle(.inset).disabled(model.busy)

            }
            Divider()
            if model.searchResponse.isNull {
                HStack {
                    Button("Previous") { Task { await model.turnMailPage(next: false) } }.disabled(model.mailCursors.count < 2 || model.mailLoading)
                    Spacer()
                    if model.mailLoading { ProgressView().controlSize(.small) }
                    else { Text("Page \(model.mailCursors.count) · \(Int(model.mailPage["total"].number)) messages").font(.caption2) }
                    Spacer()
                    Button("Next") { Task { await model.turnMailPage(next: true) } }.disabled(!model.mailPage["nextCursor"].nonempty || model.mailLoading)
                }.padding(10)
            }
        }
    }
    func statusBar(_ text: String, error: Bool) -> some View {
        HStack(alignment: .top) {
            Image(systemName: error ? "exclamationmark.circle" : "checkmark.circle").foregroundStyle(error ? .orange : morrowGreen)
            Text(text).font(.callout).textSelection(.enabled)
            Spacer()
            Button { if error { model.error = "" } else { model.notice = "" } } label: { Image(systemName: "xmark") }.buttonStyle(.plain).accessibilityLabel("Dismiss status")
        }.padding(12).background(.bar)
    }
}

struct MessageReader: View {
    @EnvironmentObject var model: AppModel
    let message: JSON
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                if message["folder"].string == "drafts" { Button("Edit Draft") { model.newDraft(Draft(message: message)) } }
                else { Button { model.newDraft(Draft(message: message, reply: true)) } label: { Label("Reply", systemImage: "arrowshape.turn.up.left") } }
                Spacer()
                if model.canOrganize(message) { Button { model.organizing = message } label: { Label("Move / Labels", systemImage: "folder") }.help("Move or label on this mailbox’s provider") }
                Button { model.patch(message, .object(["starred": .bool(!message["starred"].bool)])) } label: { Image(systemName: message["starred"].bool ? "star.fill" : "star") }.help("Toggle star").accessibilityLabel("Toggle star")
                if message["folder"].string != "drafts" {
                    Button { model.patch(message, .object(["folder": .string(message["folder"].string == "inbox" ? "archive" : "inbox")])) } label: { Image(systemName: message["folder"].string == "inbox" ? "archivebox" : "tray") }.help("Move locally").accessibilityLabel("Move locally")
                }
                Button { model.patch(message, .object(["folder": .string("trash")])) } label: { Image(systemName: "trash") }.help("Move to local trash").accessibilityLabel("Move to local trash")
            }.buttonStyle(.borderless).padding(18).disabled(model.busy)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    Text(message["subject"].nonempty ? message["subject"].string : "(No subject)").font(.system(size: 26, weight: .semibold)).textSelection(.enabled)
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Mailbox: " + message["accountId"].string).font(.caption).foregroundStyle(morrowGreen)
                        Text(message["fromName"].string).font(.headline)
                        Text(message["fromEmail"].string).foregroundStyle(.secondary)
                        Text("To: " + message["to"].string).font(.callout).foregroundStyle(.secondary)
                        if message["cc"].nonempty { Text("Cc: " + message["cc"].string).font(.callout).foregroundStyle(.secondary) }
                        if message["bcc"].nonempty { Text("Bcc: " + message["bcc"].string).font(.callout).foregroundStyle(.secondary) }
                        if message["providerFolderName"].nonempty { Text("Provider: " + message["providerFolderName"].string).font(.caption).foregroundStyle(morrowGreen) }
                        Text(dateLabel(message["date"].string)).font(.caption).foregroundStyle(.secondary)
                    }.textSelection(.enabled)
                    if !message["labels"].array.isEmpty { Text(message["labels"].array.map(\.string).joined(separator: " · ")).font(.caption).foregroundStyle(morrowGreen) }
                    if !message["aiSummary"].isNull {
                        GroupBox(message["aiSummary"]["source"].string == "demo" ? "Illustrative demo summary" : "New-mail AI summary") {
                            VStack(alignment: .leading, spacing: 8) {
                                ForEach(Array(message["aiSummary"]["items"].array.enumerated()), id: \.offset) { _, item in
                                    Text(item["priority"].string).font(.headline)
                                    Text(item["summary"].string).textSelection(.enabled)
                                }
                                Text(dateLabel(message["aiSummary"]["completedAt"].string) + " · Review AI priorities.").font(.caption).foregroundStyle(.secondary)
                            }.padding(8).frame(maxWidth: .infinity, alignment: .leading)
                        }
                    } else { AutomaticAssistance(messageID: message.id, account: message["accountId"].string, trigger: "onOpen") }
                    Divider()
                    Text(message["body"].string).font(.system(size: 14)).lineSpacing(7).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                    FooterPreview(footer: message["footer"])
                    Divider()
                    HStack {
                        ForEach(["summary", "reply", "translate"], id: \.self) { action in
                            Button(action == "summary" ? "Summarize" : action == "reply" ? "Suggest reply" : "Translate") {
                                model.openAssistant(action, message: message)
                            }.disabled(model.busy || !model.allowed(action))
                        }
                    }
                    Text("AI uses your saved permissions. Generated text is yours to review.").font(.caption).foregroundStyle(.secondary)
                }.padding(30)
            }
        }
    }
}

struct AutomaticAssistance: View {
    @EnvironmentObject var model: AppModel
    let messageID: String
    let account: String
    let trigger: String
    var use: ((String) -> Void)? = nil
    @State private var result: JSON = .null
    @State private var loading = false
    @State private var error = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if loading { ProgressView(trigger == "onOpen" ? "Preparing automatic summary…" : "Preparing reply suggestion…") }
            if result["text"].nonempty {
                Text(result["source"].string == "demo" ? "Automatic assistance · Illustrative demo" : "Automatic assistance · Review before using").font(.caption).foregroundStyle(.secondary)
                Text(result["text"].string).textSelection(.enabled)
                if let use { Button("Use Suggested Reply") { use(result["text"].string) }.disabled(model.busy) }
            }
            if !error.isEmpty { Text(error).font(.caption).foregroundStyle(.secondary) }
        }
        .task(id: account + "\n" + messageID + "\n" + trigger) {
            result = .null; error = ""; loading = false
            let action = trigger == "onOpen" ? "summary" : "reply", policy = model.policy, ai = model.state["settings"]["ai"], preferences = model.preferences
            guard policy["triggers"][trigger].bool, model.allowed(action) else { return }
            loading = true
            do {
                let next = try await model.request("/ai", method: "POST", body: .object(["action": .string(action), "trigger": .string(trigger), "messageId": .string(messageID)]), mailbox: account)
                if !Task.isCancelled && policy == model.policy && ai == model.state["settings"]["ai"] && preferences == model.preferences { result = next }
            } catch { if !Task.isCancelled { self.error = "Automatic assistance: " + error.localizedDescription } }
            if !Task.isCancelled { loading = false }
        }
        .onChange(of: model.policy) { _ in result = .null; error = "" }
        .onChange(of: model.state["settings"]["ai"]) { _ in result = .null; error = "" }
        .onChange(of: model.preferences) { _ in result = .null; error = "" }
    }
}

struct OrganizeMailView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) var dismiss
    let message: JSON
    @State private var folders: [JSON] = []
    @State private var destination = ""
    @State private var mode = "move"
    @State private var provider = ""
    @State private var loading = true
    @State private var localError = ""
    @State private var review = false
    var choices: [JSON] { folders.filter { mode == "move" || $0["kind"].string == "label" } }
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Move / Labels on Provider").font(.title2.bold())
            Text(message["subject"].string).lineLimit(2)
            Text(message["accountId"].string).foregroundStyle(.secondary)
            if loading { ProgressView("Loading folders…") }
            else {
                if provider == "google" {
                    Picker("Action", selection: $mode) {
                        Text("Move out of Inbox").tag("move")
                        Text("Add label").tag("addLabel")
                        Text("Remove label").tag("removeLabel")
                    }.onChange(of: mode) { _ in destination = choices.first?.id ?? "" }
                }
                Picker(provider == "google" ? "Label / location" : "Folder", selection: $destination) {
                    Text("Choose a destination").tag("")
                    ForEach(choices) { folder in Text(folder["name"].string).tag(folder.id) }
                }
                Text("This changes the message on your mail provider. Moves stay within this account. Cached messages outside Inbox remain available in local Archive; full folder synchronization is not yet supported.").font(.callout).foregroundStyle(.secondary)
                if provider == "google" { Text("Move adds the selected label and removes Inbox; other labels remain. Add / Remove label keeps the current Inbox status.").font(.caption).foregroundStyle(.secondary) }
            }
            if !localError.isEmpty { Text(localError).foregroundStyle(.red).textSelection(.enabled) }
            HStack {
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction).disabled(model.busy)
                Spacer()
                Button("Review Change") { review = true }.buttonStyle(.borderedProminent).disabled(loading || model.busy || destination.isEmpty)
            }
        }.padding(26).frame(width: 530).interactiveDismissDisabled(model.busy)
        .task {
            do {
                let result = try await model.request("/mail/folders", mailbox: message["accountId"].string)
                folders = result["folders"].array; provider = result["provider"].string
            } catch { localError = error.localizedDescription }
            loading = false
        }
        .confirmationDialog("Apply this change on your mail provider?", isPresented: $review, titleVisibility: .visible) {
            Button("Apply Provider Change") {
                model.perform {
                    do {
                        _ = try await model.request("/messages/" + encodedPath(message.id) + "/organize", method: "POST", body: .object(["destinationId": .string(destination), "mode": .string(mode), "confirmed": .bool(true)]), mailbox: message["accountId"].string)
                        try await model.reload(); model.notice = "Provider change confirmed."; dismiss()
                    } catch { localError = error.localizedDescription }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: { Text("Account: \(message["accountId"].string)\nAction: \(mode == "move" ? "Move" : mode == "addLabel" ? "Add label" : "Remove label")\nDestination: \(choices.first { $0.id == destination }?["name"].string ?? destination)") }
    }
}

struct ComposeView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) var dismiss
    let initial: Draft
    @State private var draft: Draft
    @State private var saved: JSON
    @State private var reviewed = false
    @State private var aiPrompt = ""
    @State private var aiResult = ""
    @State private var aiSource = ""
    @State private var localError = ""
    @State private var confirmSend = false
    init(initial: Draft) { self.initial = initial; _draft = State(initialValue: initial); _saved = State(initialValue: initial.payload) }
    var dirty: Bool { draft.payload != saved || (draft.savedID.isEmpty && (!draft.to.isEmpty || !draft.cc.isEmpty || !draft.bcc.isEmpty || !draft.subject.isEmpty || !draft.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)) }
    var body: some View {
        VStack(spacing: 0) {
          ScrollView {
           VStack(alignment: .leading, spacing: 16) {
            HStack { Text(draft.savedID.isEmpty ? (draft.replyToID.isEmpty ? "New message" : "Reply") : "Your draft").font(.title2.bold()); Spacer(); Text(draft.accountID == "demo" ? "Simulated send" : draft.accountID).foregroundStyle(.secondary).font(.caption) }
            if !draft.savedID.isEmpty || !draft.replyToID.isEmpty || draft.unconfirmed {
                HStack {
                    Text("From").frame(width: 36, alignment: .leading).foregroundStyle(.secondary)
                    Text(draft.accountID == "demo" ? "Demo workspace (simulated)" : draft.accountID).textSelection(.enabled)
                    Image(systemName: "lock.fill").font(.caption2).foregroundStyle(.secondary)
                }.accessibilityElement(children: .combine)
            } else {
                Picker("From", selection: $draft.accountID) {
                    ForEach(model.senderAccounts) { account in Text(account["email"].string).tag(account.id) }
                }.disabled(model.busy)
                .onChange(of: draft.accountID) { _ in aiResult = ""; draft.requestID = UUID().uuidString }
            }
            if !draft.replyToID.isEmpty { Label("Replying from the mailbox that owns this conversation", systemImage: "lock.fill").font(.caption).foregroundStyle(.secondary) }
            if !initial.replyToID.isEmpty && initial.savedID.isEmpty && initial.body.isEmpty && !draft.unconfirmed {
                AutomaticAssistance(messageID: initial.replyToID, account: initial.accountID, trigger: "onReply") { text in
                    if draft.body.isEmpty || model.confirm("Replace this draft’s text?", detail: "Your current text will be replaced with the suggestion. Recipients and footer stay the same.") { draft.body = text }
                }
            }
            if draft.unconfirmed {
                Label("Delivery was not confirmed. Check your provider’s Sent folder before retrying. Retrying may send a duplicate.", systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
                Toggle("I checked Sent and want to retry this delivery", isOn: $reviewed).toggleStyle(.checkbox)
            }
            VStack(spacing: 12) {
                recipientField("To", text: $draft.to, placeholder: "Email addresses, separated by commas")
                recipientField("Cc", text: $draft.cc, placeholder: "Copy recipients")
                recipientField("Bcc", text: $draft.bcc, placeholder: "Hidden recipients")
                Text("Use plain email addresses separated by commas or semicolons (100 recipients total). Bcc recipients are hidden from other recipients.").font(.caption).foregroundStyle(.secondary)
                TextField("Subject", text: $draft.subject)
                TextArea(title: "Message", text: $draft.body, height: 210)
            }.textFieldStyle(.roundedBorder).disabled(model.busy || draft.unconfirmed)
            if draft.footer["text"].nonempty || draft.footer["html"].nonempty {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Label("Email footer", systemImage: "signature").font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Button("Remove") { draft.footer = .object(["text": .string(""), "html": .string("")]) }.buttonStyle(.borderless).disabled(model.busy || draft.unconfirmed)
                    }
                    FooterPreview(footer: draft.footer)
                }.padding(12).background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 10))
            }
            if !draft.unconfirmed {
                DisclosureGroup("Writing assistance") {
                    VStack(alignment: .leading, spacing: 12) {
                        TextField("Instructions for your assistant", text: $aiPrompt).textFieldStyle(.roundedBorder)
                        HStack {
                            ForEach(["write", "rewrite", "translate"], id: \.self) { action in
                                Button(action.capitalized) { assist(action) }.disabled(model.busy || !model.allowed(action) || (action == "write" ? aiPrompt.isEmpty : draft.body.isEmpty))
                            }
                        }
                        if !aiResult.isEmpty {
                            Text(aiSource == "demo" ? "Illustrative demo result" : "AI suggestion — review before using").font(.caption).foregroundStyle(.secondary)
                            ScrollView { Text(aiResult).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }.frame(maxHeight: 100)
                            Button("Use in Draft") { draft.body = aiResult; aiResult = "" }.disabled(model.busy)
                        }
                    }.padding(.top, 8)
                }
            }
            if !localError.isEmpty { Text(localError).foregroundStyle(.red).font(.callout).textSelection(.enabled) }
           }.padding(24)
          }
          Divider()
            HStack {
                Button(draft.unconfirmed ? "Close" : "Cancel") { close() }.keyboardShortcut(.cancelAction).disabled(model.busy)
                Spacer()
                if model.busy { ProgressView().controlSize(.small) }
                Button("Save Draft") { save() }.keyboardShortcut("s").disabled(model.busy || draft.unconfirmed)
                Button(draft.unconfirmed ? "Review Retry" : "Review & Send") { confirmSend = true }
                    .keyboardShortcut("d", modifiers: [.command, .shift]).buttonStyle(.borderedProminent).disabled(model.busy || [draft.to, draft.cc, draft.bcc].allSatisfy { $0.trimmingCharacters(in: .whitespaces).isEmpty } || draft.body.isEmpty || (draft.unconfirmed && !reviewed))
            }.padding(20)
        }.frame(width: 690, height: min(780, (NSScreen.main?.visibleFrame.height ?? 900) - 100))
        .interactiveDismissDisabled(dirty || model.busy)
        .onAppear { model.dirty("compose", dirty) }
        .onChange(of: draft) { _ in model.dirty("compose", dirty) }
        .onDisappear { model.dirty("compose", false) }
        .confirmationDialog(draft.accountID == "demo" ? "Simulate sending this message?" : "Send this message to the listed recipients?", isPresented: $confirmSend, titleVisibility: .visible) {
            Button(draft.accountID == "demo" ? "Simulate Send" : "Send Message") { send() }
            Button("Cancel", role: .cancel) {}
        } message: { Text("From: \(draft.accountID)\nTo: \(draft.to)\nCc: \(draft.cc)\nBcc: \(draft.bcc)\nSubject: \(draft.subject.isEmpty ? "(No subject)" : draft.subject)\n\(draft.unconfirmed ? "This retry may create a duplicate." : "The message and displayed footer will be sent together.")") }
    }
    func recipientField(_ label: String, text: Binding<String>, placeholder: String) -> some View {
        HStack {
            Text(label).frame(width: 36, alignment: .leading).foregroundStyle(.secondary)
            TextField(placeholder, text: text).accessibilityLabel(label)
        }
    }
    func close() { if !dirty || draft.unconfirmed || model.confirmDiscard("Discard this draft’s unsaved changes?") { dismiss() } }
    func save() {
        let payload = draft.payload, account = draft.accountID
        model.perform {
            do {
                let result = try await model.request("/drafts", method: "POST", body: payload, mailbox: account)
                draft.savedID = result["message"].id; saved = draft.payload
                try await model.reload(); model.notice = "Draft saved."; dismiss()
            } catch { localError = error.localizedDescription }
        }
    }
    func send() {
        let account = draft.accountID
        model.perform {
            var submitted = false
            do {
                if !draft.unconfirmed {
                    let savedDraft = try await model.request("/drafts", method: "POST", body: draft.payload, mailbox: account)
                    draft.savedID = savedDraft["message"].id; saved = draft.payload
                }
                var payload = draft.payload
                payload["draftId"] = draft.savedID.isEmpty ? .null : .string(draft.savedID)
                payload["requestId"] = .string(draft.requestID)
                payload["retryUnconfirmed"] = .bool(draft.unconfirmed && reviewed)
                submitted = true
                let result = try await model.request("/send", method: "POST", body: payload, mailbox: account)
                model.notice = result["simulated"].bool ? "Demo message sent locally." : "Message sent."
                try? await model.reload(); dismiss()
            } catch let error as APIError {
                if error.payload["requiresSendReview"].bool {
                    draft = Draft(message: error.payload["message"]); saved = draft.payload; reviewed = false
                    try? await model.reload()
                }
                localError = error.localizedDescription
            } catch {
                // A lost HTTP response can hide a completed send. Freeze the text,
                // keep this request ID, and require review before retrying.
                if submitted {
                    draft.unconfirmed = true; reviewed = false
                    localError = "Delivery could not be confirmed. Check Sent before retrying this same message. " + error.localizedDescription
                    try? await model.reload()
                    if model.messages.contains(where: { $0.id == "sent:" + draft.requestID && $0["accountId"].string == account }) { model.notice = "Message sent."; dismiss() }
                } else { localError = "The draft could not be saved, so sending was not attempted. " + error.localizedDescription }
            }
        }
    }
    func assist(_ action: String) {
        let payload = JSON.object(["action": .string(action), "prompt": .string(aiPrompt), "draftText": .string(draft.body)])
        model.perform {
            do { let result = try await model.request("/ai", method: "POST", body: payload, mailbox: draft.accountID); aiResult = result["text"].string; aiSource = result["source"].string }
            catch { localError = error.localizedDescription }
        }
    }
}
