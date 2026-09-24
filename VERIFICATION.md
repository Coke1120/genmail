# Verification — 23 September 2026

## Rust service candidate — 25 September 2026 (local and CI, unreleased)

M0 measurement tools, M1 paged clients, M2 read worker and M3–M5 service functionality are implemented. **The packaged default remains Node; Rust selection is explicit and fails closed.** This is a tested candidate, not a claim of stable production distribution or M6 Tauri completion. See [the compatibility inventory and remaining gates](docs/RUST_MIGRATION_INVENTORY.md).

- Local `npm run check`: 110 Node test entries, 108 passed and two explicitly gated Rust HTTP tests skipped; React production build passed. Rust-only contracts run separately under `npm run rust:test`.
- Rust fixtures cover Gmail/Graph and IMAP/SMTP over isolated TLS, OAuth, all AI catalog workflows, learning, imports, schedules, search/index cancellation and budgets, original retry fingerprints, duplicate-owner IDs, shutdown, panic/disk-full transaction rollback, abrupt process death with on-disk journal recovery, writer exclusion and verified backup restore. `npm run rust:test` passed: rustfmt, clippy with warnings denied, 71 Rust tests, locked release/debug builds and all seven Node/Rust contracts. Additional recovery checks retain a stale index-completion marker across reopen; empty-vector reconciliation succeeds with SQLite writes disabled after permission generations are recorded.
- `npm run macos:test` and `npm run macos:rust:test` passed. The new harness launches the actual AppModel against a production Rust service in an isolated temporary bundle, exercises all six sorts across 130 colliding-ID rows, full-body/draft ownership, unread state, Bcc, permissions, simulated AI/workflows, localhost OAuth handoff, disconnect/cache retention and two clean restarts. Node reopens the Rust-written encrypted settings. The visible backup control now calls the engine-aware AppModel helper; its online backup preserves both connections, duplicate-owner mail and the saved Bcc draft, rejects overwrite without changing bytes, and keeps the service available. Node successfully opens/decrypts this snapshot after service shutdown. Native locale uses BCP47, including region extensions.
- An isolated copy of the actual native Rust app was also exercised through accessibility: 65-message inbox, Next to the 15-row second page, and full Traditional Chinese message text. Opening unread mail updated the badge and refreshed the list to page one while retaining the reader, consistent with revision-bound cursors. The automation connection failed when opening Settings (`native pipe closed before response`) and after one reset; both fixture processes remained running and were then cleanly closed. Settings visual/IME acceptance is not claimed.
- Actual Electron/React development smoke passed with both Node and Rust backends. The Windows Rust packaged executable also passed authenticated renderer, inbox, search/highlights/saved search, paging, full-draft loading, sandbox and private API smoke checks. API/client harnesses do not replace manual UI/IME/accessibility acceptance.
- Rust updater unit/integration fixtures passed, as did the original Node updater suite. `updater:rust-upgrade:test` passed on macOS and Windows: the unchanged Node installer verified and installed copies of the actual Rust candidates, waited for both PIDs, restarted production SwiftUI/Electron with Rust, preserved each fixture workspace and old app, and restored a backup made by the installed service. Existing client recovery values must remain byte-identical while the UI may add normal preferences; backup must preserve the complete post-restart snapshot. Windows native API checks verify protected staging and owner/System-only DACLs. Workspace path preservation is also asserted on a real Rust-helper restart.
- The final local macOS candidate from `f2f6801` passed ad-hoc deep/strict codesign, bundle metadata/common-version checks and actual old-Node-installer upgrade/restart/backup restore. Its packaged service SHA-256 is `1bc1e1c8925f911e362ad855f0b2a9ee07c2ad0337f6a207c6c3e13eaf82d98b` (21,990,864 bytes); bundled version is `0.5.0-beta.2`. It contains the Rust service and 2,661,345 bytes of dependency notices, without a backend Node runtime. Later changes only adjusted Windows/test fixtures and documentation. This is not Developer ID signing or notarization; the Windows candidate remains unsigned.
- Locked dependency audit (`cargo-audit 0.22.2`) reported zero vulnerabilities and zero warnings locally. Packaging collects normal/build dependency notices and source links, including OpenCC and nested upstream notices.

