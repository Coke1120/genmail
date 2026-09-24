import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_BEHAVIORS, DEFAULT_POLICY, DEFAULT_PREFERENCES } from '../shared/features.js';
import { resolvePolicy, updatePolicy, updatePreferences, requireBehavior, redactMessage, permittedMessages } from '../server/policy.js';

test('permissions merge without mutating defaults and reject unknown or malformed controls', () => {
  const defaults = structuredClone(DEFAULT_POLICY);
  const saved = { enabled: true, content: { body: false } };
  const policy = updatePolicy(saved, { folders: { sent: true }, behaviors: { summary: false }, maxMessages: 3 });
  assert.equal(policy.content.body, false);
  assert.equal(policy.content.sender, true);
  assert.equal(policy.folders.sent, true);
  assert.equal(policy.behaviors.summary, false);
  assert.equal(policy.maxMessages, 3);
  assert.deepEqual(saved, { enabled: true, content: { body: false } });
  assert.deepEqual(DEFAULT_POLICY, defaults);
  for (const patch of [null, [], { enabled: 'false' }, { maxMessages: 0 }, { maxMessages: 51 }, { maxMessages: 1.5 }, { unknown: true }, { content: [] }, { content: { sender: 1 } }, { folders: { spam: true } }, { behaviors: { nonexistent: true } }, JSON.parse('{"__proto__":{"enabled":true}}')]) {
    assert.throws(() => updatePolicy(policy, patch), { status: 400 });
  }
  assert.deepEqual(resolvePolicy(), defaults);
  assert.deepEqual(resolvePolicy(saved).triggers, { onOpen: false, onReply: false, onArrival: false, scheduledSummary: false, inboxOnly: true, starredOnly: false });
  assert.deepEqual(updatePolicy(saved, { triggers: { onOpen: true } }).triggers, { onOpen: true, onReply: false, onArrival: false, scheduledSummary: false, inboxOnly: true, starredOnly: false });
  for (const triggers of [[], { onOpen: 'true' }, { onSync: true }]) assert.throws(() => updatePolicy(saved, { triggers }), { status: 400 });
});

test('every behavior obeys the master switch, its own switch, and required content scopes', () => {
  for (const feature of AI_BEHAVIORS) {
    assert.throws(() => requireBehavior(updatePolicy({}, { enabled: false }), feature.id), { status: 403 });
    assert.throws(() => requireBehavior(updatePolicy({}, { behaviors: { [feature.id]: false } }), feature.id), { status: 403 });
    assert.equal(requireBehavior(updatePolicy({}, { content: { attachments: true } }), feature.id).id, feature.id);
  }
  for (const [action, scope] of [['memory', 'contacts'], ['research', 'contacts'], ['meeting', 'calendar'], ['schedule', 'calendar'], ['attachments', 'attachments'], ['batchReplies', 'sender'], ['batchReplies', 'body']]) {
    assert.throws(() => requireBehavior(updatePolicy({}, { content: { [scope]: false } }), action), { status: 403 });
  }
  assert.throws(() => requireBehavior(resolvePolicy(), 'unknown'), { status: 400 });
});

test('redaction removes derived text and recipient addresses before folder-scoped processing', () => {
  const message = { id: 'one', date: '2026-09-23T00:00:00Z', folder: 'inbox', read: false, starred: false, category: 'primary', subject: 'private subject', body: 'private body', preview: 'private preview', fromName: 'Private Sender', fromEmail: 'private@example.com', to: 'recipient@example.com', labels: ['private label'], messageId: 'private-rfc-id', replyToId: 'private-reply-id' };
  const before = structuredClone(message);
  const policy = updatePolicy({}, { content: { subject: false, body: false, sender: false } });
  const redacted = redactMessage(message, policy);
  assert.equal(JSON.stringify(redacted).includes('private'), false);
  assert.equal(redacted.to, '');
  assert.deepEqual(redacted.labels, []);
  assert.equal(Object.hasOwn(redacted, 'messageId'), false);
  assert.deepEqual(message, before);
  const messages = ['inbox', 'sent', 'drafts', 'archive', 'trash'].map(folder => ({ ...message, id: folder, folder }));
  assert.deepEqual(permittedMessages(messages, policy).map(message => message.folder), ['inbox', 'drafts']);
});

test('preferences validate persisted controls without mutating their defaults', () => {
  const defaults = structuredClone(DEFAULT_PREFERENCES);
  const preferences = updatePreferences({ language: 'English' }, { displayName: 'Morgan', theme: 'dark', density: 'compact', replyTone: 'warm', syncInterval: 15, markReadOnOpen: false, signature: 'Best, Morgan' });
  assert.equal(preferences.displayName, 'Morgan');
  assert.equal(preferences.language, 'English');
  assert.deepEqual(DEFAULT_PREFERENCES, defaults);
  for (const patch of [{ theme: 'purple' }, { density: 'tight' }, { syncInterval: 2 }, { markReadOnOpen: 'true' }, { displayName: 'Injected\nSender' }, { signature: 'a'.repeat(12001) }, { language: '' }, { unknown: true }]) assert.throws(() => updatePreferences({}, patch), { status: 400 });
});
