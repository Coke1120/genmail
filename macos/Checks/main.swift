import Foundation

struct WorkspaceTests {
    func testSchemaRoundTripAndUnconfirmedDraft() throws {
        let value = try JSONDecoder().decode(JSON.self, from: Data(#"{"id":"outbox:request","accountId":"owner@example.com","viewId":"unique-owned-message","to":"someone@example.com","subject":"Hello","body":"Text","deliveryStatus":"unconfirmed","deliveryRequestId":"original-request","policy":{"enabled":false},"count":8}"#.utf8))
        expectEqual(try JSONDecoder().decode(JSON.self, from: JSONEncoder().encode(value)), value)
        assert(!value["policy"]["enabled"].bool)
        expectEqual(value["count"].number, 8)
        let draft = Draft(message: value)
        expectEqual(draft.accountID, "owner@example.com")
        expectEqual(Draft(message: value, reply: true).accountID, "owner@example.com")
        expectEqual(value.viewID, "unique-owned-message")
        assert(draft.unconfirmed)
        expectEqual(draft.requestID, "original-request")
        expectEqual(draft.savedID, "outbox:request")
        expectEqual(draft.payload["body"].string, "Text")
        expectNil(draft.payload.object["deliveryStatus"])
    }
    func testCalendarRetrySurvivesRestartWithSamePayload() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        var draft = CalendarDraft(provider: "google", calendarID: "primary", calendarName: "Personal", email: "me@example.com")
        draft.title = "A real event"; draft.attempted = true
        draft.start = Date(timeIntervalSince1970: 1_900_000_000); draft.end = draft.start.addingTimeInterval(3600)
        try draft.savePending(in: directory)
        let restored = try unwrap(CalendarDraft.pending(in: directory))
        expectEqual(restored.id, draft.id)
        expectEqual(restored.payload, draft.payload)
        assert(restored.attempted)
        let permissions = try FileManager.default.attributesOfItem(atPath: directory.appendingPathComponent("pending-calendar.json").path)[.posixPermissions] as? NSNumber
        expectEqual(permissions?.intValue, 0o600)
        try CalendarDraft.clearPending(in: directory)
        expectNil(try CalendarDraft.pending(in: directory))
    }
    func testPathAndTimezoneHandling() throws {
        expectEqual(encodedPath("a/b?c#d+e"), "a%2Fb%3Fc%23d%2Be")
        let date = try unwrap(parsedDate("2026-09-23T12:30:00.123Z"))
        expectEqual(utcDate(date), "2026-09-23T12:30:00Z")
        expectNotNil(parsedDate("2026-09-23T12:30:00Z"))
        expectNil(parsedDate("invalid"))
    }
}

func expectEqual<T: Equatable>(_ a: T, _ b: T) { assert(a == b, "Expected \(a) to equal \(b)") }
func expectNil<T>(_ a: T?) { assert(a == nil) }
func expectNotNil<T>(_ a: T?) { assert(a != nil) }
func unwrap<T>(_ a: T?) throws -> T { guard let a else { throw APIError("Expected a value") }; return a }
let checks = WorkspaceTests()
try checks.testSchemaRoundTripAndUnconfirmedDraft()
try checks.testCalendarRetrySurvivesRestartWithSamePayload()
try checks.testPathAndTimezoneHandling()
print("3 native model and recovery checks passed.")

let copied = Draft(message: .object(["id": .string("draft"), "accountId": .string("first@example.com"), "to": .string("one@example.com, two@example.com"), "cc": .string("copy@example.com"), "bcc": .string("hidden@example.com")]))
expectEqual(copied.payload["cc"].string, "copy@example.com")
expectEqual(copied.payload["bcc"].string, "hidden@example.com")
let sortFixture: [JSON] = [
    .object(["id": .string("new"), "date": .string("2026-09-23"), "subject": .string("Zebra"), "fromName": .string("Alice"), "read": .bool(true), "starred": .bool(false)]),
    .object(["id": .string("old"), "date": .string("2026-09-22"), "subject": .string("Apple"), "fromName": .string("Bob"), "read": .bool(false), "starred": .bool(true)]),
]
for order in ["oldest", "subject", "unread", "starred"] { expectEqual(sortedMail(sortFixture, by: order).first?.id, "old") }
for order in ["newest", "sender"] { expectEqual(sortedMail(sortFixture, by: order).first?.id, "new") }
print("Native multi-recipient and six sorting checks passed.")
