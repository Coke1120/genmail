# Rust service compatibility inventory — 2026-09-25

Baseline: `585fe1d8bc53c04062911a97c4f1d46fa5ad0ed4`. M0 measurement tools, M1 paged clients, M2 read worker and the M3–M5 Rust service implementation are present. **The default desktop runtime remains Node until the release gates and explicit cutover approval.** Windows Tauri is conditional on M5 stability and is not part of this candidate.

## Responsibility map

| Responsibility | Rust implementation | Acceptance |
| --- | --- | --- |
| Private lifecycle / local API | `bin/morrow-service.rs`, `service.rs` | `rust-service.test.js`, `RustIntegration.swift`, Electron smoke |
| SQLite / AES settings / backups | `store.rs`, `normalize.rs` | `storage.rs`, `rust-storage.test.js`; full OpenCC corpus, Node↔Rust cipher and writes, backup restore, panic/disk-full rollback, legacy writer exclusion |
| Bounded lists / counts | `pages.rs` | Node differential HTTP tests, native integration; six sorts, locale/number/Chinese/diacritic ordering, long-subject cursor bounds, colliding IDs |
| Mail / OAuth / organization | `mail.rs`, `providers.rs`, `imap.rs`, `oauth.rs` | `mail.rs`, `mail_service.rs`, `imap.rs`, `calendar.rs`; isolated TLS, owner/Bcc, explicit send recovery, refresh rotation, Unicode folders, UIDVALIDITY and MOVE/COPYUID |
| Independent calendars | `calendar.rs`, `oauth.rs` | `calendar.rs`; browser-bound PKCE/state, pagination, 409 recovery, original Node request hashes, create/replay/restart, permission and connection races |
| AI / workflows / learning | `ai.rs`, `workflows.rs`, `learning.rs`, `policy.rs` | `ai.rs`; all catalog actions, redaction before context, source/Brain/skill revocation, automatic coalescing, preview ownership/replay, budgets/recovery |
| Imports / schedules / summaries | `background.rs` | `background.rs`; atomic pages/cursors, one history page and ≤4 serial summaries per tick, DST/clock rollback, source/generation revocation, shutdown and no automatic paid retries |
| Keyword / semantic search | `search.rs`, `search_query.rs`, `smart_search.rs` | `smart_search.rs`, `rust-search.test.js`; parser/OpenCC, exact filters, HMAC pagination, model/permissions/source generations, incremental chunks, query cache, pause/restart/budgets/transport limits |
| Signed updates / installer | `updater.rs` | Unit and `updater.rs` fixtures; real TLS downloads, signatures/ZIP/hash/platform/version, cancellation, mailbox/calendar/index busy guards, both-process wait, restart/rollback |
| Desktop hosts | SwiftUI `AppModel`, Electron `main.cjs` | Single-instance/start-stop ownership, private pipe startup, host-only update token, actual native Rust harness and packaged smoke |

## API boundary

Both clients retain the loopback HTTP/JSON contract. Desktop startup reads a bounded private stdin JSON line with the random bearer, absolute workspace, optional host update token and parent PID. Development Electron may additionally provide a validated absolute assetDirectory over the private pipe; packaged hosts use bundled assets, and this never selects OAuth credentials. Credentials never enter argv. EOF or termination signals cancel background work, drain accepted requests and finish queued database writes. A selected Rust service does not start Node on failure.

Host must be loopback; hostile Origin and cross-site requests fail. Only narrow, browser-bound OAuth authorize/callback routes omit bearer authentication. Mutation bodies require JSON, have a 256 KiB limit and a read deadline. Mail-bound mutations require a captured `X-Genmail-Account`; `all` is read/sync only. Provider IDs stay unchanged, and `viewId` is JSON `[account,id]`. Public responses contain safe connection metadata, never tokens, API keys or vectors.

Errors retain `{error}` and applicable 400/401/403/404/409/413/415/429/502 statuses. Uncertain sends retain `requiresSendReview`, the owned draft, original request ID and payload fingerprint. Reconnect and disconnect invalidate in-flight AI/search generations even if permissions later return to their original values.

| Read | Contract |
| --- | --- |
| `GET /api/state`, `X-Morrow-View: paged` | Existing settings/account/workspace plus revision/counts; ≤50 metadata rows and `mailPage`. Legacy full state includes account-scoped arrival summaries. |
| `GET /api/state/revision` | Lightweight revision/account; idle clients reload only after change. OAuth/manual refresh still reload. |
| `POST /api/mail/page` | Account header and folder/category/unread/sort/locale/cursor/pageSize; default 50, maximum 100. Signed cursor binds revision and scope. Rust cursors carry a row identity, so large subjects cannot exceed the cursor limit. |
| `GET /api/messages/:id` | Explicit connected owner, full owned message plus validated AI summary. Reader refresh preserves manual unread; drafts wait for full details. |
| `POST /api/search` | Existing syntax, owner scope, 30 results/page, safe snippets/chips/coverage. Semantic query vectors are cached/coalesced; pagination does not repeat paid embedding. |

