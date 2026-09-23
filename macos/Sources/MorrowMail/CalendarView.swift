import SwiftUI
import AppKit

struct NativeCalendarView: View {
    @EnvironmentObject var model: AppModel
    @State private var calendars: [JSON] = []
    @State private var connections: [JSON] = []
    @State private var events: [JSON] = []
    @State private var selection = ""
    @State private var from = Calendar.current.startOfDay(for: Date())
    @State private var through = Date().addingTimeInterval(6 * 86400)
    @State private var connectionErrors = ""
    @State private var draft: CalendarDraft?
    @State private var pending: CalendarDraft?
    @State private var loaded = false
    var selected: JSON { calendars.first { key($0) == selection } ?? .null }
    var selectedEmail: String { connections.first { $0["provider"] == selected["provider"] }?["email"].string ?? "" }
    func key(_ calendar: JSON) -> String { calendar["provider"].string + ":" + calendar.id }
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                SectionHeading(title: "Calendar", detail: "A clear view of what’s ahead. All times use \(TimeZone.current.identifier).")
                Button("Connections") { model.settings("calendar") }.disabled(model.busy)
            }
            if let pending {
                GroupBox {
                    HStack {
                        Label("Check creation of “\(pending.title)”", systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
                        Spacer()
                        Button("Review Pending Request") { draft = pending }.disabled(model.busy)
                    }.padding(8)
                }
            }
            if !connectionErrors.isEmpty { Text(connectionErrors).foregroundStyle(.orange).textSelection(.enabled) }
            if calendars.isEmpty {
                EmptyPane(title: loaded ? "Connect your calendar" : "Loading calendars…", detail: "Google and Outlook calendars connect separately from mail. Both can stay connected together.", symbol: "calendar")
                HStack { Button("Open Calendar Settings") { model.settings("calendar") }; Button("Refresh Connections") { load() } }.disabled(model.busy)
            } else {
                HStack {
                    Picker("Calendar", selection: $selection) {
                        ForEach(calendars, id: \.self) { item in Text("\(providerLabel(item["provider"].string)) · \(item["name"].string)\(item["canWrite"].bool ? "" : " (read only)")").tag(key(item)) }
                    }.frame(maxWidth: 460)
                    Spacer()
                    Button { load() } label: { Label("Refresh", systemImage: "arrow.clockwise") }
                    Button("New Event") {
                        draft = CalendarDraft(provider: selected["provider"].string, calendarID: selected.id, calendarName: selected["name"].string, email: selectedEmail)
                    }.buttonStyle(.borderedProminent).disabled(!selected["canWrite"].bool || pending != nil)
                }.disabled(model.busy)
                HStack {
                    DatePicker("From", selection: $from, displayedComponents: .date)
                    DatePicker("Through", selection: $through, displayedComponents: .date)
                    Button("Load Events") { refreshEvents() }
                }.disabled(model.busy)
                Text("Up to 90 days · \(selectedEmail)\(selected["canWrite"].bool ? "" : " · Read-only calendar")").font(.caption).foregroundStyle(.secondary)
                Divider()
                if events.isEmpty { EmptyPane(title: "A little breathing room", detail: "No events in the loaded range. Change the dates and choose Load Events.", symbol: "sun.max") }
                else {
                    List(events) { event in
                        HStack(alignment: .top, spacing: 20) {
                            RoundedRectangle(cornerRadius: 2).fill(morrowGreen).frame(width: 4)
                            VStack(alignment: .leading, spacing: 8) {
                                Text(event["title"].nonempty ? event["title"].string : "Untitled event").font(.headline)
                                Text(event["allDay"].bool ? "All day · \(event["start"].string.prefix(10))" : "\(dateLabel(event["start"].string)) – \(dateLabel(event["end"].string))").foregroundStyle(.secondary)
                                if event["location"].nonempty { Label(event["location"].string, systemImage: "mappin.and.ellipse").font(.callout) }
                                if event["description"].nonempty { Text(event["description"].string).font(.callout).foregroundStyle(.secondary).lineLimit(5) }
                            }.textSelection(.enabled)
                            Spacer()
                            if let url = URL(string: event["webUrl"].string), url.scheme == "https", url.user == nil, url.password == nil { Link(destination: url) { Image(systemName: "arrow.up.right.square") }.help("Open event at provider").accessibilityLabel("Open event at provider") }
                        }.padding(.vertical, 13)
                    }.listStyle(.inset)
                }
                Text("Live events are separate from AI Studio’s simulated scheduling. No calendar data is sent to AI.").font(.caption).foregroundStyle(.secondary)
            }
        }.padding(28)
        .task { load() }
        .onChange(of: selection) { _ in if !model.busy { refreshEvents() } }
        .sheet(item: $draft, onDismiss: { Task { await Task.yield(); load() } }) { value in CalendarEditor(initial: value).environmentObject(model) }
    }
    func load() {
        model.perform {
            pending = try CalendarDraft.pending(in: model.dataDirectory)
            let result = try await model.request("/calendars")
            calendars = result["calendars"].array; connections = result["connections"].array
            connectionErrors = result["errors"].array.map { providerLabel($0["provider"].string) + ": " + $0["message"].string }.joined(separator: "\n")
            if !calendars.contains(where: { key($0) == selection }) { selection = calendars.first.map(key) ?? "" }
            loaded = true
            if !selected.isNull { try await fetchEvents() } else { events = [] }
        }
    }
    func refreshEvents() { model.perform { try await fetchEvents() } }
    func fetchEvents() async throws {
        guard !selected.isNull else { return }
        let beginning = Calendar.current.startOfDay(for: from)
        let ending = Calendar.current.date(byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: through))!
        guard ending > beginning, ending.timeIntervalSince(beginning) <= 90 * 86400 + 7200 else { throw APIError("Choose an ordered date range of at most 90 days.") }
        var components = URLComponents()
        components.queryItems = [URLQueryItem(name: "calendarId", value: selected.id), URLQueryItem(name: "start", value: utcDate(beginning)), URLQueryItem(name: "end", value: utcDate(ending))]
        events = []
        let result = try await model.request("/calendars/\(selected["provider"].string)/events?" + (components.percentEncodedQuery ?? ""))
        events = result["events"].array
    }
}

