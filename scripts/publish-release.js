// Invoked only after every platform job passes. Failed uploads leave a draft.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
const notes = `Morrow Mail ${version}

Both packages are built from the same Git tag and share the same mail, AI and calendar backend.

What changed since 0.5.0-alpha.1:
- Built-in Google Desktop OAuth for Gmail and Google Calendar on both platforms. Click Sign in with Google; users no longer need to enter a client ID or secret. Advanced settings still support a custom Google client. Outlook still requires a Microsoft client ID.
- Clear browser sign-in buttons and advanced callback details. Native macOS refresh now selects the mailbox connected through the browser; Windows refreshes connections when returning to Settings without unsaved edits.
- Paired beta publishing and alpha-to-beta update checks, retaining draft-first publication, SHA-256 verification and the ban on replacing public binaries.

Google setup:
- Google Cloud API enablement, test-user access and app verification remain publisher responsibilities. While the project is in Testing, only approved test users can sign in and grants can expire after seven days. The bundled registration does not remove those restrictions.
- Desktop client settings are extractable from the installed app. No user tokens or raw downloaded credential file are included in source control. Users authorize their own account in the browser.

Packages:
- **macOS (Apple silicon, macOS 13.5+):** fully native SwiftUI interface. Extract and move Morrow Mail.app to Applications. Ad-hoc signed; **not Apple notarized**.
- **Windows (x64, Windows 10/11):** React interface in an isolated Electron desktop window. Extract the entire folder and run Morrow Mail.exe. **Unsigned prerelease**; Windows may show a SmartScreen warning.
- Both include their runtimes; no Node installation is needed. Compare the supplied SHA-256 checksum before opening.

Beta limitations:
Live Gmail/Outlook/IMAP/calendar acceptance, Windows manual UI acceptance, and stable distribution signing remain pending. Provider checks use isolated fixtures; no real mail or calendar invitations were sent. Historical import is paged, but periodic refresh still fetches the latest 50 messages per selected folder. Large-cache UI pagination/full delta sync, attachments, app-wide AI spending caps and delayed/undo sending are not included. The 11 Studio simulation workflows remain labeled; the separate style-learning flow uses the configured model. Style quote/signature cleanup and token estimates are heuristic. Native Settings GUI automation was blocked by the UI tool; native compilation and API integration are verified by CI. macOS and Windows share feature APIs; their interfaces and platform-specific controls differ. The beta label does not establish production readiness. See README.md, FEATURE_COVERAGE.md and VERIFICATION.md in the tagged source.

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
