import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Worker } from 'node:worker_threads';
import { createStore } from '../server/store.js';
import { backupDatabase } from '../scripts/backup.js';

test('online backup restores matching credentials and transactional message state while another connection writes', async t => {
  const directory = mkdtempSync(`${tmpdir()}/morrow-backup-`), dataDir = `${directory}/data`, destination = `${directory}/snapshot`;
  const store = createStore(dataDir);
  const pendingCalendar = JSON.stringify({ id: 'stable-retry-id', title: 'Unconfirmed event' });
  writeFileSync(`${dataDir}/client-state.json`, JSON.stringify({ 'morrow.pendingCalendar': pendingCalendar }), { mode: 0o600 });
  writeFileSync(`${dataDir}/pending-calendar.json`, pendingCalendar, { mode: 0o600 });
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const mail = { email: 'saved@example.com', password: 'private-backup-password', refreshToken: 'private-refresh-token' };
  const message = { ...store.getMessage('demo', 'demo-1'), id: 'backup-marker', body: '0' };
  store.transaction(() => { store.setSettings({ mail, backupRevision: 0 }); store.upsertMessage(mail.email, message); });
  const shared = new SharedArrayBuffer(4), stop = new Int32Array(shared);
  const writer = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    (async () => {
      const { createStore } = await import(workerData.module);
      const store = createStore(workerData.dataDir), stop = new Int32Array(workerData.shared);
      try {
        for (let revision = 1; revision <= 100 && !Atomics.load(stop, 0); revision++) {
          store.transaction(() => {
            store.setSettings({ backupRevision: revision });
            store.updateMessage(workerData.account, 'backup-marker', { body: String(revision) });
          });
          if (revision === 1) parentPort.postMessage('writing');
          Atomics.wait(stop, 0, 0, 5);
        }
      } finally { store.close(); }
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `, { eval: true, workerData: { module: new URL('../server/store.js', import.meta.url).href, dataDir, shared, account: mail.email } });
  const finished = new Promise(resolve => writer.once('exit', resolve));
  try {
    await new Promise((resolve, reject) => { writer.once('message', resolve); writer.once('error', reject); writer.once('exit', code => reject(new Error(`Writer exited before readiness: ${code}`))); });
    assert.equal(backupDatabase(dataDir, destination), resolve(destination));
  } finally {
    Atomics.store(stop, 0, 1);
    Atomics.notify(stop, 0);
    assert.equal(await finished, 0);
  }
  const restored = createStore(destination);
  try {
    const settings = restored.getSettings();
    assert.deepEqual(settings.mail, mail);
    assert.ok(settings.backupRevision >= 1);
    assert.equal(restored.getMessage(mail.email, message.id).body, String(settings.backupRevision));
    store.setSettings({ mail: null });
    assert.deepEqual(restored.getSettings().mail, mail);
  } finally { restored.close(); }
  if (process.platform !== 'win32') assert.equal(statSync(destination).mode & 0o777, 0o700);
  if (process.platform !== 'win32') for (const file of ['genmail.sqlite', 'encryption.key', 'pending-calendar.json']) assert.equal(statSync(`${destination}/${file}`).mode & 0o777, 0o600);
  assert.equal(readFileSync(`${destination}/pending-calendar.json`, 'utf8'), pendingCalendar);
  assert.equal(JSON.parse(readFileSync(`${destination}/client-state.json`, 'utf8'))['morrow.pendingCalendar'], pendingCalendar);
  assert.deepEqual(readFileSync(`${destination}/encryption.key`), readFileSync(`${dataDir}/encryption.key`));
  assert.equal(readFileSync(`${destination}/genmail.sqlite`).includes(mail.password), false);
  const before = readFileSync(`${destination}/genmail.sqlite`);
  assert.throws(() => backupDatabase(dataDir, destination), { code: 'EEXIST' });
  assert.deepEqual(readFileSync(`${destination}/genmail.sqlite`), before);
});

test('a mismatched key rejects verification and removes the incomplete backup', t => {
  const directory = mkdtempSync(`${tmpdir()}/morrow-backup-failure-`);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = createStore(`${directory}/data`);
  store.close();
  writeFileSync(`${directory}/data/encryption.key`, Buffer.alloc(32), { mode: 0o600 });
  assert.throws(() => backupDatabase(`${directory}/data`, `${directory}/snapshot`), /Cannot decrypt/);
  assert.throws(() => statSync(`${directory}/snapshot`), { code: 'ENOENT' });
});
