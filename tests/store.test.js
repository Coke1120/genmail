import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createStore } from '../server/store.js';

test('persistent isolated messages, encrypted settings, and one-time demo seeding', (t) => {
  const directory = mkdtempSync(`${tmpdir()}/genmail-store-`);
  let store;
  t.after(() => { store?.close(); rmSync(directory, { recursive: true, force: true }); });
  store = createStore(directory);
  assert.deepEqual(store.getSettings(), { mail: null, ai: null, activeAccount: 'demo' });
  const demo = store.listMessages('demo');
  assert.equal(demo.filter(message => message.folder === 'inbox').length, 12);
  assert.deepEqual(new Set(demo.map(message => message.folder)), new Set(['inbox', 'drafts', 'sent', 'archive']));

  const mail = {
    email: 'alex@example.com', password: 'secret-mail-password-123', provider: 'gmail',
    accessToken: 'secret-access-token-789', refreshToken: 'secret-refresh-token-012',
    clientSecret: 'secret-oauth-client-345', clientId: 'public-client-id', expiresAt: 1800000000000,
  };
  const ai = { baseUrl: 'http://localhost:11434/v1', model: 'local-model', apiKey: 'secret-model-key-456' };
  store.setSettings({ mail, activeAccount: mail.email });
  store.setSettings({ ai });
  store.setSettings({ activeAccount: 'demo' });
  assert.deepEqual(store.getSettings(), { mail, ai, activeAccount: 'demo' });

  const message = { ...demo[0], id: 'shared-id', subject: 'Account A' };
  store.upsertMessage('a@example.com', message);
  store.upsertMessage('b@example.com', { ...message, subject: 'Account B' });
  assert.equal(store.listMessages('a@example.com').length, 1);
  assert.equal(store.listMessages('b@example.com').length, 1);
  assert.equal(store.listMessages('missing@example.com').length, 0);
  assert.equal(store.getMessage('missing@example.com', message.id), null);
  assert.equal(store.updateMessage('missing@example.com', message.id, { read: true }), null);
  assert.equal(store.deleteMessage('missing@example.com', message.id), false);
  const updated = store.updateMessage('a@example.com', message.id, { read: true, folder: 'archive', id: 'cannot-change-id' });
  assert.equal(updated.id, message.id);
  assert.equal(updated.folder, 'archive');
  assert.equal(store.getMessage('b@example.com', message.id).subject, 'Account B');
  assert.equal(store.getMessage('b@example.com', message.id).folder, message.folder);
  assert.equal(store.deleteMessage('a@example.com', message.id), true);
  assert.equal(store.getMessage('a@example.com', message.id), null);
  assert.equal(store.getMessage('b@example.com', message.id).subject, 'Account B');

  for (const item of demo) store.deleteMessage('demo', item.id);
  store.close();
  store = undefined;
  const disk = readFileSync(`${directory}/genmail.sqlite`);
  assert.equal(disk.includes(mail.password), false);
  assert.equal(disk.includes(ai.apiKey), false);
  assert.equal(disk.includes(mail.accessToken), false);
  assert.equal(disk.includes(mail.refreshToken), false);
  assert.equal(disk.includes(mail.clientSecret), false);
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  assert.equal(statSync(`${directory}/encryption.key`).mode & 0o777, 0o600);
  assert.equal(statSync(`${directory}/genmail.sqlite`).mode & 0o777, 0o600);
  store = createStore(directory);
  assert.deepEqual(store.getSettings(), { mail, ai, activeAccount: 'demo' });
  assert.equal(store.getMessage('b@example.com', message.id).subject, 'Account B');
  assert.equal(store.listMessages('demo').length, 0);
});

test('missing or incorrect encryption keys fail without replacing them', (t) => {
  const directory = mkdtempSync(`${tmpdir()}/genmail-key-`);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = createStore(directory);
  store.setSettings({ mail: { email: 'alex@example.com', password: 'keep-me-safe' } });
  store.close();
  const keyPath = `${directory}/encryption.key`;
  const originalKey = readFileSync(keyPath);
  unlinkSync(keyPath);
  assert.throws(() => createStore(directory), /missing encryption.key/);
  assert.throws(() => readFileSync(keyPath), { code: 'ENOENT' });
  writeFileSync(keyPath, Buffer.alloc(32), { mode: 0o600 });
  assert.throws(() => createStore(directory), /Cannot decrypt Genmail settings/);
  assert.deepEqual(readFileSync(keyPath), Buffer.alloc(32));
  writeFileSync(keyPath, originalKey);
  const restored = createStore(directory);
  try {
    assert.equal(restored.getSettings().mail.password, 'keep-me-safe');
  } finally {
    restored.close();
  }
});

test('synchronous transactions commit together, roll back failures, and isolate nested savepoints', t => {
  const directory = mkdtempSync(`${tmpdir()}/genmail-transactions-`);
  const store = createStore(directory);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const original = store.getMessage('demo', 'demo-1');
  assert.throws(() => store.transaction(() => {
    store.setSettings({ activeAccount: 'failed@example.com' });
    store.updateMessage('demo', original.id, { subject: 'Discard this' });
    throw new Error('Failed operation');
  }), /Failed operation/);
  assert.equal(store.getSettings().activeAccount, 'demo');
  assert.deepEqual(store.getMessage('demo', original.id), original);
  const result = store.transaction(() => {
    store.updateMessage('demo', original.id, { subject: 'Keep this' });
    assert.throws(() => store.transaction(() => {
      store.updateMessage('demo', original.id, { subject: 'Discard nested change' });
      store.setSettings({ activeAccount: 'failed@example.com' });
      throw new Error('Nested failure');
    }), /Nested failure/);
    store.transaction(() => store.setSettings({ ai: { model: 'saved-model' } }));
    return 'committed';
  });
  assert.equal(result, 'committed');
  assert.equal(store.getMessage('demo', original.id).subject, 'Keep this');
  assert.equal(store.getSettings().activeAccount, 'demo');
  assert.equal(store.getSettings().ai.model, 'saved-model');
  assert.throws(() => store.transaction(() => {
    store.transaction(() => store.updateMessage('demo', original.id, { subject: 'Nested success inside failure' }));
    throw new Error('Outer failure');
  }), /Outer failure/);
  assert.equal(store.getMessage('demo', original.id).subject, 'Keep this');
  let called = false;
  assert.throws(() => store.transaction(async () => { called = true; }), /synchronous callback/);
  assert.equal(called, false);
  assert.throws(() => store.transaction(() => {
    store.updateMessage('demo', original.id, { subject: 'Promise change' });
    return Promise.resolve();
  }), /cannot return a Promise/);
  assert.equal(store.getMessage('demo', original.id).subject, 'Keep this');
  assert.throws(() => store.transaction(() => store.close()), /active store transaction/);
  store.close();
  assert.doesNotThrow(() => store.close());
  const reopened = createStore(directory);
  try { assert.equal(reopened.getMessage('demo', original.id).subject, 'Keep this'); }
  finally { reopened.close(); }
});
