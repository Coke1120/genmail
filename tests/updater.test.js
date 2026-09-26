import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyManifest, inspectArchive } from '../server/update-trust.js';
import { replaceAndLaunch } from '../server/update-installer.js';
import { releaseAsset, createUpdater } from '../server/updater.js';

test('updates require the pinned signature, exact version/platform/size and safe HTTPS redirects', async t => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const version = '0.5.0-beta.2';
  const value = { version, platforms: Object.fromEntries(['macos-arm64','windows-x64'].map(platform => [platform, { name: `Morrow-Mail-${version}-${platform}.zip`, size: 10, sha256: 'a'.repeat(64) }])) };
  const bytes = Buffer.from(JSON.stringify(value)), signature = sign(null, bytes, privateKey).toString('base64');
  assert.equal(verifyManifest(bytes, signature, version, publicKey).version, version);
  assert.throws(() => verifyManifest(Buffer.from(JSON.stringify({ ...value, version: '0.6.0' })), signature, '0.6.0', publicKey));
  assert.throws(() => verifyManifest(bytes, signature, '0.5.0-beta.1', publicKey));
  assert.throws(() => verifyManifest(bytes, signature, version, generateKeyPairSync('ed25519').publicKey));
  for (const bad of [{ ...value, platforms: {} }, { ...value, platforms: { ...value.platforms, 'windows-x64': { ...value.platforms['windows-x64'], size: -1 } } }]) {
    const data = Buffer.from(JSON.stringify(bad));
    assert.throws(() => verifyManifest(data, sign(null, data, privateKey).toString('base64'), version, publicKey));
  }
  let requests = 0;
  await assert.rejects(releaseAsset('https://github.com/Coke1120/Morrow-Mail/releases/download/v1/test', { fetchImpl: async () => { requests++; return new Response(null, { status:302, headers:{location:'http://127.0.0.1/private'} }); } }), /Untrusted/);
  assert.equal(requests, 1);
  await assert.rejects(releaseAsset('https://untrusted.invalid/update', { fetchImpl: () => { throw Error('Must not fetch'); } }), /Untrusted/);
  const directory = mkdtempSync(join(tmpdir(), 'morrow-update-guards-'));
  t.after(() => rmSync(directory, { recursive:true, force:true }));
  const manager = createUpdater({dataDirectory:directory,parentPID:process.pid,updateToken:'a'.repeat(64)});
  assert.equal(manager.status().supported, false);
  assert.throws(() => manager.start(true), /packaged/);
  await assert.rejects(manager.prepare(), /Download and verify/);
});

function tinyZip(name, link = null) {
  const filename = Buffer.from(name), content = Buffer.from(link || 'ok');
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt32LE(content.length,18); local.writeUInt32LE(content.length,22); local.writeUInt16LE(filename.length,26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt32LE(content.length,20); central.writeUInt32LE(content.length,24); central.writeUInt16LE(filename.length,28); if (link) central.writeUInt32LE((0xa1ff << 16) >>> 0,38);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1,8); end.writeUInt16LE(1,10); end.writeUInt32LE(central.length+filename.length,12); end.writeUInt32LE(local.length+filename.length+content.length,16);
  return Buffer.concat([local,filename,content,central,filename,end]);
}
test('archive validation blocks traversal, outside symlinks and inconsistent ZIP names before extraction', t => {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-update-zip-')), zip = join(directory,'update.zip');
  t.after(() => rmSync(directory, {recursive:true,force:true}));
  writeFileSync(zip,tinyZip('Morrow Mail.app/Contents/example')); inspectArchive(zip,'Morrow Mail.app');
  for (const [name,link] of [['../outside'],['/absolute'],['Morrow Mail.app/../../outside'],['Morrow Mail.app/C:stream'],['Morrow Mail.app/Contents/link','../../../outside'],['Morrow Mail.app/link','/private']]) {
    writeFileSync(zip,tinyZip(name,link)); assert.throws(() => inspectArchive(zip,'Morrow Mail.app'));
  }
  const broken = tinyZip('Morrow Mail.app/Contents/example'); broken[30] = 88;
  writeFileSync(zip,broken); assert.throws(() => inspectArchive(zip,'Morrow Mail.app'), /Inconsistent/);
});

test('replacement retains a backup, relaunches the new app, and rolls back launch failures without touching user data', async t => {
  const root = mkdtempSync(join(tmpdir(),'morrow-update-swap-'));
  t.after(() => rmSync(root,{recursive:true,force:true}));
  const directory=join(root,'.morrow-update-test'), target=join(root,'current'), staged=join(directory,'extracted','app'), backup=join(directory,'previous');
  mkdirSync(target); mkdirSync(staged,{recursive:true});
  writeFileSync(join(target,'version'),'old'); writeFileSync(join(staged,'version'),'new'); writeFileSync(join(root,'user-data'),'mail-and-credentials');
  const config={directory,target,staged,backup,root:'app'};
  await assert.rejects(replaceAndLaunch(config,async()=>{throw Error('launch failed');}), /launch failed/);
  assert.equal(readFileSync(join(target,'version'),'utf8'),'old'); assert.equal(existsSync(backup),false);
  await replaceAndLaunch(config, async path => assert.equal(readFileSync(join(path,'version'),'utf8'),'new'));
  assert.equal(readFileSync(join(backup,'version'),'utf8'),'old');
  assert.equal(readFileSync(join(root,'user-data'),'utf8'),'mail-and-credentials');
});
