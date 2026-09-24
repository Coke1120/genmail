import Foundation

// Runs the actual native API client against a private bundled-service fixture.
// No UI automation and no real provider requests are used by these checks.
@main
struct NativeClientChecks {
    @MainActor static func main() async throws {
        let model = AppModel()
        await model.start()
        defer { model.stop() }
        guard !model.state.isNull else { throw APIError(model.error) }
        assert(model.features.count == 19)
        let update = try await model.request("/updates?includePrereleases=true")
        assert(update["updateAvailable"].bool && update["latestVersion"].string == "0.5.0-alpha.2")
        let trigger: JSON = .object(["action": .string("summary"), "trigger": .string("onOpen"), "messageId": .string("demo-1")])
        let disabledTrigger = try await model.request("/ai", method: "POST", body: trigger, mailbox: "demo")
        assert(disabledTrigger["skipped"].bool)
        model.state = try await model.request("/settings/policy", method: "POST", body: .object(["triggers": .object(["onOpen": .bool(true), "onReply": .bool(true)])]))
        let automatic = try await model.request("/ai", method: "POST", body: trigger, mailbox: "demo")
        assert(automatic["text"].nonempty && automatic["source"].string == "demo")
        let replyTrigger = try await model.request("/ai", method: "POST", body: .object(["action": .string("reply"), "trigger": .string("onReply"), "messageId": .string("demo-1")]), mailbox: "demo")
        assert(replyTrigger["text"].nonempty)
        model.state = try await model.request("/settings/policy", method: "POST", body: .object(["triggers": .object(["onOpen": .bool(false), "onReply": .bool(false)])]))
        print("Native update response and opt-in AI trigger checks passed.")
        model.state = try await model.request("/settings/preferences", method: "POST", body: .object(["language": .string("繁體中文"), "translationLanguage": .string("日本語"), "syncInterval": .number(1)]))
        assert(model.preferences["language"].string == "繁體中文" && model.preferences["translationLanguage"].string == "日本語")
        model.state = try await model.request("/settings/policy", method: "POST", body: .object(["triggers": .object(["onArrival": .bool(true), "scheduledSummary": .bool(true)]), "summarySchedule": .object(["cadence": .string("interval"), "everyHours": .number(4), "time": .string("09:15"), "timeZone": .string("Asia/Hong_Kong")])]))
        try await model.reload()
        assert(model.policy["triggers"]["onArrival"].bool && model.policy["triggers"]["scheduledSummary"].bool)
        assert(model.policy["summarySchedule"]["everyHours"].number == 4 && model.policy["summarySchedule"]["timeZone"].string == "Asia/Hong_Kong")
        model.state = try await model.request("/settings/policy", method: "POST", body: .object(["triggers": .object(["onArrival": .bool(false), "scheduledSummary": .bool(false)])]))
        model.state = try await model.request("/settings/preferences", method: "POST", body: .object(["syncInterval": .number(0)]))
        print("Native summary schedule and separate language settings round-trip passed.")
        let selectedID = model.messages[0].id
        let calendars = try await model.request("/calendars")
        assert(calendars["connections"].array.filter { $0["connected"].bool }.count == 2)
        assert(calendars["calendars"].array.count == 4)
        for provider in ["google", "microsoft"] {
            let id = UUID().uuidString.lowercased()
            let payload: JSON = .object(["calendarId": .string("primary"), "connectionEmail": .string(provider + "@example.com"), "title": .string("Native calendar check"), "start": .string("2026-10-01T09:00:00Z"), "end": .string("2026-10-01T10:00:00Z"), "requestId": .string(id)])
            let created = try await model.request("/calendars/\(provider)/events", method: "POST", body: payload)
            let replay = try await model.request("/calendars/\(provider)/events", method: "POST", body: payload)
            assert(created["event"].id == id && replay["event"].id == id)
            let events = try await model.request("/calendars/\(provider)/events?calendarId=primary&start=2026-10-01T00%3A00%3A00Z&end=2026-10-02T00%3A00%3A00Z")
            assert(events["events"].array.contains { $0.id == id })
        }
        model.state = try await model.request("/settings/policy", method: "POST", body: .object(["content": .object(["attachments": .bool(true)])]))
        for feature in model.features {
            var input: JSON = .object(["action": .string(feature.id), "messageId": .string(selectedID), "prompt": .string("Summarize or draft a short response."), "draftText": .string("Hello, thank you for your message."), "skillId": model.state["workspace"]["skills"].array.first?["id"] ?? .null])
            if ["followup", "schedule"].contains(feature.id) { input["when"] = .string(utcDate(Date().addingTimeInterval(86400))) }
            if feature["mock"].bool {
                let result = try await model.request("/workflows/preview", method: "POST", body: input)
                assert(!result["preview"].id.isEmpty)
                _ = try await model.request("/workflows/apply", method: "POST", body: .object(["previewId": result["preview"]["id"]]))
            } else {
                let result = try await model.request("/ai", method: "POST", body: input)
                assert(result["text"].nonempty)
            }
        }
        _ = try await model.request("/settings/policy", method: "POST", body: .object(["behaviors": .object(["summary": .bool(false)])]))
        do {
            _ = try await model.request("/ai", method: "POST", body: .object(["action": .string("summary"), "messageId": .string(selectedID)]))
            assertionFailure("Disabled behavior was allowed")
        } catch let error as APIError { assert(error.localizedDescription.contains("disabled")) }
        model.state = try await model.request("/account/live", method: "POST", body: .object([:]))
        var draft = Draft(); draft.to = "recipient@example.com"; draft.subject = "Native recovery check"; draft.body = "Fixture delivery only. Please review the suggested timetable and share your feedback when you have a moment."
        let saved = try await model.request("/drafts", method: "POST", body: draft.payload)
        draft.savedID = saved["message"].id
        var payload = draft.payload
        payload["draftId"] = .string(draft.savedID); payload["requestId"] = .string(draft.requestID)
        do {
            _ = try await model.request("/send", method: "POST", body: payload)
            assertionFailure("Expected an uncertain delivery")
        } catch let error as APIError {
            assert(error.payload["requiresSendReview"].bool)
            let recovered = Draft(message: error.payload["message"])
            assert(recovered.unconfirmed && recovered.requestID == draft.requestID && recovered.savedID == draft.savedID)
        }
        do {
            _ = try await model.request("/send", method: "POST", body: payload)
            assertionFailure("Unreviewed retry was allowed")
        } catch let error as APIError { assert(error.payload["requiresSendReview"].bool) }
        payload["retryUnconfirmed"] = .bool(true)
        let sent = try await model.request("/send", method: "POST", body: payload)
        let replay = try await model.request("/send", method: "POST", body: payload)
        assert(sent["message"].id == replay["message"].id && sent["message"].id == "sent:" + draft.requestID)
        for address in ["first@example.com", "second@example.com"] {
            let mail: JSON = .object(["email": .string(address), "password": .string("fixture"), "imapHost": .string("fixture.invalid"), "smtpHost": .string("fixture.invalid")])
            model.state = try await model.request("/settings/mail", method: "POST", body: mail)
        }
        assert(model.accounts.count == 3) // Includes the migrated legacy connection.
        try await model.selectAccount("all", folder: "inbox")
        let duplicates = model.messages.filter { $0.id == "shared-inbox-id" }
        assert(duplicates.count == 2 && Set(duplicates.map(\.viewID)).count == 2)
        model.selectedMessage = duplicates[1].viewID
        assert(model.current?["accountId"] == duplicates[1]["accountId"])
        model.state = try await model.request("/settings/preferences", method: "POST", body: .object(["signatureFormat": .string("html"), "signature": .string("<b>Native signature</b>")]))
        model.newDraft(Draft(message: duplicates[1], reply: true))
        assert(model.compose?.accountID == duplicates[1]["accountId"].string)
        assert(model.compose?.footer["html"].string == "<b>Native signature</b>")
        let reply = model.compose!
        let savedReply = try await model.request("/drafts", method: "POST", body: reply.payload, mailbox: reply.accountID)
        assert(Draft(message: savedReply["message"]).footer == reply.footer)
        model.compose = nil
        model.newDraft()
        assert(model.compose?.accountID == model.accounts.first?.id)
        model.compose = nil
        let owner = duplicates[1]["accountId"].string
        _ = try await model.request("/messages/shared-inbox-id", method: "PATCH", body: .object(["starred": .bool(true)]), mailbox: owner)
        try await model.reload()
        assert(model.messages.filter { $0.id == "shared-inbox-id" && $0["starred"].bool }.count == 1)
        let ownedDraft = try await model.request("/drafts", method: "POST", body: .object(["to": .string("recipient@example.com"), "subject": .string("Combined view"), "body": .string("Account owned draft")]), mailbox: owner)
        assert(Draft(message: ownedDraft["message"]).accountID == owner)
        try await model.sync()
        assert(model.combined)
        model.state = try await model.request("/account/disconnect", method: "POST", body: .object([:]), mailbox: owner)
        assert(model.accounts.count == 2 && model.combined && !model.messages.contains { $0["accountId"].string == owner })
        try await model.selectAccount("native@example.com", folder: "sent")
        assert(model.messages.contains { $0.id == "sent:" + draft.requestID })
        model.state = try await model.request("/imports/start", method: "POST", body: .object(["months": .number(3), "inbox": .bool(true), "sent": .bool(true)]))
        assert(model.accounts.first(where: { $0.id == "native@example.com" })?["import"]["status"].string == "running")
        model.state = try await model.request("/imports/pause", method: "POST", body: .object([:]))
        assert(model.accounts.first(where: { $0.id == "native@example.com" })?["import"]["status"].string == "paused")
        model.state = try await model.request("/settings/ai", method: "POST", body: .object(["baseUrl": .string("http://127.0.0.1:11434/v1"), "model": .string("native-fixture")]))
        model.state = try await model.request("/settings/policy", method: "POST", body: .object(["folders": .object(["sent": .bool(true)]), "content": .object(["body": .bool(true), "contacts": .bool(false)])]))
        model.state = try await model.request("/style/settings", method: "POST", body: .object(["enabled": .bool(true), "maxSamples": .number(50), "tokenBudget": .number(16000)]))
        model.state = try await model.request("/style/preview", method: "POST", body: .object([:]))
        let stylePreview = model.state["workspace"]["styleLearning"]["preview"]
        assert(stylePreview["sampleCount"].number > 0 && stylePreview["estimatedTokens"].number <= 16000)
        model.state = try await model.request("/style/generate", method: "POST", body: .object(["previewId": .string(stylePreview.id)]))
        assert(model.state["workspace"]["styleLearning"]["preview"]["status"].string == "ready")
        model.state = try await model.request("/style/apply", method: "POST", body: .object(["previewId": .string(stylePreview.id), "voice": .string("Reviewed native style.")]))
        assert(model.state["workspace"]["styleLearning"]["profile"]["active"].bool)
        model.state = try await model.request("/style/profile", method: "DELETE", body: .object([:]))
        assert(model.state["workspace"]["styleLearning"]["profile"].isNull)
        print("Native import controls and writing-style preview, review, save and delete checks passed.")
        print("Native client integration passed: 19 behaviors, permissions, both calendars, send recovery, multi-account routing, combined IDs, and disconnect isolation.")
    }
}
