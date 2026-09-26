use morrow_search::{activity::Runtime, background, store::Store};
use serde_json::{Value, json};

const A: &str = "one@example.invalid";
const B: &str = "two@example.invalid";
const OFF: &str = "disconnected@example.invalid";
const AT: &str = "2026-09-27T09:00:00.000Z";
fn config() -> Value {
    json!({"mailAccounts":{A:{"email":A,"provider":"google","connectionId":"PRIVATE-CONNECTION"},B:{"email":B}}})
}
fn task(runtime: &Runtime, config: &Value, id: &str) -> Value {
    runtime.snapshot(config)["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|task| task["id"] == id)
        .unwrap()
        .clone()
}

#[test]
fn in_flight_finish_drop_retention_and_connected_owner_filtering() {
    let runtime = Runtime::default();
    let mut config = config();
    let mut work = runtime.start(A, "sync", "Fetching mail", "Checking Inbox");
    assert_eq!(runtime.snapshot(&config)["tasks"][0]["status"], "running");
    assert!(runtime.snapshot(&config)["tasks"][0]["completed"].is_null());
    work.finish(true, Some(12));
    work.finish(false, Some(99));
    drop(work);
    assert_eq!(runtime.snapshot(&config)["tasks"][0]["status"], "complete");
    assert_eq!(runtime.snapshot(&config)["tasks"][0]["completed"], 12);
    drop(runtime.start(B, "ai", "AI assistance", "Waiting for the configured model"));
    assert_eq!(
        runtime.snapshot(&config)["tasks"][0]["status"],
        "interrupted"
    );
    let mut works: Vec<_> = (0..45)
        .map(|_| runtime.start(A, "sync", "Fetching mail", "Checking Sent"))
        .collect();
    let mut keep = runtime.start(B, "sync", "Fetching mail", "Checking Inbox");
    for work in &mut works {
        work.finish(true, Some(1));
    }
    let snapshot = runtime.snapshot(&config);
    assert_eq!(snapshot["tasks"].as_array().unwrap().len(), 21);
    assert_eq!(
        snapshot["tasks"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|task| task["status"] == "running")
            .count(),
        1
    );
    keep.finish(false, None);
    assert_eq!(
        runtime.snapshot(&config)["tasks"].as_array().unwrap().len(),
        20
    );
    config["mailAccounts"] = json!({});
    assert_eq!(runtime.snapshot(&config)["tasks"], json!([]));
    // Legacy connection pointer is still supported when the map is absent.
    config.as_object_mut().unwrap().remove("mailAccounts");
    config["mail"] = json!({"email":A});
    assert!(
        !runtime.snapshot(&config)["tasks"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[test]
fn actual_import_schema_is_queued_between_pages_and_unknown_counts_stay_unknown() {
    let root = std::env::temp_dir().join(format!("morrow-activity-{}", uuid::Uuid::new_v4()));
    let db = Store::open(&root).unwrap();
    db.set_settings(&config()).unwrap();
    background::start_import(&db, A, &json!({"allMail":true})).unwrap();
    let runtime = Runtime::default();
    let id = format!("import:{A}");
    let mut config = db.settings().unwrap();
    assert_eq!(task(&runtime, &config, &id)["status"], "queued");
    let mut sync = runtime.start(A, "sync", "Fetching mail", "Checking Inbox");
    assert_eq!(task(&runtime, &config, &id)["status"], "queued");
    sync.finish(true, Some(0));
    let mut page = runtime.start(A, "import", "Fetching history", "Checking All mail");
    assert_eq!(task(&runtime, &config, &id)["status"], "running");
    assert_eq!(
        runtime.snapshot(&config)["tasks"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|task| task["status"] == "running")
            .count(),
        1
    );
    assert_eq!(
        runtime.snapshot(&config)["tasks"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|task| task["kind"] == "import")
            .count(),
        1
    );
    let job = config["imports"][A].clone();
    background::apply_import_page(&db, A, &job, &json!({"messages":[{"id":"PRIVATE-ID","date":job["since"],"folder":"inbox","subject":"PRIVATE-SUBJECT","body":"PRIVATE-BODY"}],"nextCursor":null})).unwrap();
    page.finish(true, Some(1));
    config = db.settings().unwrap();
    let complete = task(&runtime, &config, &id);
    assert_eq!(complete["status"], "complete");
    assert_eq!(complete["completed"], 1);
    assert!(complete["total"].is_null());
    assert!(
        complete["detail"]
            .as_str()
            .unwrap()
            .contains("All mail · 1 pages checked · 1 messages checked · 1 new messages")
    );
    config["imports"][A]
        .as_object_mut()
        .unwrap()
        .remove("pages");
    config["imports"][A]
        .as_object_mut()
        .unwrap()
        .remove("processed");
    config["imports"][A]["status"] = "failed".into();
    config["imports"][A]["error"] = "PRIVATE-PROVIDER-ERROR token".into();
    let legacy = task(&runtime, &config, &id);
    assert!(legacy["completed"].is_null());
    assert!(
        legacy["detail"]
            .as_str()
            .unwrap()
            .contains("Page count unknown · Checked message count unknown")
    );
    assert!(!runtime.snapshot(&config).to_string().contains("PRIVATE-"));
    config["imports"][A]["status"] = "paused".into();
    assert_eq!(task(&runtime, &config, &id)["status"], "paused");
    drop(db);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn summaries_learning_and_serial_index_progress_never_expose_sources_or_raw_errors() {
    let runtime = Runtime::default();
    let mut config = config();
    let secret = json!({"id":"PRIVATE-ID","text":"PRIVATE-BODY","voice":"PRIVATE-VOICE","error":"PRIVATE-ERROR api-key","sources":[{"body":"PRIVATE-BODY"}],"createdAt":AT});
    let with_status = |status: &str| {
        let mut job = secret.clone();
        job["status"] = status.into();
        job
    };
    config["automation"] = json!({A:{"jobs":[with_status("running"),with_status("queued"),with_status("skipped")]},OFF:{"jobs":[with_status("running")]}});
    let mut running = with_status("running");
    running["sampleCount"] = 4.into();
    let mut ready = with_status("ready");
    ready["sampleCount"] = 2.into();
    config["styleLearning"] =
        json!({A:{"preview":running},B:{"preview":ready},OFF:{"preview":with_status("running")}});
    let sources = [A, B, OFF, A]
        .map(|account| json!({"account":account,"id":"PRIVATE-ID","hash":"PRIVATE-HASH"}));
    config["searchIndex"] = json!({"status":"running","completed":1,"sources":sources,"error":"PRIVATE-ERROR","createdAt":AT});
    let before = config.clone();
    let summary = task(&runtime, &config, &format!("summaries:{A}"));
    assert_eq!(summary["status"], "running");
    assert_eq!(summary["total"], 2);
    assert!(summary["completed"].is_null());
    let last = task(&runtime, &config, &format!("last-summary:{A}"));
    assert_eq!(last["status"], "interrupted");
    assert!(
        last["detail"]
            .as_str()
            .unwrap()
            .contains("result was discarded")
    );
    let learning = task(&runtime, &config, &format!("learning:{A}"));
    assert!(learning["completed"].is_null());
    assert_eq!(learning["total"], 4);
    let ready = task(&runtime, &config, &format!("learning:{B}"));
    assert_eq!(ready["completed"], 2);
    assert!(
        ready["detail"]
            .as_str()
            .unwrap()
            .contains("Review and save")
    );
    let index = task(&runtime, &config, &format!("semantic-index:{A}"));
    assert_eq!(index["status"], "queued");
    assert_eq!(index["completed"], 1);
    assert_eq!(index["total"], 2);
    assert_eq!(
        task(&runtime, &config, &format!("semantic-index:{B}"))["status"],
        "running"
    );
    let snapshot = runtime.snapshot(&config).to_string();
    for secret in ["PRIVATE-", "api-key", OFF] {
        assert!(!snapshot.contains(secret));
    }
    assert_eq!(config, before);
    config["searchIndex"]["completed"] = 4.into();
    assert_eq!(
        task(&runtime, &config, &format!("semantic-index:{A}"))["status"],
        "complete"
    );
    config["searchIndex"]["status"] = "prepared".into();
    assert!(
        task(&runtime, &config, &format!("semantic-index:{A}"))["detail"]
            .as_str()
            .unwrap()
            .contains("Waiting for your confirmation")
    );
    config["styleLearning"][A]["preview"]["status"] = "prepared".into();
    assert!(task(&runtime, &config, &format!("learning:{A}"))["completed"].is_null());
    config["styleLearning"][A]["preview"]["status"] = "failed".into();
    assert!(
        !task(&runtime, &config, &format!("learning:{A}"))["detail"]
            .as_str()
            .unwrap()
            .contains("Analyzing")
    );
    config["mailAccounts"].as_object_mut().unwrap().remove(B);
    assert!(
        runtime.snapshot(&config)["tasks"]
            .as_array()
            .unwrap()
            .iter()
            .all(|task| task["accountId"] == A)
    );
}
