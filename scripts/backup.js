import { DatabaseSync } from 'node:sqlite';
import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createStore } from '../server/store.js';

export function backupDatabase(dataDir, destination = resolve('backups', `morrow-${new Date().toISOString().replace(/[:.]/g, '-')}`)) {
  destination = resolve(destination);
  const source = new DatabaseSync(resolve(dataDir, 'genmail.sqlite'), { readOnly: true });
  let created = false;
  try {
    source.exec('PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL;');
    if (!source.prepare('SELECT value FROM settings WHERE id = 1').get()) throw new Error('The source mailbox has not been initialized.');
    const key = readFileSync(resolve(dataDir, 'encryption.key'));
    if (key.length !== 32) throw new Error('The source encryption key is invalid.');
    const clientFiles = new Map();
    for (const name of ['pending-calendar.json', 'client-state.json']) {
      try { clientFiles.set(name, readFileSync(resolve(dataDir, name))); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    mkdirSync(destination, { mode: 0o700 });
    created = true;
    // VACUUM INTO snapshots a running database and works on the minimum supported Node 22.13.
    const databasePath = resolve(destination, 'genmail.sqlite');
    source.prepare('VACUUM INTO ?').run(databasePath);
    chmodSync(databasePath, 0o600);
    writeFileSync(resolve(destination, 'encryption.key'), key, { flag: 'wx', mode: 0o600, flush: true });
    for (const [name, contents] of clientFiles) writeFileSync(resolve(destination, name), contents, { flag: 'wx', mode: 0o600, flush: true });
    const snapshot = new DatabaseSync(databasePath, { readOnly: true });
    try {
      if (snapshot.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Backup database integrity verification failed.');
    } finally { snapshot.close(); }
    const restored = createStore(destination);
    try { restored.getSettings(); } finally { restored.close(); }
    // Windows cannot open directories for fsync; SQLite and the key files are flushed above.
    for (const path of process.platform === 'win32' ? [databasePath] : [databasePath, destination]) {
      const descriptor = openSync(path, process.platform === 'win32' ? 'r+' : 'r');
      try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
    }
    return destination;
  } catch (error) {
    if (created) rmSync(destination, { recursive: true, force: true });
    throw error;
  } finally { source.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length > 3) throw new Error('Usage: npm run backup -- [new-destination-directory]');
    const destination = backupDatabase(resolve(process.env.DATA_DIR || 'data'), process.argv[2]);
    console.log(`Verified Morrow Mail backup saved to ${destination}`);
  } catch (error) {
    console.error(error.code === 'EEXIST' ? 'Backup destination already exists. Choose a new directory.' : `Backup failed: ${error.message}`);
    process.exitCode = 1;
  }
}
