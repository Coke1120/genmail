import { Converter } from 'opencc-js';

const simplify = Converter({ from: 'hk', to: 'cn' });
export const normalizeSearch = value => simplify(String(value ?? '').normalize('NFKC')).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim();
// Han unigrams/bigrams keep one- and two-character queries indexed, without a
// language-specific word splitter. Literal verification preserves phrase order.
export function searchTokens(value) {
  return normalizeSearch(value).match(/[\p{L}\p{N}]+/gu)?.flatMap(word => {
    const parts = word.match(/\p{Script=Han}+|[^\p{Script=Han}]+/gu) || [];
    return parts.flatMap(part => /\p{Script=Han}/u.test(part) ? [...part].flatMap((char, i, chars) => i + 1 < chars.length ? [char, char + chars[i + 1]] : [char]) : [part]);
  }).join(' ') || '';
}
export function initializeSearchIndex(db) {
  db.function('mail_normalize', { deterministic: true }, normalizeSearch);
  db.function('mail_tokens', { deterministic: true }, searchTokens);
  db.exec(`
    CREATE TABLE IF NOT EXISTS search_meta (version INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS search_documents (
      rowid INTEGER PRIMARY KEY, account TEXT NOT NULL, id TEXT NOT NULL,
      date TEXT, folder TEXT, unread INTEGER, starred INTEGER, category TEXT,
      sender TEXT, recipients TEXT, subject TEXT, body TEXT, labels TEXT,
      UNIQUE(account,id)
    );
    CREATE INDEX IF NOT EXISTS search_scope ON search_documents(account,folder,date);
    CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(subject,sender,recipients,body,labels);
    CREATE TABLE IF NOT EXISTS search_vectors (
      account TEXT NOT NULL, id TEXT NOT NULL, part INTEGER NOT NULL,
      stamp TEXT NOT NULL, hash TEXT NOT NULL, vector TEXT NOT NULL,
      PRIMARY KEY(account,id,part)
    );
    CREATE TRIGGER IF NOT EXISTS search_doc_insert AFTER INSERT ON search_documents BEGIN
      INSERT INTO search_fts(rowid,subject,sender,recipients,body,labels)
      VALUES(new.rowid,mail_tokens(new.subject),mail_tokens(new.sender),mail_tokens(new.recipients),mail_tokens(new.body),mail_tokens(new.labels));
    END;
    CREATE TRIGGER IF NOT EXISTS search_doc_delete AFTER DELETE ON search_documents BEGIN
      DELETE FROM search_fts WHERE rowid=old.rowid;
    END;
  `);
  const columns = `rowid,account,id,date,folder,unread,starred,category,sender,recipients,subject,body,labels`;
  const values = prefix => `${prefix}.rowid,${prefix}.account,${prefix}.id,
    COALESCE(json_extract(${prefix}.data,'$.date'),''),COALESCE(json_extract(${prefix}.data,'$.folder'),''),
    NOT COALESCE(json_extract(${prefix}.data,'$.read'),0),COALESCE(json_extract(${prefix}.data,'$.starred'),0),COALESCE(json_extract(${prefix}.data,'$.category'),''),
    mail_normalize(COALESCE(json_extract(${prefix}.data,'$.fromName'),'')||' '||COALESCE(json_extract(${prefix}.data,'$.fromEmail'),'')),
    mail_normalize(COALESCE(json_extract(${prefix}.data,'$.to'),'')||' '||COALESCE(json_extract(${prefix}.data,'$.cc'),'')||' '||COALESCE(json_extract(${prefix}.data,'$.bcc'),'')),
    mail_normalize(json_extract(${prefix}.data,'$.subject')),mail_normalize(json_extract(${prefix}.data,'$.body')),mail_normalize(json_extract(${prefix}.data,'$.labels'))`;
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS search_message_insert AFTER INSERT ON messages BEGIN
      INSERT INTO search_documents(${columns}) VALUES(${values('new')});
    END;
    CREATE TRIGGER IF NOT EXISTS search_message_update AFTER UPDATE ON messages BEGIN
      DELETE FROM search_documents WHERE rowid=old.rowid;
      INSERT INTO search_documents(${columns}) VALUES(${values('new')});
    END;
    CREATE TRIGGER IF NOT EXISTS search_message_delete AFTER DELETE ON messages BEGIN
      DELETE FROM search_documents WHERE rowid=old.rowid;
      DELETE FROM search_vectors WHERE account=old.account AND id=old.id;
    END;
  `);
  if (!db.prepare('SELECT version FROM search_meta WHERE version=1').get()) {
    db.exec('BEGIN IMMEDIATE');
    try { db.exec(`DELETE FROM search_documents; INSERT INTO search_documents(${columns}) SELECT ${values('messages')} FROM messages; INSERT INTO search_meta VALUES(1); COMMIT`); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return {
    query: (sql, params = []) => db.prepare(sql).all(...params),
    saveVectors(account, id, stamp, hash, vectors) {
      db.prepare('DELETE FROM search_vectors WHERE account=? AND id=?').run(account, id);
      const insert = db.prepare('INSERT INTO search_vectors VALUES(?,?,?,?,?,?)');
      vectors.forEach((vector, part) => insert.run(account, id, part, stamp, hash, JSON.stringify(vector)));
    },
    clearVectors(stamp = '') { db.prepare('DELETE FROM search_vectors WHERE stamp<>?').run(stamp); },
  };
}