All five check jobs in [CI run 36050110233](https://github.com/Coke1120/genmail/actions/runs/36050110233), source `5ff69436372316e120805c34fb62529f6730cf7f`, passed: Ubuntu/macOS/Windows general checks, dependency audits and benchmarks, plus both macOS/Windows Rust desktop jobs. Default Node packages, native/packaged smoke and the original updater checks also passed. The release job was skipped. Earlier Windows runs exposed fixture tooling/path assumptions and a whole-client-state comparison that incorrectly rejected a normal added preference; fixes retained production verification and exact existing recovery values. Subsequent documentation-only changes record these results without changing the tested product code.

All provider/model traffic used isolated generated fixtures, with no real send, calendar write, paid inference or owner workspace. Production cutover, signing/notarization, minimum-OS/manual UI and live-account acceptance remain explicit gates. This manual CI run does not publish a release; the packaged default remains Node.

### M0/M1 historical baseline and read-worker comparison

The following was measured before the complete service port and is retained as a data-flow baseline. It must not be used as a direct RSS ratio against the standalone Rust service: the Node sample includes its driver.

On this Apple M4 / Darwin 27.0.0 / Node 26.7.0 host, the state request changed as follows. The new response contains 50 metadata rows; the baseline contains the entire selected mailbox, including bodies.

| Fixture messages | Baseline bytes | Paged bytes | Baseline warm p50 / p95 (ms) | Paged warm p50 / p95 (ms) |
| --- | ---: | ---: | ---: | ---: |
| 1,000 | 1,436,833 | 26,686 | 12.05 / 14.04 | 1.89 / 3.37 |
| 10,000 | 14,344,355 | 26,849 | 151.74 / 154.11 | 2.59 / 3.47 |
| 50,000 | 71,819,978 | 27,006 | 906.54 / 910.22 | 5.39 / 7.16 |

At 50,000 messages, the measured request stopped calling `listMessages` (formerly four calls); settings reads fell from 29 to 15. Warm lexical HTTP p50/p95 was 42.42/42.80 ms on the revised Node path and 29.17/29.40 ms with the release Rust worker. Sampled Node/driver plus worker RSS was about 173.9 MB, of which the worker was 6.9 MB, with two service processes. The Rust round trip on the first query was 16.40 ms including its SQL execution. These figures do not isolate IPC or establish overall application memory/latency.

Each size uses a new process and workspace, two fictional accounts, colliding IDs, mixed English/Chinese text and 1 KiB bodies. Five warm samples are descriptive, not a statistical performance guarantee. The benchmark includes the in-process HTTP driver, excludes UI/parent harness, does not flush OS file caches, and measures Node CPU rather than total worker CPU. It uses unchanged SQLite FULL/DELETE durability. The complete service now has separate locale, indexing and idle fixtures; whole-app RSS, MainActor/slow-account UI traces and minimum-OS acceptance remain separate gates.

### Complete Rust service performance

The service benchmark uses a copied immutable release binary, two fictional accounts, 1 KiB bodies and 1,000 / 10,000 / 50,000 rows. It records migration and restart separately, five warm requests, service PID RSS/CPU separately from the Node driver, 30 seconds idle and recovery of 1,000 missing derived index rows. Exact final measurements are stored under ignored `test-results/migration-rust-service.json`.

Standalone service measurements on Apple M4 / Darwin 27, source `f2f6801`, release SHA `064adb203309d633114cbed8df3827a8bfd4425b5482707ce778458bd4e20fcb` (22,119,344 bytes):

| Rows | Warm state p95 ms | Lexical p95 ms | Page p95 ms | Sender p95 ms | Migration / restart ms | Service sampled RSS MiB | CPU over 30s idle ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 2.80 | 11.22 | 1.04 | 3.59 | 52.33 / 5.56 | 21.28 | 40 |
| 10,000 | 2.59 | 16.54 | 1.22 | 26.31 | 346.69 / 7.79 | 21.11 | 30 |
| 50,000 | 27.20 | 43.97 | 1.83 | 124.54 | 1579.10 / 17.75 | 21.30 | 40 |

At 50k, state/search/page/revision payloads were 26,932 / 22,733 / 20,764 / 73 bytes. All count, sender ordering, distinct-owner cursor, bounded metadata and single-writer assertions passed. Migration includes the consistent backup and first construction of the source-metadata expression index; the migration/restart difference is not a measurement of index creation alone. These are service measurements, not whole-app memory or UI responsiveness.

A 50,000-row partial rebuild initially delayed one state request by 3.81 seconds. Repeated traces identified SQLite sorting/JSON reads blocking the shared DB queue; HTTP body transfer/decoding was below 0.2 ms. Covering anti-joins and separate indexed/missing aggregation first reduced matched state requests from 351–471 ms to 164–198 ms. A source-metadata expression index then removed the missing-row JSON scan. The final main run recovered **1,000 missing rows in a 50,000-row workspace** in 0.99 s, with a largest concurrent state request of 42.80 ms. Counts, metadata-only responses and paging stayed correct. Earlier reports are retained separately; these partial-rebuild results do not establish complete-index-loss or arbitrary-body-size performance.

A separate complete-loss run removed all 50,015 derived rows, including demo mail, and required both real-account coverage and the rebuild warning to reach completion. The final binary restored them in 44.11 s; 252 concurrent state samples had p50 / p95 / maximum of 31.71 / 47.18 / 59.37 ms. Counts, metadata, cursor ownership and monotonically increasing search coverage/expected IDs passed throughout. The report is `test-results/full-loss-after-empty-reconcile.json`. Before the metadata index, the same fixture took 100.08 s with state p95 663.76 ms. An intermediate run recorded an unexplained 2.24 s server-wait spike; it was not reproduced in subsequent runs and is retained in the evidence. Profiling separately confirmed unnecessary empty-vector DELETE journal/fsync work in state/tick reconciliation, now skipped after recording permission generations. This does not prove that it caused the isolated spike. SQLite FULL/DELETE durability is unchanged; no cold-OS-cache, arbitrary body-size, Windows or whole-UI latency claim follows from these Mac runs.

CI run 36050110233 also reproduced the 1k/10k/50k corpus with Node, the Rust read worker and the complete Rust service on both desktop platforms. The complete service's 50k warm lexical p95 was 79.72 ms on the macOS 15 Apple M1 virtual runner and 154.31 ms on the Windows 10.0.26100 AMD EPYC 7763 runner; state p95 was 19.25 / 21.89 ms respectively. Every service correctness and partial-index-recovery assertion passed. Raw reports are in that run's `migration-benchmark-macos-15` and `migration-benchmark-windows-latest` artifacts. These separate virtual-host samples are not a cross-platform speed ratio, minimum-OS acceptance or Windows full-index-loss measurement.

## Original alpha artifact — 23 September 2026

Artifact: `build/macos/Morrow Mail.app`, Apple silicon, minimum macOS 13.5 for the bundled runtime. Native SwiftUI interface; no web view. The generated app contains its runtime, production dependencies, original icon, setup documentation, and license notices.

## Passed

GitHub Actions checks on macOS and Ubuntu with Node 22 passed for the initial public alpha source.

- `npm run check`: **65 backend tests**, followed by a successful web production build.
- `npm run macos:test`: **3 native model/recovery checks plus recipient/footer persistence, reply ownership and all six sort modes**, SwiftUI compilation, and native-client integration against isolated provider fixtures.
- Native-client integration: all **19 AI behaviors**, server-enforced permission denial, independent Google/Outlook calendar listing and creation, calendar request replay, draft persistence, uncertain send review, explicit retry, confirmed-send replay, legacy mailbox migration, multiple accounts, combined-view ID collisions, account-owned drafts, and disconnect isolation.
- Multi-account backend checks: preserved legacy credentials, multiple OAuth providers, case-insensitive reconnect, combined sorting, duplicate message IDs, per-account AI/send/workflow routing, view changes during AI requests, reconnected/disconnected-owner rejection, partial sync failure, and reconnecting retained cache.
- Private native service: per-launch bearer authentication, hostile-origin rejection, OAuth handoff routing, safe callback HTML, parent-pipe shutdown, invalid startup rejection.
- Native UI exercised: app launch, inbox and reader, mark-read-on-open, demo summaries, workflow preview/apply, model test/save, and persisted per-behavior permission changes. All behavior/folder/content controls were visible through accessibility.
- Multi-account UI exercised against an isolated fixture bundle: combined owner badges, individual inbox switching, account-locked replies, draft saving, new-message From selection, explicit send review, uncertain delivery, reviewed retry, and disconnecting one account while the other remains connected.
- Web UI exercised against isolated fixtures: combined account selection, duplicate-ID message selection, account-locked reply composition, draft save into the correct mailbox, and switching to an individual inbox without another account’s drafts.
- Calendar UI exercised against isolated fixtures: Google/Outlook calendar selection, event editor, destination/time review, explicit creation, and event display. No real providers were contacted.
- Online backups preserve the matching encryption key, consistent SQLite data, and pending native calendar requests; restored credentials and database integrity are verified.
- Release app builds successfully; `codesign --verify --deep --strict` and Info.plist validation pass. Bundled production service sources match the workspace, with no acceptance provider fixtures included.

## Alpha UI acceptance

- Native isolated app: Compact removed previews; Oldest-first changed the message order; ⌘N opened the composer; To/Cc/Bcc appeared together in ⌘⇧D review; cancelling review then ⌘S saved the draft; ⌘F focused search.
- ⌘⇧M from the combined inbox retained the selected account, loaded fixture folders, reviewed account/action/destination, and moved only that account's message after confirmation.
- Standard close/minimize/full-screen controls and macOS Window menu were present; Compact window-size preset worked. Reader/list widths and the minimum window width were adjusted after checking the smaller window. Restart restored density and sort choices. Test data was moved to a private temporary directory to avoid macOS Documents-folder permission prompts after re-signing the fixture app.
- Web selectors persisted Compact and Subject sorting. Automated backend checks cover complete recipient persistence. The initial alpha session could not finish web recipient/provider confirmation because of a browser confirmation dialog. The later footer session verified To/Cc/Bcc input, send review and saved reply content; provider-move web acceptance remains pending.

## Alpha mail additions

- Recipient validation, empty-To/Bcc-only delivery, header injection rejection, recipient cap and duplicate removal, complete recipient-set replay identity, SMTP envelope/Bcc header handling, and partial SMTP acceptance recovery are covered by automated checks.
- Opt-in provider organization scopes, Gmail label modification, Outlook nested folders and immutable IDs, hostile pagination rejection, IMAP capability/UID-validity guards, destination UID mapping, explicit account/confirmation checks, and post-move cache identity are covered by isolated provider fixtures.

## UI and footer changes (0.4 alpha)

- Backend tests cover HTML allowlisting, removal of scripts/images/remote resources, bounded inputs, escaped message bodies, and generated plain-text alternatives. MIME tests verify the footer in Gmail, Outlook and SMTP submissions while preserving Bcc behavior.
- Draft/retry tests preserve the footer across settings changes and restart, reject altered retry content, and route a reply to its owning mailbox when provider IDs collide and To uses an alias.
- Native isolated UI verified All accounts, per-account and Demo disclosure, persisted collapse after relaunch, combined-view account-locked reply, HTML footer preview and draft persistence.
- Repository screenshots captured from a fresh isolated native fixture app verify the final sidebar width, combined inbox, locked reply sender, recipient labels, and HTML footer layout. The screenshots contain fictional messages only.
- The native automation connection stopped responding during the final Settings check; the app process remained running and no Morrow crash report was found. Native Settings preview has build/API coverage, but its final visual acceptance is pending.
- Web isolated UI verified independent disclosure persisted after reload, locked reply From, complete To/Cc/Bcc in send review, saved footer/body, and HTML preview in settings.

## Remaining release validation

- Real Gmail, Outlook, IMAP/SMTP, Google Calendar, Outlook Calendar, and remote-model acceptance require the owner's credentials and OAuth consent. Provider tests used fixtures; no real messages or invitations were sent.
- Other supported macOS versions and hardware still need manual acceptance. The current Mac passed native compose/save/send-review/search/move shortcuts, density/sorting, and window-size preset checks.
- This local build is ad-hoc signed. The public alpha is explicitly unnotarized. Stable distribution requires Developer ID signing, Apple notarization, and provider app verification where applicable. No valid Developer ID identity was available on the build Mac.

The implementation is intended for a private, single-user Mac workspace. It does not claim error-free operation or exhaustive GenMail parity. See FEATURE_COVERAGE.md for live features and explicit simulations.

## Cross-platform release checks

- Local: 65 backend checks, React build, SwiftUI compilation and native integration passed.
- Electron shell smoke passed on macOS using an isolated demo profile: actual inbox rendering, authenticated API calls, denied unauthenticated access, no renderer Node API, and persisted disclosure state. This does not substitute for Windows execution.
- Desktop-state tests cover persistence, invalid keys, oversized writes and corrupt-state rejection; backups retain Windows client recovery metadata.
- [Paired CI run 35875758706](https://github.com/Coke1120/genmail/actions/runs/35875758706) passed on Ubuntu, macOS arm64 and Windows x64 with Node 22. Windows built and launched the packaged `.exe`, checked backend/app version agreement, loaded the demo inbox and verified private API access. macOS passed SwiftUI integration and app packaging. Tagged releases repeat these checks before publication.
- Windows manual UI acceptance, live providers and distribution signing remain pending. The alpha is not certified production-ready.

## Published macOS walkthrough — 23 September 2026, 23:12–23:17 HKT

Tested the downloaded `v0.4.0-alpha.1` macOS arm64 release in a fresh, isolated demo workspace. The ZIP matched the published SHA-256 (`c4ad4a5857c9501ffa8977c3db8c7bea09f098f5e04ecc52fbe6b72cc2a866c8`) and its original signature verified. The test copy changed only the bundle identity/name and `MORROW_DATA_DIR` launch environment, then received a local ad-hoc signature; the published application code and bundled backend were unchanged. No real mailbox or calendar was connected.

| Check | This session's result |
| --- | --- |
| Launch the published SwiftUI app | Passed; 12 demo inbox messages and the three-column layout rendered. |
| Open a message | Passed; reader displayed the selected sender, recipient and body, and unread count decreased from 4 to 3. |
| Compact mode | Passed; previews disappeared and the list footer reported `compact`. |
| Sorting | All six choices were visible; selecting Sender A–Z reordered the list. |
| Search shortcut | Passed; Command-F focused the search field. |
| Search results | `Northstar` returned 3 messages; an unmatched term returned 0, an explanatory empty state and Clear Filters. |
| Settings shortcut and further UI walkthrough | Blocked: after Clear Filters and Command-comma, the automation tool returned `Sky Computer Use native pipe closed before response`. Screenshot, session reset and reconnect attempts failed with the same error. The Settings screen itself was not observed. |
| Source regression checks | Passed: all 65 backend tests and React production build; Swift model/recovery, recipients, six sorting modes, reply ownership, footer persistence, SwiftUI compilation and native API integration. |
| Native integration fixtures | Passed: 19 AI behaviors, permission denial, Google/Outlook calendars, request replay, uncertain-send recovery, multi-account ownership, duplicate provider IDs and disconnect isolation. These are API/client checks, not UI or live-provider acceptance. |

The application and bundled Node process remained running after the tool failure. A one-second process sample showed the main thread waiting in the normal AppKit event loop; no Morrow crash report was found. This does not establish that Settings works visually or identify the automation failure's cause.

This walkthrough is **partial**, not a complete acceptance pass. Settings, HTML footer editing/preview, AI checkboxes, composing/replying, multi-account disclosure, calendar editing and window-control interaction still require a resumed UI pass for this release. Earlier sessions above remain separate evidence. No application defect was confirmed, no product code was changed, and no new release was published. Local diagnostic evidence is under the ignored `test-results/macos-walkthrough-0.4.0/` directory.

## Update checks and AI triggers — 24 September 2026

Local source changes, not a newly published release:

- `npm run check`: **70 tests passed**, followed by the React production build. New coverage includes release channels and semantic version ordering, drafts/invalid tags, rate limits/offline/malformed responses, route caching/retry behavior, default-off AI triggers, filter intersection, redaction, duplicate IDs across accounts, invalid trigger requests, overlapping-request coalescing and in-flight permission/model changes.
- `npm run macos:test`: SwiftUI compilation and all native checks passed, including decoding an available-update response and default-off/enabled summary and reply trigger requests. Provider/model traffic in these integration checks uses fixtures.
- `npm run macos:build`, strict/deep code-signature verification and Info.plist validation passed. The local app remains ad-hoc signed.
- `npm run desktop:test`: Electron smoke passed on macOS. This is not Windows packaged acceptance.
- A real public GitHub check returned installed/latest `0.4.0-alpha.1`, no update available, and the correct release page. No credentials or mail were sent to GitHub.
- Isolated React UI: clicked Check for updates and verified installed/latest version, timestamp and download link; excluding prereleases displayed an explicit no-release error. Verified both AI triggers default off, saved both triggers plus starred-only, and observed a labeled demo summary only for a starred message. Starting a reply displayed suggested text while the body stayed empty; clicking Use suggested reply filled the body, retained the recipient and saved as a draft without sending. Reload retained the checkboxes. Turning both triggers off removed automatic assistance while reading remained available.
- Native UI: the isolated rebuilt app launched and Settings → Mail opened. Switching to About again returned `Sky Computer Use native pipe closed before response`, preventing native visual acceptance of the new controls. Native build/API evidence above does not substitute for this missing visual pass.
- Final React trigger check: with summaries enabled, returning to the default first-message preview did not run AI; explicitly selecting that message displayed the summary. This avoids new requests from default selection changes during launch/sync. React production build passed after this adjustment.

No real provider messages/calendar events were created and no paid model was contacted. Windows executable testing and the remaining macOS Settings visual pass remain pending; no paired release was published for these source changes.

## Scheduled summaries and languages — 24 September 2026 (local, unreleased)

- The shared service now owns all-account periodic mail sync and opt-in AI jobs. Both clients expose daily time/time-zone or 1–168-hour summaries, newly synced mail summaries, P0–P4 reports, preferred AI language and an independent translation target. At that checkpoint, Email Brain/style updates remained manual simulations/edits; see the later historical-import and learning checkpoint below.
- `npm run check`: 78 backend tests and React production build passed. New checks cover schedule validation, time zones/DST, clock rollback, persisted interval anchors, no daily replay after restart, initial-import exclusion, repeat-sync deduplication, duplicate IDs across accounts, redacted model context, language separation, P0–P4 response completeness, in-flight policy/model/connection/content invalidation, crash/failure no-retry, and queue/history bounds. Fixtures do not contact live providers/models.
- `npm run macos:test`: SwiftUI compilation, native model checks and actual native-client integration passed, including round-tripping both language settings and the new trigger/schedule values. Existing 19 behaviors, calendar, recipient/footer, send-recovery and account-isolation checks passed.
- Browser UI against a separate temporary demo workspace: saved and reopened 繁體中文 / 日本語 preferences; enabled new-mail and scheduled-summary checkboxes; selected one-minute sync; saved daily `00:00` in `Asia/Hong_Kong`; observed a completed eight-message, P0–P4 illustrative summary in AI Studio → Summaries; changed to every two hours and confirmed persistence after reload. No actual priority/language quality is claimed from demo responses.
- `npm run desktop:test`: Electron development smoke passed on macOS (authenticated renderer, demo inbox, sandbox and private API). Windows packaged execution for these changes remains pending.
- The rebuilt native app launched in an isolated `MORROW_DATA_DIR`. Clicking Settings again caused the computer-use tool to return `Sky Computer Use native pipe closed before response`; the app and bundled service remained running. The new native Settings/summary screens have compilation/API coverage but visual acceptance is still blocked by that tool failure.
- `npm run macos:build`, `codesign --verify --deep --strict`, and Info.plist lint passed for the rebuilt local arm64 app; signing remains ad-hoc.
- No new release was published. Scheduling is best-effort while the service runs, uses bounded cached context, and is not Gmail/Outlook push or an operating-system background service. Real-account/model acceptance and signed/notarized distribution remain outstanding.

## Historical import and writing-style learning — 2026-09-24 (local, unreleased)

- Both clients now expose 1/3/6/12-month Inbox/Sent import choices, account-specific progress, pause/resume, and separate opt-in Learning settings. History downloads do not invoke AI. The writing-style flow previews the exact cleaned bodies and a conservative token estimate, analyzes at most 50 samples intersected with the global context limit, and requires an edited/reviewed Save before using a style. Optional weekly analysis only proposes updates from new cached Sent mail.
- `npm run check`: **87 tests passed**, plus the React production build. Coverage includes calendar-month clamping, checkpoint/restart/pause/reconnect behavior, pagination loops, IMAP folder-specific IDs and changed UIDVALIDITY, matching imported Sent copies to local delivery records without changing their retry fingerprints, Graph bearer-safe page URLs, account/header guards, initial-history arrival suppression, ownership/date/automatic-mail filtering, deduplication and body-only model context, budget/context caps, review/apply/replay controls, permission/source changes, interrupted calls, weekly opt-in and incremental selection.
- `npm run macos:test`: model checks, SwiftUI compilation and native API integration passed, including history controls and the style preview → analyze → approve → delete flow. Tests use temporary fixture workspaces and a fixture model; no live email/calendar/model request is made.
- Browser UI acceptance in an isolated fixture workspace passed: IMAP Settings opens, default 3-month Inbox/Sent choices are visible, an import pauses/resumes and reaches complete, Learning starts off, preview shows three cleaned samples and token estimate, quoted text is absent, analysis exposes provider-reported usage, and edited approved style becomes active. This walkthrough found and fixed a pre-existing IMAP Settings crash caused by an OAuth-only checkbox; a runnable React rendering regression covers all three provider forms.
- `npm run desktop:test` passed the Electron development smoke check on this Mac. It is **not** Windows packaged acceptance. The macOS app was rebuilt locally and its ad-hoc signature and Info.plist verified.
- Native GUI acceptance remains **blocked by the computer-use tool**: it reports “Sky Computer Use native pipe closed before response” when clicking Settings. The isolated app process remains running. This is not evidence that the native Settings page passed visual/interaction acceptance, nor a confirmed app crash.
- Limits: no authenticated Gmail, Microsoft or IMAP acceptance; no live custom-model billing validation; quote/signature removal is heuristic; latest-50 periodic folder refresh is not continuous provider delta sync; very large caches still need UI pagination/performance work. No new public release was created.

## v0.5.0-alpha.1 release candidate — 2026-09-24

- `npm run check`: **88 tests passed** and the React production build passed. The additional regression verifies that renewed weekly-learning consent excludes messages from the paused period and that an invalidated preview cannot permanently block later weekly proposals.
- `npm run macos:test`: native model checks, SwiftUI compilation and fixture-backed native API integration passed, including update checks, language/schedule settings, import controls, and the reviewed writing-style lifecycle.
- `npm run macos:build`, strict/deep signature verification and Info.plist validation passed. The bundled backend reports `0.5.0-alpha.1`; the app remains ad-hoc signed and unnotarized.
- The paired GitHub workflow must pass Ubuntu, macOS packaging and Windows packaged launch checks before its publisher makes either download public. See the tag's Actions run for the resulting CI evidence.
- Earlier checkpoints above describe pre-release work and their test counts at that time. Their native Settings GUI, Windows manual UI and live-provider/model acceptance limitations still apply; this alpha does not establish production readiness.

## Published v0.5.0-alpha.1 — 2026-09-24

- [Release](https://github.com/Coke1120/genmail/releases/tag/v0.5.0-alpha.1), published as a prerelease at 06:26 UTC, contains both platform ZIPs and their two checksum files. Both packages come from commit `924a1950b6e775ee54e59f474e174d8fa2bc7ca4`.
- [Candidate CI](https://github.com/Coke1120/genmail/actions/runs/35963991934) and [tagged release CI](https://github.com/Coke1120/genmail/actions/runs/35964230460) passed on Ubuntu, macOS arm64 and Windows x64. Windows passed the packaged executable smoke test; macOS passed native compilation, fixture integration and app packaging. The publisher waited for all three jobs before publishing.
- Downloaded both public ZIPs and verified their SHA-256 checksums: macOS `b0014dca97ba9cbdf4ff5626c1f650e9d8e0b652c9fda23ae93f43bdc71c9975`; Windows `0d02abe6c216bce15b3752a87a58c660d00788c0d3b1f638b834f084be48fe86`.
- The downloaded Mac app passed strict/deep signature verification and Info.plist validation, and its bundled backend reports `0.5.0-alpha.1`. This is ad-hoc signing, not notarization.
- Live, read-only GitHub update checks found `0.5.0-alpha.1`: an installed `0.4.0-alpha.1` reports an available update; the current version reports no update. These checks included prereleases and did not access mail, calendars or a model.
- The release notes retain the native Settings GUI tool failure, pending Windows manual UI/live-account acceptance, unsigned/unnotarized distribution, and documented feature limits. Publication does not resolve those limitations.

## Browser sign-in UX and native callback refresh — 2026-09-24 (local patch)

- Both clients label the OAuth action as browser sign-in and place the callback URL inside advanced registration details, explaining that it must not be opened manually. macOS includes a callback copy button. OAuth app credentials are still required; this change does not supply a hosted registration.
- Fixed native state refresh retaining the previous mailbox header after a successful browser callback. Workspace reads now follow the service's selected account, while message mutations retain their explicit owner. Windows Settings refreshes connections when returning from the browser if no unsaved edits or operations are pending.
- `npm run check`: **88 tests passed**, including OAuth cookie/PKCE/state/replay checks and React provider-form rendering; the production React build passed.
- `npm run macos:test`: SwiftUI compilation and native client integration passed. The added regression follows actual loopback authorize/callback requests with a separate cookie-bearing session, blocks external redirects, and uses fixture token exchanges for Google/Microsoft mail and calendars. Mail callbacks select the connected live inbox after refresh; calendar callbacks leave the selected mailbox unchanged. No real provider was contacted.
- The local Mac app build, strict/deep signature verification and Info.plist lint passed. `npm run desktop:test` passed on macOS; this is not Windows packaged execution. This patch is not part of the published `v0.5.0-alpha.1` downloads, which remain unchanged.
- Installed this local patch at `/Applications/Morrow Mail.app` after a normal quit, retained the previous application bundle, and verified the new app launches with the existing workspace. No mailbox data or settings were replaced. Clicking Add account again caused the native computer-use bridge to close, so the new Settings controls still lack native GUI acceptance; the four fixture OAuth flows above are API/client evidence only.

## Built-in Google Desktop OAuth — 2026-09-24 (local, unreleased)

- macOS and Windows packaging now accept a Desktop OAuth build input. Both clients offer Google mail/calendar sign-in without credential fields when it is configured, with an advanced custom-client override. Microsoft remains bring-your-own client ID. The public `v0.5.0-alpha.1` assets remain unchanged.
- The repository Actions secret `GOOGLE_DESKTOP_OAUTH_JSON` is configured for both platform build steps; tagged builds reject a missing input. Only the two installed-client fields are embedded; the original JSON and user tokens are not committed or returned by public API responses. Desktop client credentials are extractable from a distributed app.
- `npm run check`: **90 tests passed**, plus the React production build. Added checks cover Desktop-only parsing, sanitized packaging, invalid/missing build inputs, default/custom credential selection, configured-state redaction, and browser-bound Google mail/calendar fixture callbacks using the default client.
- `npm run macos:test`: SwiftUI compilation, model checks and native API integration passed. The isolated test backend packages a fake Desktop client and exercises default Google sign-in alongside custom Microsoft sign-in. No live Google account, token exchange, email, calendar event or model request was used.
- Cloud API enablement, consent-screen test users and Google verification cannot be established by these fixture checks. Native Settings GUI acceptance remains subject to the computer-use bridge failure documented above.
- The local arm64 app built with the supplied Desktop client, passed strict/deep signature verification and Info.plist lint, and passed an isolated packaged-service check for both Google browser handoffs, PKCE, sanitized client fields and public-state redaction. That check stopped before contacting Google. Signing remains ad-hoc.
- `npm run desktop:test` passed on macOS. Installed the new app at `/Applications/Morrow Mail.app` after a normal quit, preserved the prior bundle and all workspace data, and verified inbox launch. The Add account action again caused the computer-use bridge to close; the Settings controls and live consent flow have not passed GUI acceptance.
- [Paired CI for `a50f442`](https://github.com/Coke1120/genmail/actions/runs/35974628274) passed on Ubuntu, macOS arm64 and Windows x64. Both desktop builds passed; Windows also passed its packaged executable smoke test. This validates the source/build pipeline, not Google consent, live-account access or manual Windows UI acceptance. No tag or public release was created for this change.

## v0.5.0-beta.1 release candidate — 2026-09-24

- Promotes the built-in Google sign-in and browser callback changes above to a paired beta. The release publisher now accepts matching numbered alpha/beta tags, still rejects stable/mismatched tags, and retains both-platform, checksum and draft-publication guards.
- Local `npm run check`: **91 tests passed** and the React production build passed. Tests cover the publisher’s version gate and alpha-to-beta update ordering. Tagged CI must run backend/React checks on all three hosts, native macOS tests/build, and Windows build/packaged smoke before publishing either platform.
- Beta naming does not resolve the documented live-account, Google verification, native Settings GUI, manual Windows UI or distribution-signing limitations. See the tagged Actions run and release notes for publication evidence.

## Published v0.5.0-beta.1 — 2026-09-24

- [Beta release](https://github.com/Coke1120/genmail/releases/tag/v0.5.0-beta.1) published at 08:40 UTC as a prerelease, with macOS arm64 and Windows x64 ZIPs plus both SHA-256 files. Both packages use commit `575662a108fe878694870943cf5d6aef1926680f`.
- [Main CI](https://github.com/Coke1120/genmail/actions/runs/35976296548) and [tagged release CI](https://github.com/Coke1120/genmail/actions/runs/35976296570) passed on Ubuntu, macOS and Windows. Checks include 91 backend tests/React build, native Swift compilation/API integration, both desktop builds, and Windows packaged executable smoke. Publication waited for all platform jobs.
- Downloaded both public ZIPs and verified their supplied SHA-256 checksums: macOS `502015ef8bc1c8dcb45cb6740a47ae17fed6bbcf06c658b9d4a307f77206b149`; Windows `cb0f3e61160a5ea816207050d6b827527b8c16762f27cd5e105db6c09cf1ee04`. Both bundled package versions report `0.5.0-beta.1`; both contain the intended publisher Desktop OAuth registration with only the required client fields.
- The downloaded Mac app passed strict/deep signature verification and Info.plist lint. It remains ad-hoc signed and unnotarized; Windows remains unsigned.
- Live, read-only GitHub update checks return `0.5.0-beta.1`: `0.5.0-alpha.1` reports an available update and `0.5.0-beta.1` reports no update. No mailbox, calendar or model was accessed.
- Release notes retain Google test-user/API/verification requirements, native Settings GUI and live-account acceptance gaps, and existing feature limitations. Beta publication does not establish production readiness; existing alpha assets were not replaced.

## In-app updates — 2026-09-24 (0.5.0-beta.2 candidate)

- Both desktop clients expose signed download and explicit Install & Restart. Renderer requests cannot choose an executable, install directory or download URL; preparing installation requires a separate host credential on Windows. Native app termination and Electron close guards protect current operations and unsaved edits.
- Added checks for manifest signatures/version/platform/size, HTTPS redirect restrictions, traversal/symlink/local-header ZIP rejection, replacement rollback and workspace preservation. Existing public macOS/Windows ZIPs pass the archive inspector.
- On macOS, `npm run updater:test` passed the complete isolated flow: fixture-signed download, cancellation, protected install authorization, installer readiness, both process exits, replacement, launch of the new fixture app and preserved workspace. The first fixture incorrectly targeted a newer macOS; setting its deployment target fixed the fixture, and the updater now also checks minimum macOS before installation. This is fixture acceptance, not a live-account test.
- The update signing private key was created outside the repository and stored in GitHub Actions secrets; only the public key is shipped. Bootstrap requires one manual install of an updater-enabled build. Existing public beta.1 assets remain unchanged.
- Local `npm run check`: **94 tests passed**, plus the React build. SwiftUI/model/native API checks and Electron development smoke passed. CI also runs the full updater fixture on both desktop hosts before a release can publish; this includes a separate macOS incompatibility rejection check.

## Published v0.5.0-beta.2 — 2026-09-24

- [Beta release](https://github.com/Coke1120/genmail/releases/tag/v0.5.0-beta.2) published at 09:28 UTC from commit `0d04ddcaaf9870f59bdf38779022c008e8b08315`. It contains both platform ZIPs, two SHA-256 files, and the Ed25519 update manifest/signature. Previously published assets were not replaced.
- [Candidate CI](https://github.com/Coke1120/genmail/actions/runs/35980840002) and [tagged release CI](https://github.com/Coke1120/genmail/actions/runs/35981136707) passed on Ubuntu, macOS arm64 and Windows x64. Both desktop hosts passed the complete isolated updater download/cancel/install/restart test; macOS also passed native compilation/API integration, and Windows passed packaged Electron smoke. The initial Windows fixture loader used a filesystem path where Node required a file URL; the fixture was corrected before tagging.
- Downloaded both public packages and verified signed manifest size/hash/version/platform fields, archive entry safety, bundled version and each bundled public key's ability to verify the release signature. SHA-256: macOS `da93e1185bd5d8cd1eeaf24870249fea1b1f88b65514cb4618317a5bb3ab6a86`; Windows `8e4785ab2f888d223b844df412eea8d4345c8f408ff0ad6beb34bb25e047709b`.
- The downloaded Mac app passed strict/deep code-signature verification and Info.plist lint. Live GitHub update checks identify beta.2 as newer than beta.1 and report no update for beta.2 itself. No mailbox, calendar or model was contacted.
- A manual installation of this release bootstraps future in-app updates; this session did not replace the owner's installed app. The updater test launches generated fixture applications, not the owner's workspace. Native Settings GUI acceptance, manual Windows UI acceptance, real-account acceptance and distribution signing remain limited as documented above. The Mac package remains ad-hoc signed/unnotarized; the Windows package remains unsigned.

## Indexed and smart search — 2026-09-25 (current source, unreleased)

- `npm run check`: **100 backend tests passed**, plus the React production build. Search coverage includes migration/backfill without losing mail, FTS updates/deletes/transaction rollback, short Chinese and traditional/simplified matching, safe highlights, phrases/filters, account ownership and duplicate IDs, disconnected/demo isolation, sorting/pagination and saved searches.
- Embedding fixtures verify preview-before-indexing, redaction before requests, incremental reuse after metadata-only changes, restart persistence, interrupted-job no-retry, OpenAI response ordering, native Ollama requests, denied redirect credential forwarding, and discarded indexing/query results after permission/connection/source changes. The six search test groups also passed using the release's bundled Node 22 runtime. Fixtures do not establish real model relevance or billing accuracy.
- `npm run macos:test`: SwiftUI compilation and native client checks passed, including indexed/hybrid search, saved search, cross-account result/reply ownership, separate embedding settings, preview/run/clear and existing provider/calendar/send recovery checks.
- `npm run macos:build`, strict/deep code-signature verification and Info.plist lint passed. The self-contained local app includes the Chinese conversion dependency. It is ad-hoc signed; this does not replace the installed app or constitute notarization.
- `npm run desktop:test`: Electron on macOS loaded the real React search controls, searched fixture mail, verified highlights/account markers, saved a search through the UI and confirmed persistence, then cleared it. Private API and renderer sandbox checks passed.
- Browser acceptance used an isolated 72-message, two-account fixture: simplified `发票` matched traditional text; all-account scope returned both colliding-ID messages; `report` returned 70 matches with 30-result pagination; filters could be removed, sorting changed, and a saved search persisted. Settings accepted a separate fixture embedding model, previewed eight messages without an AI call, completed the reviewed batch and returned the semantically matching payment email for `延期付款` (absent as a literal phrase). No real account/model was used.
- Native UI acceptance in a separate temporary fixture app verified `发票` → traditional text, all-account scope → two colliding-ID results, owning-account badges and Reply from the other account while the sidebar stayed on the first account; From remained locked to the message owner. The first fixture workspace under Documents stalled in a filesystem permission call; a fresh temporary workspace launched normally. Opening Settings again ended the native automation connection with `Sky Computer Use native pipe closed before response`. Settings visual acceptance and live provider/model acceptance remain incomplete; the API checks above are separate evidence.
- [Search CI run 36026948980](https://github.com/Coke1120/genmail/actions/runs/36026948980), commit `6428c67`, passed on Ubuntu, macOS arm64 and Windows x64. Windows built and launched the packaged application and passed search/highlight/saved-search smoke checks; both desktop hosts also passed updater fixture tests. No tag or release was created; existing beta.2 downloads are unchanged.
