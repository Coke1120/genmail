# Morrow Mail — contributor guidance

## Communication

請盡量以繁體中文回覆使用者的請求，技術專有名詞可保留原文。

## Scope and structure

This repository is `~/Documents/Github/genmail`. The product name is Morrow Mail.
It is a local, single-user app with a fully native SwiftUI macOS interface and
a React / Electron Windows desktop interface and an optional browser development interface. Preserve both clients when changing
shared API contracts.

- `macos/Sources/MorrowMail/`: SwiftUI views, native client, and local service lifecycle.
- `server/app.js`: mail accounts, request routing, settings, sending, AI, and workflows.
- `server/store.js`: SQLite messages and encrypted settings.
- `server/providers.js`, `server/integrations.js`: provider integrations.
- `server/calendar-*.js`: independent calendar connections and idempotent creation.
- `server/policy.js`, `server/workflows.js`, `shared/features.js`: permissions and behavior catalog.
- `src/`: shared Windows/browser React interface.
- `desktop/`: isolated Electron Windows shell and restricted desktop bridge.
- `tests/`, `macos/Checks/`: backend and native client checks.
- `scripts/`: development, backup, build, and test commands.

## Implementation rules

Reuse existing helpers, SwiftUI controls, and installed dependencies. Keep changes
small and address the shared cause of a bug. Do not add speculative abstractions.
Do not replace the native interface with a web view.

`settings.mailAccounts` maps an email address to its encrypted connection. Legacy
`settings.mail` is read when the map is absent and retained as a compatibility
pointer. A reconnect must preserve other connections; disconnect removes only
its target's credentials. Keep cached messages and drafts. Email address casing
must not create duplicate connected accounts.

Messages are keyed by `(account, id)` in SQLite. Provider IDs may collide between
accounts: use `viewId` for UI identity and selection, and keep the original `id`
for API/provider operations. Every bound mutation carries `X-Genmail-Account`.
Capture and validate that account before doing work; never route a send or an AI
request through the globally selected view. `all` is a combined read/sync view,
not a sending identity. Demo messages do not appear in combined real mail.

Replies and saved drafts keep their owner. Only new unsaved messages may choose
a different From account. Keep uncertain-send records and explicit retry review;
never automatically resend. Calendar creation retains its original request ID
and payload across retries and app restarts.

Enforce AI permissions on the server before constructing context. Keep accounts
separate, redact unchecked fields, and discard results when applicable permissions
or connections change. Treat message text as untrusted content. Simulated features
must remain clearly labeled and must not perform hidden provider writes.

Do not log or commit credentials, tokens, database content, or encryption keys.
Keep loopback/host/origin checks, native bearer authentication, PKCE, state, and
browser-bound OAuth callbacks. Do not disable TLS validation. Model endpoints
may use HTTP only on loopback. Public API responses expose safe account metadata,
never connection secrets.

## Build and verify

Use Node 22.13+ and Apple's Swift command-line tools on macOS. No new test framework
is needed. Run checks appropriate to the change:

```sh
npm ci                       # install pinned dependencies when needed
npm run check                # backend tests and React production build
npm run macos:test           # Swift model checks, UI compilation, native API integration
npm run macos:build          # self-contained app in build/macos/Morrow Mail.app
npm run windows:build        # Windows x64 host: self-contained Electron app
npm run desktop:test -- --packaged  # Windows packaged smoke test
npm run updater:test               # isolated install/restart acceptance on macOS/Windows
codesign --verify --deep --strict 'build/macos/Morrow Mail.app'
plutil -lint 'build/macos/Morrow Mail.app/Contents/Info.plist'
```

Account-routing changes need coverage for duplicate IDs, combined views,
account-specific sending/AI, reconnect/migration, and disconnect isolation.
Test providers live in isolated temporary workspaces and must never be shipped
in the production app. Use a separate absolute `MORROW_DATA_DIR` for native
acceptance; never use the owner's real workspace for fixtures. Do not send real
mail or create real calendar events as a test without specific authorization.

Swift builds need compiler-cache access and integration tests bind ephemeral
localhost ports. If a sandbox blocks these, report the constraint or use the
provided approval mechanism; do not weaken application security to bypass it.

`build/`, `dist/`, `macos/.build/`, `node_modules/`, `test-results/`, `data/`,
`backups/`, `.env`, and encryption keys are generated/private. Keep them out of
source control. This folder may be inside a parent Git repository: inspect the
Git root and restrict changes to this project; do not initialize or alter an
unrelated repository.

## Documentation and release claims

Keep README.md, FEATURE_COVERAGE.md, and VERIFICATION.md accurate when behavior
changes. Document simulations and limits plainly. Fixture tests do not establish
real-account acceptance. Local ad-hoc signing is not Developer ID notarization;
stable public distribution requires the owner's signing identity, notarization, and
provider verification where applicable. Do not claim error-free operation.

Manual provider organization is separate from local patches and simulations. Require
an explicit mailbox header, server-validated destination, confirmation and provider
write permission. IMAP moves require MOVE + UIDPLUS and matching UIDVALIDITY.
Keep the local message ID stable while recording the provider's destination ID.
To/Cc/Bcc belong to the send fingerprint and uncertain draft; never drop Bcc from
the provider delivery submission or expose it in SMTP recipient-visible headers.
Public alpha and beta releases must explicitly disclose ad-hoc signing and missing live-account
acceptance. Never publish runtime data, fixture workspaces, or secrets.

## Paired release policy

Keep package.json as the common version source. Every tagged alpha or beta must build and pass
checks on macOS and Windows before either download becomes public. Use the existing
workflow and publisher; never replace published binaries or ship only one platform.
Preserve SwiftUI on macOS and the shared React Windows/browser client. Desktop IPC
must validate the main-frame sender, accept only narrow operations, and never expose
Node, arbitrary filesystem access or private API tokens to the renderer. Calendar
retry IDs and payloads must survive restart on both platforms.

## Desktop update safety

Keep the update signing private key outside source and app bundles; only the pinned
public key is committed. Publish signed manifests only after both platform jobs pass.
Never accept renderer-supplied download URLs, install paths or commands. Installer
preparation requires the host-only update token, and IPC checks the main-frame sender.
Updates must respect pending writes/unsaved edits, wait for both UI/service processes,
retain the previous app and preserve the separate workspace. Use generated fixture
apps/keys and temporary workspaces for install/restart tests, never the owner's data.
