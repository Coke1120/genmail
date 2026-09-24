import { readFileSync, writeFileSync, existsSync, renameSync, lstatSync, realpathSync, readdirSync } from 'node:fs';
import { resolve, join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { verifyManifest, hashFile } from './update-trust.js';
const exec = promisify(execFile);
let parentsExited = false;

export function packagePaths(target, platform) {
  return platform === 'macos-arm64'
    ? { backend: join(target, 'Contents/Resources/backend'), executable: join(target, 'Contents/MacOS/MorrowMail') }
    : { backend: join(target, 'resources/app/backend'), executable: join(target, 'Morrow Mail.exe') };
}
export async function validatePackage(target, platform, version) {
  const { backend, executable } = packagePaths(target, platform);
  if (lstatSync(target).isSymbolicLink() || !lstatSync(executable).isFile() || JSON.parse(readFileSync(join(backend, 'package.json'))).version !== version) throw new Error('The downloaded app is incomplete or has the wrong version.');
  const root = realpathSync(target);
  const visit = path => { for (const item of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, item.name), actual = realpathSync(child);
    if (actual !== root && !actual.startsWith(root + sep)) throw new Error('The update contains an unsafe link.');
    if (item.isDirectory()) visit(child);
  } };
  visit(target);
  if (platform === 'macos-arm64') {
    await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', target], { timeout: 60000 });
    const minimum = (await exec('/usr/bin/plutil', ['-extract', 'LSMinimumSystemVersion', 'raw', '-o', '-', join(target, 'Contents/Info.plist')])).stdout.trim();
    const current = (await exec('/usr/bin/sw_vers', ['-productVersion'])).stdout.trim();
    const wanted = minimum.split('.').map(Number), actual = current.split('.').map(Number);
    const difference = [0, 1, 2].map(index => (wanted[index] || 0) - (actual[index] || 0)).find(value => value !== 0) || 0;
    if (!/^\d+(?:\.\d+){0,2}$/.test(minimum) || difference > 0) throw new Error('The update requires a newer macOS version.');
  }
}
export async function replaceAndLaunch(config, launch) {
  const { target, staged, backup } = config;
  if (dirname(target) !== dirname(config.directory) || staged !== join(config.directory, 'extracted', config.root) || backup !== join(config.directory, 'previous')) throw new Error('Invalid update installation paths.');
  if (existsSync(backup)) throw new Error('The previous app backup already exists.');
  renameSync(target, backup);
  try {
    renameSync(staged, target);
    await launch(target);
  } catch (error) {
    if (existsSync(target)) renameSync(target, staged);
    renameSync(backup, target);
    throw error;
  }
}
async function run(config) {
  const { directory, platform, version, target, installedVersion } = config;
  const bytes = readFileSync(join(directory, 'update-manifest.json')), signature = readFileSync(join(directory, 'update-manifest.sig'), 'utf8');
  const manifest = verifyManifest(bytes, signature, version);
  if (await hashFile(join(directory, 'update.zip')) !== manifest.platforms[platform].sha256) throw new Error('The staged update changed.');
  process.stdout.write('ready\n');
  // Do not replace an app while either its UI or private service is still alive.
  const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
  const deadline = Date.now() + 100000;
  while (config.pids.some(alive)) { if (Date.now() > deadline) throw new Error('The app did not close; no update was installed.'); await delay(250); }
  parentsExited = true;
  const oldPackage = packagePaths(target, platform);
  if (JSON.parse(readFileSync(join(oldPackage.backend, 'package.json'))).version !== installedVersion) throw new Error('The installed app changed. Download the update again.');
  await validatePackage(config.staged, platform, version);
  await replaceAndLaunch(config, path => launchApp(path, platform));
}
async function launchApp(path, platform) {
  if (platform === 'macos-arm64') await exec('/usr/bin/open', ['-n', path], { timeout: 20000 });
  else await new Promise((accept, reject) => { const child = spawn(packagePaths(path, platform).executable, [], { detached: true, stdio: 'ignore', cwd: path, env: cleanEnvironment() }); child.once('error', reject); child.once('spawn', () => { child.unref(); accept(); }); });
}
export function cleanEnvironment() {
  const env = { ...process.env }; delete env.NODE_OPTIONS; delete env.NODE_PATH; delete env.ELECTRON_RUN_AS_NODE; return env;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let config;
  try {
    config = JSON.parse(readFileSync(0, 'utf8'));
    if (!Array.isArray(config.pids) || config.pids.length !== 2 || config.pids.some(pid => !Number.isSafeInteger(pid) || pid <= 1)) throw new Error('Invalid update owner.');
    await run(config);
    writeFileSync(config.resultFile, JSON.stringify({ status: 'installed', version: config.version }), { mode: 0o600 });
  } catch (error) {
    try { if (config?.resultFile) writeFileSync(config.resultFile, JSON.stringify({ status: 'error', reason: String(error.message).slice(0, 1024) }), { mode: 0o600 }); } catch {}
    if (parentsExited && config?.target && existsSync(config.target)) { try { await launchApp(config.target, config.platform); } catch {} }
    process.exitCode = 1;
  }
}
