# Verification — 23 September 2026

Artifact: `build/macos/Morrow Mail.app`, Apple silicon, minimum macOS 13.5 for the bundled runtime. Native SwiftUI interface; no web view. The generated app contains its runtime, production dependencies, original icon, setup documentation, and license notices.

## Passed

- `npm run check`: **60 backend tests**, followed by a successful web production build.
- `npm run macos:test`: **3 native model/recovery checks plus recipient persistence and all six sort modes**, SwiftUI compilation, and native-client integration against isolated provider fixtures.
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
- Standard close/minimize/full-screen controls and macOS Window menu were present; Compact window-size preset worked. Reader/list width limits were tightened after checking the smaller window.
- Web selectors persisted Compact and Subject sorting. Automated backend checks cover complete recipient persistence. Web acceptance of new recipient input and provider confirmation is not claimed: the embedded browser encountered a blocking JavaScript confirmation during testing.

## Alpha mail additions

- Recipient validation, empty-To/Bcc-only delivery, header injection rejection, recipient cap and duplicate removal, complete recipient-set replay identity, SMTP envelope/Bcc header handling, and partial SMTP acceptance recovery are covered by automated checks.
- Opt-in provider organization scopes, Gmail label modification, Outlook nested folders and immutable IDs, hostile pagination rejection, IMAP capability/UID-validity guards, destination UID mapping, explicit account/confirmation checks, and post-move cache identity are covered by isolated provider fixtures.

## Remaining release validation

- Real Gmail, Outlook, IMAP/SMTP, Google Calendar, Outlook Calendar, and remote-model acceptance require the owner's credentials and OAuth consent. Provider tests used fixtures; no real messages or invitations were sent.
- Other supported macOS versions and hardware still need manual acceptance. The current Mac passed native compose/save/send-review/search/move shortcuts, density/sorting, and window-size preset checks.
- This local build is ad-hoc signed. The public alpha is explicitly unnotarized. Stable distribution requires Developer ID signing, Apple notarization, and provider app verification where applicable. No valid Developer ID identity was available on the build Mac.

The implementation is intended for a private, single-user Mac workspace. It does not claim error-free operation or exhaustive GenMail parity. See FEATURE_COVERAGE.md for live features and explicit simulations.
