// Invoked only after every platform job passes. Failed uploads leave a draft.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash, sign } from 'node:crypto';
import { verifyManifest } from '../server/update-trust.js';
import { join } from 'node:path';
const { version } = JSON.parse(readFileSync('package.json'));
const tag = process.env.GITHUB_REF_NAME;
if (tag !== `v${version}` || !/^\d+\.\d+\.\d+-(?:alpha|beta)\.\d+$/.test(version)) throw new Error('Unsigned releases require an alpha or beta tag exactly matching package.json.');
const directory = 'release-artifacts';
const platforms = ['macos-arm64', 'windows-x64'];
const expected = platforms.flatMap(platform => [`Morrow-Mail-${version}-${platform}.zip`, `SHA256SUMS-${platform}.txt`]);
if (readdirSync(directory).sort().join('\n') !== [...expected].sort().join('\n')) throw new Error('Both platform archives and checksums are required.');
for (const platform of platforms) {
  const name = `Morrow-Mail-${version}-${platform}.zip`;
  const checksum = readFileSync(join(directory, `SHA256SUMS-${platform}.txt`), 'utf8');
  if (checksum !== `${createHash('sha256').update(readFileSync(join(directory, name))).digest('hex')}  ${name}\n`) throw new Error(`Checksum mismatch: ${platform}`);
}
if (!process.env.MORROW_UPDATE_SIGNING_KEY) throw new Error('The update signing key is required before publishing.');
const manifest = Buffer.from(JSON.stringify({ version, platforms: Object.fromEntries(platforms.map(platform => {
  const name = `Morrow-Mail-${version}-${platform}.zip`, bytes = readFileSync(join(directory, name));
  return [platform, { name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }];
})) }));
const signature = sign(null, manifest, process.env.MORROW_UPDATE_SIGNING_KEY).toString('base64');
verifyManifest(manifest, signature, version);
writeFileSync(join(directory, 'update-manifest.json'), manifest);
writeFileSync(join(directory, 'update-manifest.sig'), signature);
expected.push('update-manifest.json', 'update-manifest.sig');
const notes = `Morrow Mail ${version}

Safer formatted mail, broader Gmail coverage and clearer desktop controls. Both packages are built from this same Git tag and pass the paired checks before publication.

What changed since 0.6.0-beta.4:
- Read sanitized HTML mail with links and optional HTTPS images. Scripts, forms and embedded pages are blocked; images require per-message consent. Existing cached messages need refetching for HTML. Attachment/CID images are not included.
- Choose a right, bottom or focused reading layout, expand the reader, and keep your inbox page/selection when reading. Senders align left; unread dots align right and only unread previews are bold. On macOS, closing the window keeps Morrow in the Dock; reopening retains your work and quitting still guards edits/writes.
- Reply All and Forward retain the message's owning account. Demo is hidden from the interface. Imported Gmail drafts open as new local copies, preserving recipients without changing the provider original.
- Gmail refresh checks Inbox, Sent, Drafts, Starred and All Mail, up to 50 messages per scope. Date-bounded All Mail history includes archived messages and user labels, excluding Spam/Trash. Provider metadata refresh preserves explicit local changes.
- Reviewed provider moves support Gmail Spam and Outlook Junk; phishing reports and sender blocking remain provider-site actions. Mail and AI activity show fetching, checkpointed imports, queued/running work and safe errors.
- Temporary read-only history fetch failures retry at most three times with persisted progress. Authentication, invalid cursors/pages and database failures need explicit recovery; older unexplained failed imports can be resumed manually.
- General preferences auto-save with visible progress and retry on failure. Embedding settings move to Model with a fixed-input Test Connection; Index Now prepares a scope/budget review. Learn Now creates a proposal, and Save Approved Style separately activates it without overwriting manual Email Brain memory.
- Fix update checks/downloads and product links for the renamed repository without relaxing trust checks. The unpublished beta.5 candidate was cancelled before release.
- Update contributor guidance and user documentation. Rust remains the desktop backend, with the existing agent CLI, built-in OAuth and signed workspace-preserving updater.

CLI quick start:
- macOS: '/Applications/Morrow Mail.app/Contents/Resources/morrow-service' cli --help
- Windows PowerShell, from the extracted app folder: & '.\\resources\\app\\runtime\\morrow-service.exe' cli --help
- Usage, JSON contracts, review/send examples and limits: https://github.com/Coke1120/Morrow-Mail/blob/v${version}/docs/CLI.md
- Configure accounts in the app first. External agents with workspace access are not restricted by the in-app AI context checkboxes; trust the agent and authorize each delivery. No CLI attachments, account setup, implicit sync or automatic retries.

Updating:
- **One-time manual update from beta.4 and earlier:** the GitHub repository was renamed to Coke1120/Morrow-Mail. Older update checks reject its API redirect; download and install this package manually. This release uses the canonical address for future in-app updates, with signature and redirect protections unchanged.
- Keep a verified workspace backup and close the old app before opening the new one. The workspace stays separate from the app; binary rollback never silently restores an older database over current data.
- The signed manifest, pinned Ed25519 key, exact platform/version checks and SHA-256 validation remain unchanged. Read-only installation directories retain the manual-download option.

OAuth setup:
- Built-in Google Desktop OAuth remains available for Gmail and Google Calendar. Google Cloud API enablement, test-user access and provider verification remain publisher responsibilities; bundling the registration does not remove Testing restrictions.
- Outlook mail and Calendar use the bundled public Microsoft desktop registration by default; no user-supplied client ID, JSON or secret is required. Custom registrations remain available under Advanced. Organization policies may require administrator approval. Live Microsoft consent and Entra registration acceptance remain unverified; fixture checks do not establish provider approval.
- Bundled desktop app identifiers are extractable and are not user credentials. No mailbox tokens or private update signing key are shipped.

Packages:
- **macOS (Apple silicon, macOS 13.5+):** extract and move Morrow Mail.app to Applications. Fully native SwiftUI; ad-hoc signed and **not Apple notarized**.
- **Windows (x64, Windows 10/11):** extract the entire folder and run Morrow Mail.exe. Isolated Electron renderer; **unsigned prerelease**, which may show a SmartScreen warning.
- Both include their runtime. No Node or Rust installation is needed. Compare the supplied SHA-256 checksum before opening.

Beta limitations:
Live-account/provider acceptance, minimum-OS and other-hardware acceptance, complete manual UI/IME/accessibility testing and stable distribution signing remain pending. Native API, WebKit isolation and window lifecycle checks passed locally; browser fixture walkthroughs are not full native visual or live-account acceptance. The browser automation connection failed during an external-link confirmation check; protocol/sandbox tests passed, but that interactive step is not claimed. Provider/model tests used isolated fixtures without real sends, invitations or paid inference. Full provider delta/deletion sync, attachments, phishing/malware verdicts, sender blocking, app-wide AI spending caps and delayed/undo sending are not included. Studio simulations remain clearly labeled. Windows Tauri is not part of this release. This beta does not establish stable production readiness; see the tagged README.md, FEATURE_COVERAGE.md and VERIFICATION.md.

Support development: https://github.com/sponsors/Coke1120 · https://buymeacoffee.com/Coke1120
`;
writeFileSync('release-notes.md', notes);
const gh = args => execFileSync('gh', args, { encoding: 'utf8' });
const releases = JSON.parse(gh(['api', `repos/${process.env.GITHUB_REPOSITORY}/releases?per_page=100`]));
const existing = releases.find(release => release.tag_name === tag);
if (existing && !existing.draft) throw new Error('This release is already published; never replace public artifacts.');
if (!existing) gh(['release', 'create', tag, '--verify-tag', '--draft', '--prerelease', '--title', `Morrow Mail ${version}`, '--notes-file', 'release-notes.md']);
gh(['release', 'upload', tag, ...expected.map(file => join(directory, file)), '--clobber']);
const release = JSON.parse(gh(['release', 'view', tag, '--json', 'assets,isDraft']));
if (!release.isDraft || release.assets.map(asset => asset.name).sort().join('\n') !== [...expected].sort().join('\n')) throw new Error('Release asset verification failed; kept as a draft.');
gh(['release', 'edit', tag, '--draft=false', '--prerelease', '--notes-file', 'release-notes.md']);
console.log(`Published ${tag} with both platforms.`);
