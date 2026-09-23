import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const { version } = JSON.parse(readFileSync('package.json'));
const platform = process.platform === 'darwin' ? `macos-${process.arch}` : process.platform === 'win32' ? `windows-${process.arch}` : null;
if (!platform) throw new Error('Package releases on macOS or Windows.');
const output = resolve('build/release');
mkdirSync(output, { recursive: true });
const filename = `Morrow-Mail-${version}-${platform}.zip`, archive = resolve(output, filename);
if (process.platform === 'darwin') execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', 'build/macos/Morrow Mail.app', archive], { stdio: 'inherit' });
else {
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const command = `$ErrorActionPreference='Stop'; Compress-Archive -Path ${quote(resolve('build/windows/Morrow Mail-win32-x64'))} -DestinationPath ${quote(archive)} -Force`;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { stdio: 'inherit' });
}
writeFileSync(resolve(output, `SHA256SUMS-${platform}.txt`), `${createHash('sha256').update(readFileSync(archive)).digest('hex')}  ${filename}\n`);
console.log(`Packaged ${filename} with its SHA-256 checksum.`);
