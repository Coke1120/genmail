// Invoked only after every platform job passes. Failed uploads leave a draft.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const { version } = JSON.parse(readFileSync('package.json'));
const tag = process.env.GITHUB_REF_NAME;
if (tag !== `v${version}` || !/^\d+\.\d+\.\d+-alpha\.\d+$/.test(version)) throw new Error('Unsigned releases require an alpha tag exactly matching package.json.');
const directory = 'release-artifacts';
const platforms = ['macos-arm64', 'windows-x64'];
const expected = platforms.flatMap(platform => [`Morrow-Mail-${version}-${platform}.zip`, `SHA256SUMS-${platform}.txt`]);
if (readdirSync(directory).sort().join('\n') !== [...expected].sort().join('\n')) throw new Error('Both platform archives and checksums are required.');
for (const platform of platforms) {
  const name = `Morrow-Mail-${version}-${platform}.zip`;
  const checksum = readFileSync(join(directory, `SHA256SUMS-${platform}.txt`), 'utf8');
  if (checksum !== `${createHash('sha256').update(readFileSync(join(directory, name))).digest('hex')}  ${name}\n`) throw new Error(`Checksum mismatch: ${platform}`);
}
const notes = `Morrow Mail ${version}\n\nBoth packages are built from the same Git tag and share the same mail, AI and calendar backend.\n\n- **macOS (Apple silicon, macOS 13.5+):** fully native SwiftUI interface. Extract and move Morrow Mail.app to Applications. Ad-hoc signed; **not Apple notarized**.\n- **Windows (x64, Windows 10/11):** React interface in an isolated Electron desktop window. Extract the entire folder and run Morrow Mail.exe. **Unsigned alpha**; Windows may show a SmartScreen warning.\n- Both include their runtimes; no Node installation is needed. Compare the supplied SHA-256 checksum before opening.\n\nExperimental alpha: live Gmail/Outlook/IMAP/calendar acceptance, Windows manual UI acceptance, and stable distribution signing remain pending. Provider checks use isolated fixtures; no real mail or calendar invitations were sent. Latest-50 Inbox sync, no attachments, and 11 simulated AI behaviors remain explicit limitations. macOS and Windows share feature APIs; their interfaces and platform-specific controls differ. See README.md, FEATURE_COVERAGE.md and VERIFICATION.md in the tagged source.\n\nSupport development: https://github.com/sponsors/Coke1120 · https://buymeacoffee.com/Coke1120\n`;
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
