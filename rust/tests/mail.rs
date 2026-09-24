use morrow_search::{mail, providers, store::Store};
use serde_json::json;

#[test]
fn imports_keep_owner_local_identity_and_delivery_fingerprint() {
    let directory =
        std::env::temp_dir().join(format!("morrow-import-test-{}", uuid::Uuid::new_v4()));
    let db = Store::open(&directory).unwrap();
    let mail = json!({"email":"a@example.test","provider":"microsoft"});
    let other = json!({"email":"b@example.test","provider":"microsoft"});
    let message = json!({"id":"microsoft:same","folder":"inbox","body":"original","read":false,"starred":false,"labels":[]});
    assert_eq!(
        mail::import_messages(&db, &mail, std::slice::from_ref(&message)).unwrap(),
        vec!["microsoft:same"]
    );
    mail::import_messages(&db, &other, std::slice::from_ref(&message)).unwrap();
    db.update("a@example.test","microsoft:same",&json!({"folder":"archive","read":true,"starred":true,"remoteId":"microsoft:moved","providerFolderId":"destination"})).unwrap();
    let moved = json!({"id":"microsoft:moved","folder":"inbox","read":false,"starred":false,"labels":[],"body":"refreshed"});
    assert!(
        mail::import_messages(&db, &mail, &[moved])
            .unwrap()
            .is_empty()
    );
    let saved = db.get("a@example.test", "microsoft:same").unwrap().unwrap();
    assert_eq!(saved["body"], "refreshed");
    assert_eq!(saved["folder"], "archive");
    assert_eq!(saved["read"], true);
    assert!(
        db.get("a@example.test", "microsoft:moved")
            .unwrap()
            .is_none()
    );
    assert_eq!(
        db.get("b@example.test", "microsoft:same").unwrap().unwrap()["read"],
        false
    );
    let sent = json!({"id":"sent:request-123","folder":"sent","to":"to@example.test","cc":"","bcc":"hidden@example.test","subject":"Saved","body":"Reviewed text","messageId":"<same@example.test>","read":true});
    let fingerprint = mail::fingerprint(&sent).unwrap();
    db.upsert("a@example.test", &sent).unwrap();
    let remote = json!({"id":"microsoft:provider-sent","folder":"sent","fromEmail":"a@example.test","messageId":"<same@example.test>","to":"provider text","body":"provider transform"});
    assert!(
        mail::import_messages(&db, &mail, &[remote])
            .unwrap()
            .is_empty()
    );
    let saved = db
        .get("a@example.test", "sent:request-123")
        .unwrap()
        .unwrap();
    assert_eq!(mail::fingerprint(&saved).unwrap(), fingerprint);
    assert_eq!(saved["remoteId"], "microsoft:provider-sent");
    drop(db);
    std::fs::remove_dir_all(directory).unwrap();
}
#[test]
fn mime_delivery_preserves_bcc_in_provider_api_and_hides_it_from_smtp_headers() {
    let mail = json!({"email":"sender@example.test"});
    let value = json!({"to":"visible@example.test","cc":"copy@example.test","bcc":"hidden@example.test","subject":"中文 subject","body":"正文","fromName":"寄件人","replyMessageId":"<original@example.test>","footer":{"text":"Signature","html":""}});
    let (smtp, _) = providers::compose(&mail, &value, false).unwrap();
    let smtp_raw = smtp.formatted();
    let smtp_text = String::from_utf8_lossy(&smtp_raw);
    assert!(!smtp_text.to_ascii_lowercase().contains("bcc:"));
    assert!(!smtp_text.contains("hidden@example.test"));
    assert_eq!(smtp.envelope().to().len(), 3);
    let (api, id) = providers::compose(&mail, &value, true).unwrap();
    let bytes = api.formatted();
    let raw = String::from_utf8_lossy(&bytes);
    assert!(raw.contains("Bcc: hidden@example.test"));
    assert!(raw.contains("In-Reply-To: <original@example.test>"));
    let parsed = providers::mime(&bytes).unwrap();
    assert_eq!(parsed["subject"], "中文 subject");
    assert_eq!(parsed["bcc"], "hidden@example.test");
    assert_eq!(parsed["messageId"], id);
    assert!(
        parsed["body"]
            .as_str()
            .unwrap()
            .contains("正文\n\nSignature")
    );
}
#[test]
fn oauth_pkce_and_cursor_boundaries() {
    let google = providers::oauth_start(
        "google",
        &json!({"clientId":"fixture","clientSecret":"public-installed-secret","organize":true}),
        "http://localhost:12345/api/oauth/google/callback",
        "mail",
    )
    .unwrap();
    let url = url::Url::parse(google["url"].as_str().unwrap()).unwrap();
    let query = url
        .query_pairs()
        .collect::<std::collections::HashMap<_, _>>();
    assert_eq!(query["code_challenge_method"], "S256");
    assert!(query["scope"].contains("gmail.modify"));
    assert!(!query["scope"].contains("calendar"));
    assert!(!query.values().any(|v| v == "public-installed-secret"));
    let calendar = providers::oauth_start(
        "google",
        &json!({"clientId":"fixture"}),
        "http://localhost:12345/api/calendar-oauth/google/callback",
        "calendar",
    )
    .unwrap();
    assert!(!calendar["url"].as_str().unwrap().contains("gmail"));
    assert_ne!(calendar["state"], google["state"]);
    let original =
        url::Url::parse("https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages").unwrap();
    assert!(
        providers::validated_next(
            "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$skip=50",
            &original
        )
        .is_ok()
    );
    for path in [
        "http://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages",
        "https://evil.example/v1.0/me/mailFolders/inbox/messages",
        "https://user@graph.microsoft.com/v1.0/me/mailFolders/inbox/messages",
        "https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages",
    ] {
        assert!(providers::validated_next(path, &original).is_err());
    }
}