struct CalendarEditor: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) var dismiss
    let initial: CalendarDraft
    @State private var draft: CalendarDraft
    @State private var reviewing: Bool
    @State private var error = ""
    init(initial: CalendarDraft) { self.initial = initial; _draft = State(initialValue: initial); _reviewing = State(initialValue: initial.attempted) }
    var dirty: Bool { draft != initial && !draft.attempted }
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            SectionHeading(title: reviewing ? "Review your event" : "Make time for it", detail: "\(providerLabel(draft.provider)) · \(draft.calendarName)\n\(draft.email)")
            if reviewing {
                Text(draft.title).font(.title2.bold()).textSelection(.enabled)
                Text("\(draft.start.formatted(date: .complete, time: .shortened))\nUntil \(draft.end.formatted(date: .complete, time: .shortened))\n\(TimeZone.current.identifier)").foregroundStyle(.secondary)
                if !draft.location.isEmpty { Label(draft.location, systemImage: "mappin.and.ellipse") }
                if !draft.description.isEmpty { ScrollView { Text(draft.description).frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled) }.frame(maxHeight: 130) }
                Text(draft.attempted ? "The previous result was not confirmed. This retry uses the same request ID and original details. Check your calendar before continuing." : "This creates a real event in the calendar above. No attendees or invitations will be added.").font(.callout).foregroundStyle(draft.attempted ? Color.orange : Color.secondary)
            } else {
                TextField("Event title", text: $draft.title).textFieldStyle(.roundedBorder)
                DatePicker("Starts", selection: $draft.start)
                DatePicker("Ends", selection: $draft.end)
                Text(TimeZone.current.identifier).font(.caption).foregroundStyle(.secondary)
                TextField("Location (optional)", text: $draft.location).textFieldStyle(.roundedBorder)
                TextArea(title: "Description (optional)", text: $draft.description)
            }
            if !error.isEmpty { Text(error).foregroundStyle(.red).textSelection(.enabled) }
            HStack {
                Button(draft.attempted ? "Keep for Later" : "Cancel") { if !dirty || model.confirmDiscard() { dismiss() } }.keyboardShortcut(.cancelAction)
                if reviewing && !draft.attempted { Button("Edit") { reviewing = false } }
                if draft.attempted {
                    Button("Resolve…") {
                        if model.confirm("Resolve this pending request?", detail: "Confirm you checked the provider’s calendar. This forgets the pending request; it does not delete any event.") {
                            do { try CalendarDraft.clearPending(in: model.dataDirectory); dismiss() } catch { self.error = error.localizedDescription }
                        }
                    }
                }
                Spacer()
                if model.busy { ProgressView().controlSize(.small) }
                Button(reviewing ? (draft.attempted ? "Retry Same Request" : "Create Event") : "Review Event") {
                    if reviewing { create() } else { reviewing = true }
                }.buttonStyle(.borderedProminent).disabled(draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || draft.end <= draft.start || draft.end.timeIntervalSince(draft.start) > 90 * 86400)
            }
        }.padding(28).frame(width: 640).disabled(model.busy)
        .interactiveDismissDisabled(dirty || model.busy)
        .onChange(of: draft) { _ in model.dirty("calendar", dirty) }
        .onDisappear { model.dirty("calendar", false) }
    }
    func create() {
        model.perform {
            do {
                draft.attempted = true
                try draft.savePending(in: model.dataDirectory)
                _ = try await model.request("/calendars/\(draft.provider)/events", method: "POST", body: draft.payload)
                try CalendarDraft.clearPending(in: model.dataDirectory)
                model.notice = "Event created in \(draft.calendarName)."; dismiss()
            } catch { self.error = error.localizedDescription }
        }
    }
}
