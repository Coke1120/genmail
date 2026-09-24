import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createDemoMessages } from './demo.js';
import { initializeSearchIndex } from './search-index.js';
import { createMailPages } from './mail-pages.js';

export function createStore(dataDir) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  chmodSync(dataDir, 0o700);
  const databasePath = `${dataDir}/genmail.sqlite`;
  const keyPath = `${dataDir}/encryption.key`;
  if (!existsSync(keyPath)) {
    if (existsSync(databasePath)) {
      throw new Error('Existing Genmail database is missing encryption.key. Restore the original key from your backup.');
    }
    writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: 'wx' });
  }
  chmodSync(keyPath, 0o600);
  const key = readFileSync(keyPath);
  if (key.length !== 32) throw new Error('Genmail encryption.key must contain the original 32-byte key.');
  if (existsSync(databasePath)) chmodSync(databasePath, 0o600);
  const db = new DatabaseSync(databasePath);
  let transactionDepth = 0, transactionId = 0, closed = false;

  function encrypt(settings) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(settings), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
  }

  function decrypt(value) {
    try {
      const bytes = Buffer.from(value, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
    } catch (cause) {
      throw new Error('Cannot decrypt Genmail settings. Restore the matching encryption.key and database from your backup.', { cause });
    }
  }

  try {
    chmodSync(databasePath, 0o600);
    db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA synchronous = FULL;
      PRAGMA journal_mode = DELETE;
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (
        account TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (account, id)
      );
    `);
    const search = initializeSearchIndex(db);
    const epoch = randomBytes(16).toString('hex');
    const revision = () => `${epoch}:${db.prepare('SELECT total_changes() AS n').get().n}:${db.prepare('PRAGMA data_version').get().data_version}`;
    const mailPages = createMailPages(db, revision);
    const readSettings = db.prepare('SELECT value FROM settings WHERE id = 1');
    const writeSettings = db.prepare('INSERT INTO settings (id, value) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET value = excluded.value');
    const list = db.prepare("SELECT data FROM messages WHERE account = ? ORDER BY json_extract(data, '$.date') DESC, id");
    const get = db.prepare('SELECT data FROM messages WHERE account = ? AND id = ?');
    const upsert = db.prepare('INSERT INTO messages (account, id, data) VALUES (?, ?, ?) ON CONFLICT (account, id) DO UPDATE SET data = excluded.data');
    const remove = db.prepare('DELETE FROM messages WHERE account = ? AND id = ?');

    const store = {
      search,
      databasePath,
      revision,
      messagePage: mailPages.page,
      messageStats: mailPages.stats,
      getSettings() {
        return decrypt(readSettings.get().value);
      },
      setSettings(partial) {
        const settings = { ...store.getSettings(), ...partial };
        writeSettings.run(encrypt(settings));
        return settings;
      },
      listMessages(account) {
        return list.all(account).map(({ data }) => JSON.parse(data));
      },
      getMessage(account, id) {
        const row = get.get(account, id);
        return row ? JSON.parse(row.data) : null;
      },
      upsertMessage(account, message) {
        upsert.run(account, message.id, JSON.stringify(message));
        return message;
      },
      updateMessage(account, id, patch) {
        const message = store.getMessage(account, id);
        return message ? store.upsertMessage(account, { ...message, ...patch, id }) : null;
      },
      deleteMessage(account, id) {
        return remove.run(account, id).changes > 0;
      },
      transaction(work) {
        if (typeof work !== 'function' || work.constructor.name === 'AsyncFunction') throw new TypeError('Store transactions require a synchronous callback.');
        const outermost = transactionDepth === 0, savepoint = `morrow_${++transactionId}`;
        db.exec(outermost ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`);
        transactionDepth++;
        try {
          const result = work();
          if (result && typeof result.then === 'function') {
            if (result instanceof Promise) result.catch(() => {});
            throw new TypeError('Store transactions cannot return a Promise.');
          }
          db.exec(outermost ? 'COMMIT' : `RELEASE SAVEPOINT ${savepoint}`);
          return result;
        } catch (error) {
          db.exec(outermost ? 'ROLLBACK' : `ROLLBACK TO SAVEPOINT ${savepoint}; RELEASE SAVEPOINT ${savepoint}`);
          throw error;
        } finally {
          transactionDepth--;
        }
      },
      close() {
        if (transactionDepth) throw new Error('Finish the active store transaction before closing.');
        if (!closed) { db.close(); closed = true; }
      },
    };

    store.transaction(() => {
      if (!readSettings.get()) {
        writeSettings.run(encrypt({ mail: null, ai: null, activeAccount: 'demo' }));
        for (const message of createDemoMessages()) store.upsertMessage('demo', message);
      } else {
        store.getSettings();
      }
    });
    return store;
  } catch (error) {
    db.close();
    throw error;
  }
}
