import test from 'node:test';
import assert from 'node:assert/strict';
import { replyDraft, forwardDraft, copyProviderDraft } from '../src/message-draft.js';
import { recipients } from '../server/recipients.js';

const message = {
  id: 'provider-id', viewId: 'owned-provider-id', accountId: 'Owner@example.com', folder: 'inbox',
  fromName: 'Sender', fromEmail: 'sender@example.com',
  to: '"Doe, Jane" <JANE@example.com>, OWNER@example.com; teammate@example.com, SENDER@example.com',
  cc: '"Smith, \\"JJ\\"" <jane@example.com>, copy@example.com, sender@example.com, owner@example.com',
  bcc: 'hidden@example.com', subject: 'Question', body: 'First line\r\nSecond line', date: '2026-09-26T12:30:00Z',
  footer: { text: 'Old footer' }, replyToId: 'old-thread', deliveryRequestId: 'old-request',
};

test('reply all normalizes quoted names, deduplicates To/Cc and excludes only the owner without copying Bcc', () => {
  const draft = replyDraft(message, { all: true, body: 'My answer' });
  assert.deepEqual(draft, { accountId: message.accountId, to: 'sender@example.com, JANE@example.com, teammate@example.com', cc: 'copy@example.com', bcc: '', subject: 'Re: Question', body: 'My answer', replyToId: message.id });
  assert.deepEqual(recipients(draft), { to: draft.to, cc: draft.cc, bcc: '' });
  assert.doesNotMatch(JSON.stringify(draft), /hidden@example|old-request|Old footer|owned-provider-id/);
  assert.equal(replyDraft({ ...message, subject: 'rE: Already replied' }).subject, 'rE: Already replied');
  assert.equal(replyDraft({ ...message, accountId: 'demo', to: 'alex@genmail.example' }, { all: true }).to, 'sender@example.com');
});

test('ordinary replies retain their API and sent reply-all addresses the original recipients, not the sending alias', () => {
  const ordinary = replyDraft(message);
  assert.equal(ordinary.to, message.fromEmail); assert.equal(ordinary.cc, ''); assert.equal(ordinary.bcc, '');
  const sent = { ...message, folder: 'sent', fromEmail: 'sending-alias@example.com' };
  assert.equal(replyDraft(sent).to, 'JANE@example.com, OWNER@example.com, teammate@example.com, SENDER@example.com');
  const all = replyDraft(sent, { all: true });
  assert.equal(all.to, 'JANE@example.com, teammate@example.com, SENDER@example.com');
  assert.equal(all.cc, 'copy@example.com'); assert.equal(all.replyToId, sent.id);
  assert.doesNotMatch(all.to + all.cc, /sending-alias|owner@example/i);
});

test('malformed or unsupported recipient lists remain visible for correction instead of being partially parsed', () => {
  for (const value of ['valid@example.com, broken-recipient', '"Unclosed name <a@example.com>', 'Missing <>', 'Two <a@example.com, b@example.com>', 'a@example.com,', 'a@example.com\r\nBcc: injected@example.com', 'Group: a@example.com;', 'Doe, Jane <jane@example.com>']) {
    const draft = replyDraft({ ...message, to: value, cc: '' }, { all: true });
    assert.equal(draft.to, `sender@example.com, ${value}`, value);
    assert.throws(() => recipients(draft), value);
    assert.equal(replyDraft({ ...message, to: '', cc: value }, { all: true }).cc, value);
  }
});

test('forwarding locks the original owner, starts blank recipients and quotes plaintext without Bcc or reply threading', () => {
  const draft = forwardDraft(message);
  assert.equal(draft.accountId, message.accountId); assert.equal(draft.forwarding, true);
  assert.equal(draft.to, ''); assert.equal(draft.cc, ''); assert.equal(draft.bcc, '');
  assert.equal(draft.subject, 'Fwd: Question');
  assert.match(draft.body, /> From: Sender <sender@example.com>/);
  assert.match(draft.body, /> Date: 2026-09-26T12:30:00Z/);
  assert.match(draft.body, /> To: /); assert.match(draft.body, /> Cc: /);
  assert.match(draft.body, /> First line\n> Second line$/);
  for (const key of ['id', 'viewId', 'replyToId', 'footer', 'deliveryRequestId']) assert.equal(Object.hasOwn(draft, key), false);
  assert.doesNotMatch(JSON.stringify(draft), /hidden@example|Bcc:|old-thread|Old footer/);
  for (const subject of ['Fwd: Already forwarded', 'FW: Already forwarded']) assert.equal(forwardDraft({ ...message, subject }).subject, subject);
  assert.equal(forwardDraft({ ...message, accountId: undefined }).accountId, undefined);
});


test('compose renders new, reply-all and forward drafts with real sender options and bound ownership', async t => {
  const { createServer } = await import('vite');
  const { default: React } = await import('react');
  const { renderToString } = await import('react-dom/server');
  const { DEFAULT_POLICY, DEFAULT_PREFERENCES } = await import('../shared/features.js');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  t.after(() => vite.close());
  const { Compose } = await vite.ssrLoadModule('/src/App.jsx');
  const accounts = ['owner@example.invalid', 'other@example.invalid'].map(id => ({ id, email: id, mode: 'live' }));
  const message = { accountId: accounts[0].id, id: 'same-id', fromEmail: 'sender@example.invalid', to: accounts[0].id, cc: 'team@example.invalid', subject: 'Subject', body: 'Text' };
  for (const initial of [{}, replyDraft(message, { all: true }), forwardDraft(message), { ...message, folder: 'drafts', providerDraft: true }]) {
    const html = renderToString(React.createElement(Compose, { initial, account: accounts[1], accounts, preferences: DEFAULT_PREFERENCES, policy: DEFAULT_POLICY, footer: {} }));
    assert.doesNotMatch(html, /Demo workspace|value="demo"/);
    const sender = html.match(/<select aria-label="Sending account"[^>]*>/)[0];
    if (initial.accountId) {
      assert.match(sender, /disabled/);
      assert.match(html, /<option value="owner@example.invalid" selected=""/);
    } else assert.doesNotMatch(sender, /disabled/);
    if (initial.forwarding) assert.match(html, /Forward message|Attachments are not included/);
    if (initial.providerDraft) { assert.match(html, /Editing a local copy/); assert.doesNotMatch(html, /Delivery could not be confirmed/); }
  }
});

test('Gmail drafts become unthreaded local copies with normalized To/Cc/Bcc and a fixed owner', () => {
  const copy = copyProviderDraft({ ...message, providerDraft: true, folder: 'drafts' });
  assert.equal(copy.accountId, message.accountId); assert.equal(copy.sourceDraft, true);
  assert.equal(copy.to, 'JANE@example.com, OWNER@example.com, teammate@example.com, SENDER@example.com');
  assert.equal(copy.bcc, 'hidden@example.com'); assert.equal(copy.body, message.body);
  for (const key of ['id', 'remoteId', 'providerDraft', 'replyToId', 'deliveryRequestId', 'footer']) assert.equal(Object.hasOwn(copy, key), false);
});