Uncommon text sorts scan scoped metadata. This is intentional until measurements justify persistent collation keys. Folder/date paths use indexes and materialize bounded identities before reading message JSON. SQLite and synchronous work run on a bounded blocking executor; the HTTP request gate permits 32 active handlers and the database has one executor permit. Mailbox-changing work keeps the existing global gate; calendars have independent provider gates.

## Storage and recovery

- SQLite keeps composite `(account,id)` messages and JSON, `settings(id=1,value)`, FTS5 tables/functions/triggers and additive `morrow_schema=1`. FULL synchronous / DELETE journal durability is unchanged. Unsupported schema and missing/wrong keys fail closed before migration.
- Settings remain base64 of **12-byte IV + 16-byte GCM tag + ciphertext**, using the existing raw 32-byte key. Known Node pending-send and calendar hashes remain compatible.
- First takeover takes an OS workspace lock and retained SQLite exclusive lock, excluding legacy Node writers as well. It writes a consistent, integrity/decryption-checked backup to `migration-backups/<id>` before schema work. The source must be closed before a second process can back it up.
- Backups include the matching key, SQLite and `pending-calendar.json` / `client-state.json`. `morrow-service --backup <absolute-source> <new-absolute-destination>` rejects overwriting a backup. The native Back Up Workspace control uses a host-token-only online backup on the same DB executor; it retains mailbox/calendar operation exclusion. Close the app before restoring a verified matching set; never replace current data with an old backup merely to roll back a binary.
- POSIX directories/files use 0700/0600. Windows uses a protected owner/System DACL and rejects reparse points. Symbolic workspace files are rejected. Native and Electron keep their existing workspace identities; a trusted absolute `MORROW_DATA_DIR` supports isolated workspaces.
- Incremental FTS backfill keeps cached messages readable. Derived semantic chunks carry source/model/normalization version and monotonic scope generations. Revocation removes vectors synchronously; legacy Node vectors need a reviewed rebuild. Interrupted claims do not automatically replay model requests.

## Network and update limits

Production providers keep fixed HTTPS endpoints, validated pagination URLs and platform TLS verification. Shared HTTP retries and redirects are disabled; OAuth/browser redirects and updater GitHub redirects have their own narrow validation. IMAP/SMTP require TLS, with STARTTLS required on non-465 SMTP ports. IMAP responses are bounded at 8 MiB per command before parser allocation; SEARCH uses 8192-UID windows and a 128 KiB response cap. A page scans at most 32 windows, with persistent history cursors across sparse gaps. Manual/initial sync reports incomplete sparse scans and directs the user to history import; it does not claim to have reached all recent mail. MIME parsing runs serially on a blocking worker. Test trust anchors/DNS mappings live only in test/library injection; no production environment/provider override exists.

Model endpoints accept HTTP only on loopback, never follow redirects and bound request time/response size. Smart indexing caps review at 50 messages, batches at 16, and jobs at 12,000 chunks / 4 million scalars with durable budget accounting. Hybrid ranking considers at most 200 lexical plus 200 semantic candidates. Pausing, failure or restart does not silently resume paid work. Calendar listing retains the existing page/count and 90-day query bounds.

The updater keeps the compiled pinned Ed25519 key, paired manifest format, original archive roots and metadata paths (`Contents/Resources/backend/package.json`; `resources/app/backend/package.json`). It rejects renderer-selected URLs/paths/commands, verifies hash/signature/platform/version/archive layout, respects mailbox/calendar/index activity, and waits for both host and service exit before swapping. The old app is retained and the separate workspace is preserved. Stable signing/notarization and live-provider acceptance remain external release gates.

## Build and evidence

One unpublished Cargo package, lockfile, Rust 1.98 minimum; `package.json` supplies the product version. Rust candidate selection is `MORROW_SERVICE_RUNTIME=rust` at build time, stored in bundle metadata. macOS ships the native SwiftUI host and Rust executable; Windows retains Electron with Rust replacing the backend Node executable. Third-party license notices accompany the service; source links identify unmodified dependencies. `cargo audit --file rust/Cargo.lock` checks the locked graph.

```sh
npm run rust:test
npm run check
npm run macos:test
npm run macos:rust:test
npm run desktop:test
MORROW_SERVICE_RUNTIME=rust npm run macos:build
# On Windows: select rust, build, then npm run desktop:test -- --packaged
npm run updater:test
npm run updater:rust-upgrade:test
npm run benchmark:mail -- --output=test-results/migration-node.json
npm run benchmark:mail -- --engine=rust --output=test-results/migration-worker.json
npm run benchmark:rust-service -- --output=test-results/migration-rust-service.json
```

Fixtures use temporary fictional workspaces and generated signing/TLS keys. First/warm latency, migration/restart, payload and service CPU/RSS are reported separately from UI and driver. Reopen is not a flushed OS cache; five warm samples are descriptive. The 30-second idle and bounded backfill measurements do not replace Instruments, accessibility/IME checks or minimum-OS hardware acceptance. Exact local/CI outcomes are recorded in [VERIFICATION.md](../VERIFICATION.md); fixture coverage does not imply live-account acceptance.
