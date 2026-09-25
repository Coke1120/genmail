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

The first Rust-backend prerelease. Both packages are built from this same Git tag and pass the paired checks before publication.

What changed since 0.5.0-beta.2:
- Rust now owns the shared desktop mail, OAuth, calendar, AI/workflow/learning, background import, search, storage and signed-update service. macOS keeps its fully native SwiftUI interface; Windows keeps React/Electron. No separate Node backend runtime is bundled; Electron still contains its own Node runtime.
- Inbox pages contain bounded metadata with six locale-aware sorts, SQL counts, on-demand message bodies and revision refresh. Combined views retain mailbox ownership even when provider IDs collide.
- Full-text search adds Chinese traditional/simplified matching, operators and filters, saved searches, owner labels and 30-result pages. Optional semantic search uses explicitly reviewed, budgeted batches; changed permissions or connections invalidate results, and failed paid requests do not automatically retry.
- Migration preserves encrypted connections, cached messages, owner-bound drafts, exact To/Cc/Bcc send-review records and calendar retry IDs/payloads. First Rust takeover creates a verified backup and excludes a second database writer. Derived keyword indexes rebuild locally; legacy semantic vectors require a reviewed rebuild.
- Native online backup and bundled command-line backups preserve the workspace and recovery files. Existing Node installers were tested against actual Rust packages, including both-PID shutdown, real desktop restart and backup restoration on macOS and Windows.

Updating:
- Version 0.5.0-beta.2 can download this release through Settings > About > Check for updates. Save or discard edits before Install & Restart. Earlier versions can install the package manually.
- Keep a verified workspace backup and close the old app before opening the new one. The workspace stays separate from the app; binary rollback never silently restores an older database over current data.
- The signed manifest, pinned Ed25519 key, exact platform/version checks and SHA-256 validation remain unchanged. Read-only installation directories retain the manual-download option.

OAuth setup:
- Built-in Google Desktop OAuth remains available for Gmail and Google Calendar. Google Cloud API enablement, test-user access and provider verification remain publisher responsibilities; bundling the registration does not remove Testing restrictions.
- Outlook still requires an Application (client) ID from a Microsoft Entra Mobile and desktop app registration. No Google-style JSON or client secret is required. Mail and Calendar have separate localhost callback paths; see README.md.
- Bundled desktop app identifiers are extractable and are not user credentials. No mailbox tokens or private update signing key are shipped.

Packages:
- **macOS (Apple silicon, macOS 13.5+):** extract and move Morrow Mail.app to Applications. Fully native SwiftUI; ad-hoc signed and **not Apple notarized**.
- **Windows (x64, Windows 10/11):** extract the entire folder and run Morrow Mail.exe. Isolated Electron renderer; **unsigned prerelease**, which may show a SmartScreen warning.
- Both include their runtime. No Node or Rust installation is needed. Compare the supplied SHA-256 checksum before opening.

Beta limitations:
Live-account/provider acceptance, minimum-OS and other-hardware acceptance, complete manual UI/IME/accessibility testing and stable distribution signing remain pending. Native Settings walkthrough was blocked by the automation service crashing; automated native settings/backup checks passed, but are not a substitute for visual acceptance. Provider/model tests used isolated fixtures without real sends, invitations or paid inference. Periodic sync still fetches the latest 50 messages per selected folder; full provider delta sync, attachments, app-wide AI spending caps and delayed/undo sending are not included. Studio simulations remain clearly labeled. Windows Tauri is not part of this release. This beta does not establish stable production readiness; see the tagged README.md, FEATURE_COVERAGE.md and VERIFICATION.md.

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
