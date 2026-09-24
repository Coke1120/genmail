# Changelog

## Unreleased — Rust service candidate

- Implement the complete Rust storage/API/provider/AI/calendar/background/search/update service with compatible encryption, retained recovery records, verified migration backups and one database writer.
- Add bounded mail pages, six locale-aware sorts, body-on-demand loading and revision refresh in SwiftUI and React; preserve owner identity and manually unread messages.
- Add explicit Rust desktop builds, native integration, isolated TLS protocol/provider fixtures, signed-upgrade checks, dependency audit/notices and 1k/10k/50k benchmarks. Default production selection remains Node until release gates and explicit cutover approval; Windows remains Electron.

## 0.5.0-beta.2 — 2026-09-24

- In-app download, verified installation and automatic restart on macOS and Windows, with unsaved-edit/write guards.
- Pinned Ed25519 update manifests, exact platform/version/size and SHA-256 checks, archive path validation and macOS compatibility checks.
- Retains the previous app and restores it on failed replacement or immediate launch errors; mailbox data remains separate.
- Requires one manual installation to enable future in-app updates. Read-only installation folders retain manual downloads; no unattended installation or privilege elevation.

## 0.5.0-beta.1 — 2026-09-24

- Built-in Google Desktop OAuth for Gmail and Google Calendar in both desktop packages, with an advanced custom-client option. Microsoft still requires a client ID.
- Explicit browser sign-in buttons and advanced callback details; native callback refresh selects the newly connected mailbox, and Windows refreshes connections on return when no edits are pending.
- Paired beta publishing with matching version guards, draft-first publication and both platform checks required before downloads become public.
- Google Cloud Testing restrictions and verification still apply. The beta remains ad-hoc signed/unnotarized on macOS and unsigned on Windows; live-account and native Settings GUI acceptance are still incomplete.

## 0.5.0-alpha.1 — 2026-09-24

- GitHub update checks, opt-in arrival/open/reply AI triggers, daily/interval P0–P4 summaries, and separate response and translation languages.
- Checkpointed 1/3/6/12-month Inbox/Sent imports with pause/resume and no AI calls during download.
- Per-account writing-style previews, bounded model analysis, explicit approval, and optional weekly incremental proposals.
- Fixed IMAP Settings rendering and preserved Sent-copy identity and retry records.

## 0.4.0-alpha.1 — 2026-09-23

- Windows x64 desktop app with an isolated Electron renderer and bundled private service.
- Paired macOS/Windows builds, checksums and gated releases from one version tag.
- Windows keyboard shortcuts, remembered window size, persistent disclosure and calendar recovery.

- Independently collapsible account groups in native and web sidebars, with saved disclosure states.
- Account-owned replies across combined inbox, AI and keyboard paths; sent-message replies target original recipients.
- Plain-text/HTML footer settings and previews, separate draft snapshots, and safe multipart delivery through all mail transports.
- Scrollable native composer with fixed actions, clearer recipient labels and locked From identity, and filter recovery.
- Native inbox and reply screenshots, clearer README presentation, and repository discovery metadata.

## 0.3.0-alpha.1 — 2026-09-23

- First public Morrow Mail alpha: native SwiftUI macOS app, original icon, MIT license.
- Multiple Gmail, Outlook and IMAP/SMTP accounts, combined and separate inbox views.
- Compact, comfortable and spacious inbox rows; six persisted sort modes.
- Multiple To, Cc and Bcc recipients; reviewed sending and durable uncertain-send recovery.
- Explicit reviewed Gmail label and Outlook/IMAP folder operations.
- Native keyboard commands, standard window controls, size presets and restored size.
- Independent Google and Outlook calendars, custom AI endpoint/model/key, and 19 scoped AI behaviors.
- GitHub Sponsors and Buy Me a Coffee links.

Alpha limitations: ad-hoc signed/unnotarized Apple silicon build; latest-50 Inbox sync;
plain-text mail without attachments; 11 AI behaviors are labeled local simulations;
one calendar connection per provider; live-account acceptance remains pending.
