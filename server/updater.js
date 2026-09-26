import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, realpathSync, createWriteStream } from 'node:fs';
import { join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { checkUpdates, currentVersion } from './updates.js';
import { verifyManifest, hashFile, inspectArchive } from './update-trust.js';
import { validatePackage, cleanEnvironment } from './update-installer.js';
const exec = promisify(execFile);
const source = dirname(fileURLToPath(import.meta.url));
const fail = message => { throw Object.assign(new Error(message), { status: 409 }); };

export async function releaseAsset(url, { signal, fetchImpl = fetch } = {}) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash || !['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(parsed.hostname) || (parsed.port && parsed.port !== '443')) throw new Error('Untrusted update download destination.');
    const response = await fetchImpl(url, { signal, redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(response.status)) { await response.body?.cancel(); url = new URL(response.headers.get('location'), url).href; continue; }
    if (!response.ok || !response.body) throw new Error('The update files are not available. Use the release downloads or try again later.');
    return response;
  }
  throw new Error('Too many update download redirects.');
}
async function smallAsset(url, limit, signal) {
  const response = await releaseAsset(url, { signal });
  const chunks = []; let length = 0;
  for await (const chunk of response.body) { length += chunk.length; if (length > limit) throw new Error('The update metadata is too large.'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
export function createUpdater({ dataDirectory, parentPID, updateToken }) {
  const platform = process.platform === 'darwin' && process.arch === 'arm64' ? 'macos-arm64' : process.platform === 'win32' && process.arch === 'x64' ? 'windows-x64' : null;
  const target = resolve(source, '../../../..');
  const expected = platform === 'macos-arm64' ? join(target, 'Contents/Resources/backend/server') : join(target, 'resources/app/backend/server');
  const resultFile = join(dataDirectory, 'update-result.json');
  const actualData = realpathSync(dataDirectory).toLowerCase(), actualTarget = realpathSync(target).toLowerCase();
  const supported = !!platform && expected === source && Number.isSafeInteger(parentPID) && parentPID > 1 && /^[a-f0-9]{64}$/.test(updateToken || '') && actualData !== actualTarget && !actualData.startsWith(actualTarget + sep);
  let state = { supported, phase: 'idle', received: 0, total: 0 }, controller, job, directory, staged, version, root, preparing = false;
  const status = () => {
    let previous;
    try { const item = JSON.parse(readFileSync(resultFile)); if (item.status === 'installed' && typeof item.version === 'string') previous = `Updated to ${item.version}.`; else if (item.status === 'error') previous = 'The last update did not complete. Your previous app was retained; try again or use the release downloads.'; } catch {}
    return { ...state, ...(previous ? { previous } : {}) };
  };
  const cleanup = () => { if (directory) rmSync(directory, { recursive: true, force: true, maxRetries: 3 }); directory = undefined; };
  async function download(includePrereleases) {
    try {
      const latest = await checkUpdates({ includePrereleases });
      if (!latest.updateAvailable) throw new Error('No newer release is available for this channel.');
      version = latest.latestVersion;
      const base = `https://github.com/Coke1120/Morrow-Mail/releases/download/v${encodeURIComponent(version)}/`;
      const bytes = await smallAsset(base + 'update-manifest.json', 16384, controller.signal);
      const signature = (await smallAsset(base + 'update-manifest.sig', 256, controller.signal)).toString();
      const manifest = verifyManifest(bytes, signature, version), asset = manifest.platforms[platform];
      cleanup();
      try { directory = mkdtempSync(join(dirname(target), '.morrow-update-')); }
      catch { throw new Error('This installation folder is not writable. Use the manual release download to update this copy.'); }
      writeFileSync(join(directory, 'update-manifest.json'), bytes, { mode: 0o600 });
      writeFileSync(join(directory, 'update-manifest.sig'), signature, { mode: 0o600 });
      state = { supported, phase: 'downloading', version, received: 0, total: asset.size };
      const response = await releaseAsset(base + asset.name, { signal: controller.signal });
      const path = join(directory, 'update.zip');
      await pipeline(Readable.fromWeb(response.body), async function* (chunks) {
        for await (const chunk of chunks) {
          state.received += chunk.length;
          if (state.received > asset.size) throw new Error('The update download exceeds its signed size.');
          yield chunk;
        }
      }, createWriteStream(path, { flags: 'wx', mode: 0o600 }), { signal: controller.signal });
      if (state.received !== asset.size || await hashFile(path) !== asset.sha256) throw new Error('The update checksum does not match. No app files were changed.');
      state.phase = 'verifying';
      root = platform === 'macos-arm64' ? 'Morrow Mail.app' : 'Morrow Mail-win32-x64';
      inspectArchive(path, root);
      const extraction = join(directory, 'extracted'); mkdirSync(extraction);
      if (platform === 'macos-arm64') await exec('/usr/bin/ditto', ['-x', '-k', path, extraction], { timeout: 120000, signal: controller.signal });
      else {
        const command = "$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath $env:MORROW_UPDATE_ZIP -DestinationPath $env:MORROW_UPDATE_DEST";
        await exec(join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { env: { ...cleanEnvironment(), MORROW_UPDATE_ZIP: path, MORROW_UPDATE_DEST: extraction }, windowsHide: true, timeout: 120000, signal: controller.signal });
      }
      staged = join(extraction, root);
      await validatePackage(staged, platform, version);
      if (controller.signal.aborted) throw new Error('Cancelled');
      state.phase = 'ready';
    } catch (error) {
      const cancelled = controller.signal.aborted;
      try { cleanup(); } catch {}
      state = { supported, phase: cancelled ? 'idle' : 'error', received: 0, total: 0, ...(cancelled ? {} : { error: error.message?.startsWith('The update') || error.message?.startsWith('This installation') || error.message?.startsWith('No newer') ? error.message : 'Could not download or verify the update. No app files were changed. Try again or use the release downloads.' }) };
    } finally { controller = undefined; }
  }
  return {
    status,
    start(includePrereleases) {
      if (!supported) fail('In-app installation is available only in packaged desktop builds.');
      if (typeof includePrereleases !== 'boolean') fail('Choose a valid update channel.');
      if (controller || preparing || state.phase === 'installing') fail('An update operation is already running.');
      controller = new AbortController(); state = { supported, phase: 'checking', received: 0, total: 0 };
      const timeout = setTimeout(() => controller?.abort(), 15 * 60 * 1000); timeout.unref();
      job = download(includePrereleases).finally(() => clearTimeout(timeout));
      return status();
    },
    cancel() { if (preparing || state.phase === 'installing') fail('The app is restarting to install the update.'); if (controller) controller.abort(); else { cleanup(); state = { supported, phase: 'idle', received: 0, total: 0 }; } return status(); },
    async prepare() {
      if (!supported || state.phase !== 'ready' || preparing) fail('Download and verify an update before installing it.');
      preparing = true;
      try {
        const node = join(directory, process.platform === 'win32' ? 'node.exe' : 'node');
        cpSync(realpathSync(process.execPath), node);
        for (const file of ['update-installer.js', 'update-trust.js', 'update-public-key.pem']) cpSync(join(source, file), join(directory, file));
        writeFileSync(join(directory, 'package.json'), '{"type":"module"}', { mode: 0o600 });
        const config = { directory, root, platform, target, staged, backup: join(directory, 'previous'), version, installedVersion: currentVersion, pids: [parentPID, process.pid], resultFile };
        const helper = spawn(node, [join(directory, 'update-installer.js')], { cwd: directory, env: cleanEnvironment(), detached: true, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
        helper.stdin.on('error', () => {});
        await new Promise((accept, reject) => {
          const lines = createInterface({ input: helper.stdout });
          const timer = setTimeout(() => { helper.kill(); reject(new Error('The update installer did not become ready.')); }, 15000);
          const failed = () => { clearTimeout(timer); reject(new Error('The update installer could not start.')); };
          helper.once('error', failed); helper.once('exit', failed);
          lines.once('line', line => { clearTimeout(timer); helper.removeListener('exit', failed); lines.close(); line === 'ready' ? accept() : reject(new Error('Invalid update installer response.')); });
          helper.stdin.end(JSON.stringify(config));
        });
        helper.stdout.destroy(); helper.unref();
        state.phase = 'installing';
        return status();
      } finally { preparing = false; }
    },
    async stop() { controller?.abort(); await job; if (!preparing && state.phase !== 'installing') { try { cleanup(); } catch {} } },
  };
}
