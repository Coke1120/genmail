import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createApp } from '../server/app.js';
import { createStore } from '../server/store.js';
import { AI_BEHAVIORS } from '../shared/features.js';

async function workspace(t, services = {}) {
  const directory = mkdtempSync(`${tmpdir()}/morrow-upgrade-`);
  const store = createStore(directory), server = createServer(), calls = [];
  t.after(async () => { await new Promise(resolve => server.close(resolve)); store.close(); rmSync(directory, { recursive: true, force: true }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port, origin = `http://127.0.0.1:${port}`;
  const external = () => { throw new Error('Unexpected external integration'); };
  server.on('request', createApp({ store, port, services: {
    verifySmtp: external, fetchImapMessages: external, sendSmtpMessage: external, oauthFinish: external,
    refreshMail: external, fetchProviderMessages: external, sendProviderMessage: external,
    runModel: (...args) => { calls.push(structuredClone(args)); return 'Mock model output'; }, ...services,
  } }));
  const request = (path, body, method = body === undefined ? 'GET' : 'POST', headers = {}) => new Promise((resolve, reject) => {
    const outgoing = httpRequest(`${origin}${path}`, { method, headers: Object.fromEntries(Object.entries({ Origin: origin, 'Content-Type': 'application/json', 'X-Genmail-Account': store.getSettings().activeAccount, ...headers }).filter(([, value]) => value !== undefined)) }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => { const raw = Buffer.concat(chunks).toString(); resolve({ status: response.statusCode, data: JSON.parse(raw), raw }); });
      response.on('error', reject);
    });
    outgoing.on('error', reject);
    outgoing.end(body === undefined ? undefined : JSON.stringify(body));
  });
  return { store, request, calls, directory };
}
const model = { baseUrl: 'https://model.example.com/v1', model: 'chosen-model', apiKey: 'private-model-key', maxTokens: 512, temperature: 0.7 };
const summary = { action: 'summary', messageId: 'demo-1' };

test('model connection tests share zero emails, preserve keys only for the same base, and preferences persist', async t => {
  const { store, request, calls, directory } = await workspace(t);
  assert.equal((await request('/api/settings/ai', model)).status, 200);
  assert.equal(calls.length, 0);
  const tested = await request('/api/settings/ai/test', { ...model, apiKey: '' });
  assert.equal(tested.status, 200);
  assert.equal(tested.data.ok, true);
  assert.deepEqual(calls[0][0], model);
  assert.deepEqual(calls[0][2], []);
  assert.match(calls[0][3], /Morrow connection ready/);
  await request('/api/settings/ai/test', { ...model, baseUrl: 'https://other.example.com/v1', apiKey: '' });
  assert.equal(calls[1][0].apiKey, '');
  assert.equal(store.getSettings().ai.baseUrl, model.baseUrl);
  await request('/api/settings/ai', { ...model, apiKey: '' });
  assert.equal(store.getSettings().ai.apiKey, model.apiKey);
  await request('/api/settings/ai', { ...model, apiKey: '', clearApiKey: true });
  assert.equal(store.getSettings().ai.apiKey, '');
  await request('/api/settings/ai', model);
  await request('/api/settings/ai', { ...model, baseUrl: 'https://other.example.com/v1', apiKey: '' });
  assert.equal(store.getSettings().ai.apiKey, '');
  for (const patch of [{ temperature: 3 }, { maxTokens: 127 }, { baseUrl: 'http://remote.example.com/v1' }]) assert.equal((await request('/api/settings/ai', { ...model, ...patch })).status, 400);
  const policy = await request('/api/settings/policy', { maxMessages: 2, folders: { sent: true } });
  assert.equal(policy.status, 200);
  assert.equal((await request('/api/settings/policy', { enabled: 'yes' })).status, 400);
  const preferences = await request('/api/settings/preferences', { displayName: 'Morgan Lee', theme: 'dark', signature: 'Best, Morgan' });
  assert.equal(preferences.data.account.name, 'Morgan Lee');
  const draft = await request('/api/drafts', { to: '', subject: '', body: '' });
  assert.equal(draft.data.message.fromName, 'Morgan Lee');
  const reopened = createStore(directory);
  try {
    assert.equal(reopened.getSettings().preferences.displayName, 'Morgan Lee');
    assert.equal(reopened.getSettings().policy.maxMessages, 2);
    assert.equal(reopened.getSettings().policy.folders.sent, true);
  } finally { reopened.close(); }
});

test('master, behavior, folder, and content controls block processing before model calls', async t => {
  const { store, request, calls } = await workspace(t);
  await request('/api/settings/ai', model);
  await request('/api/settings/policy', { enabled: false });
  const get = t.mock.method(store, 'getMessage'), list = t.mock.method(store, 'listMessages');
  assert.equal((await request('/api/ai', summary)).status, 403);
  assert.equal((await request('/api/workflows/preview', { action: 'triage' })).status, 403);
  assert.equal(get.mock.callCount(), 0);
  assert.equal(list.mock.callCount(), 0);
  assert.equal((await request('/api/drafts', { body: 'Manual composing still works.' })).status, 200);
  await request('/api/settings/policy', { enabled: true, behaviors: { summary: false } });
  assert.equal((await request('/api/ai', summary)).status, 403);
  await request('/api/settings/policy', { behaviors: { summary: true }, folders: { inbox: false } });
  assert.equal((await request('/api/ai', summary)).status, 403);
  await request('/api/settings/policy', { folders: { inbox: true }, content: { body: false, sender: false, contacts: false, calendar: false } });
  assert.equal((await request('/api/ai', { action: 'rewrite', draftText: 'Private draft' })).status, 403);
  for (const action of ['memory', 'research', 'meeting', 'schedule', 'attachments', 'batchReplies']) assert.equal((await request('/api/workflows/preview', { action, messageId: 'demo-1' })).status, 403, action);
  assert.equal(calls.length, 0);
});

test('case variants and trailing slashes cannot bypass the account header guard', async t => {
  const { request, calls } = await workspace(t);
  await request('/api/settings/ai', model);
  for (const path of ['/api/AI', '/api/ai/', '/api/SEND', '/api/send/', '/api/account/disconnect/']) {
    assert.equal((await request(path, summary, 'POST', { 'X-Genmail-Account': undefined })).status, 409, path);
  }
  assert.equal(calls.length, 0);
});

test('context is redacted before search and limited to the intersection of global and skill folders', async t => {
  const { request, calls } = await workspace(t);
  await request('/api/settings/ai', model);
  await request('/api/settings/policy', { content: { subject: false, body: false, sender: false }, maxMessages: 2 });
  assert.equal((await request('/api/ai', summary)).status, 200);
  const context = calls.at(-1)[2][0];
  for (const field of ['subject', 'body', 'preview', 'fromName', 'fromEmail', 'to']) assert.equal(context[field], '');
  assert.equal((await request('/api/ai', { action: 'ask', prompt: 'Northstar' })).status, 200);
  assert.deepEqual(calls.at(-1)[2], []);
  await request('/api/settings/policy', { content: { subject: true, body: true, sender: true }, folders: { sent: true } });
  assert.equal((await request('/api/ai', { action: 'briefing' })).status, 200);
  assert.equal(calls.at(-1)[2].length, 2);
  assert.ok(calls.at(-1)[2].every(message => ['inbox', 'drafts', 'sent'].includes(message.folder)));
  const skillInput = { name: 'Sent review', instructions: 'Review sent mail.', folders: { inbox: false, sent: true, drafts: false }, enabled: true };
  const added = await request('/api/skills', skillInput);
  const skill = added.data.workspace.skills.find(skill => skill.name === skillInput.name);
  assert.equal((await request('/api/ai', { action: 'skill', skillId: skill.id })).status, 200);
  assert.ok(calls.at(-1)[2].length > 0);
  assert.ok(calls.at(-1)[2].every(message => message.folder === 'sent'));
  const before = calls.length;
  await request('/api/settings/policy', { folders: { sent: false } });
  assert.equal((await request('/api/ai', { action: 'skill', skillId: skill.id })).status, 403);
  await request('/api/settings/policy', { folders: { sent: true } });
  await request('/api/skills', { ...skillInput, id: skill.id, enabled: false });
  assert.equal((await request('/api/ai', { action: 'skill', skillId: skill.id })).status, 403);
  assert.equal(calls.length, before);
});

test('all mock previews apply locally once, persist records, and never invoke a model or provider', async t => {
  const { store, request, calls } = await workspace(t);
  await request('/api/settings/ai', model);
  await request('/api/settings/policy', { content: { attachments: true }, maxMessages: 25 });
  let applied;
  for (const feature of AI_BEHAVIORS.filter(feature => feature.mock)) {
    const preview = await request('/api/workflows/preview', { action: feature.id, ...(feature.context === 'selected' ? { messageId: 'demo-1' } : {}) });
    assert.equal(preview.status, 200, feature.id);
    assert.equal(preview.data.simulated, true);
    assert.ok(preview.data.preview.items.length);
    applied = await request('/api/workflows/apply', { previewId: preview.data.preview.id });
    assert.equal(applied.status, 200, feature.id);
    assert.equal(applied.data.simulated, true);
    assert.equal(applied.data.workspace.activity[0].simulated, true);
    assert.equal((await request('/api/workflows/apply', { previewId: preview.data.preview.id })).status, 409);
  }
  assert.equal(calls.length, 0);
  assert.equal(applied.data.workspace.reminders.length, 1);
  assert.equal(applied.data.workspace.events.length, 1);
  assert.equal(applied.data.workspace.unsubscribed.length, 1);
  assert.ok(applied.data.workspace.brain);
  assert.ok(store.listMessages('demo').some(message => message.id.startsWith('mock-draft:')));
  assert.equal(store.getMessage('demo', 'demo-3').folder, 'archive');
  const reminder = applied.data.workspace.reminders[0];
  const done = await request(`/api/workspace/reminders/${reminder.id}`, { done: true }, 'PATCH');
  assert.equal(done.data.workspace.reminders[0].done, true);
});

test('previews reject expired, changed, and cross-account sources and respect redacted senders', async t => {
  const { store, request } = await workspace(t);
  const preview = async () => (await request('/api/workflows/preview', { action: 'research', messageId: 'demo-1' })).data.preview.id;
  const policyId = await preview();
  await request('/api/settings/policy', { maxMessages: 3 });
  assert.equal((await request('/api/workflows/apply', { previewId: policyId })).status, 409);
  const changedId = await preview();
  store.updateMessage('demo', 'demo-1', { read: true });
  assert.equal((await request('/api/workflows/apply', { previewId: changedId })).status, 409);
  const accountId = await preview();
  store.setSettings({ activeAccount: 'other@example.com', mail: { email: 'other@example.com' } });
  assert.equal((await request('/api/workflows/apply', { previewId: accountId })).status, 409);
  store.setSettings({ activeAccount: 'demo' });
  const expiredId = await preview(), future = Date.now() + 11 * 60_000;
  const clock = t.mock.method(Date, 'now', () => future);
  try { assert.equal((await request('/api/workflows/apply', { previewId: expiredId })).status, 409); }
  finally { clock.mock.restore(); }
  await request('/api/settings/policy', { content: { sender: false } });
  const redacted = await request('/api/workflows/preview', { action: 'research', messageId: 'demo-1' });
  assert.equal(redacted.status, 200);
  assert.equal(redacted.raw.includes('Olivia Chen'), false);
  assert.equal(redacted.raw.includes('olivia@northstar.example'), false);
  await request('/api/settings/policy', { content: { subject: false } });
  const labels = await request('/api/workflows/preview', { action: 'labels' });
  assert.equal((await request('/api/workflows/apply', { previewId: labels.data.preview.id })).status, 200);
  assert.ok(store.getMessage('demo', 'demo-1').labels.includes('Work'));
});

test('in-flight model responses are discarded after permissions change', async t => {
  let begin, finish;
  const started = new Promise(resolve => { begin = resolve; }), waiting = new Promise(resolve => { finish = resolve; });
  const { request } = await workspace(t, { runModel: async () => { begin(); await waiting; return 'private stale output'; } });
  await request('/api/settings/ai', model);
  const response = request('/api/ai', summary);
  await started;
  try { await request('/api/settings/policy', { enabled: false }); } finally { finish(); }
  const result = await response;
  assert.equal(result.status, 409);
  assert.equal(result.raw.includes('private stale output'), false);
});

test('saved Email Brain cannot reintroduce subjects after subject permission is revoked', async t => {
  const { request, calls } = await workspace(t);
  await request('/api/settings/ai', model);
  const preview = await request('/api/workflows/preview', { action: 'memory' });
  const applied = await request('/api/workflows/apply', { previewId: preview.data.preview.id });
  assert.ok(applied.data.workspace.brain.notes.includes('Northstar'));
  await request('/api/settings/policy', { folders: { sent: true } });
  const skillInput = { name: 'Sent only', instructions: 'Review permitted sent mail.', folders: { inbox: false, drafts: false, sent: true } };
  const saved = await request('/api/skills', skillInput);
  const skill = saved.data.workspace.skills.find(skill => skill.name === skillInput.name);
  assert.equal((await request('/api/ai', { action: 'skill', skillId: skill.id })).status, 200);
  assert.equal(calls.at(-1)[4].brain, null);
  await request('/api/settings/policy', { content: { subject: false } });
  assert.equal((await request('/api/ai', summary)).status, 200);
  assert.equal(calls.at(-1)[4].brain, null);
});

test('disabling a skill during model execution discards its pending response', async t => {
  let begin, finish;
  const started = new Promise(resolve => { begin = resolve; }), waiting = new Promise(resolve => { finish = resolve; });
  const { request } = await workspace(t, { runModel: async () => { begin(); await waiting; return 'private stale skill output'; } });
  await request('/api/settings/ai', model);
  const skill = (await request('/api/state')).data.workspace.skills[0];
  const response = request('/api/ai', { action: 'skill', skillId: skill.id });
  await started;
  try { await request('/api/skills', { ...skill, enabled: false }); } finally { finish(); }
  const result = await response;
  assert.equal(result.status, 409);
  assert.equal(result.raw.includes('private stale skill output'), false);
});
