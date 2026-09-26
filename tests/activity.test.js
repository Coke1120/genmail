import test from 'node:test';
import assert from 'node:assert/strict';
import { createActivity } from '../server/activity.js';
import { createHistory } from '../server/history.js';

const A = 'one@example.invalid', B = 'two@example.invalid', OFF = 'disconnected@example.invalid';
const at = '2026-09-27T09:00:00.000Z';
function fixture() {
  let config = { mailAccounts: { [A]: { email: A, provider: 'google', connectionId: 'private-connection' }, [B]: { email: B } } };
  const store = { getSettings: () => config, setSettings: patch => { config = { ...config, ...patch }; }, transaction: work => work() };
  const connections = () => config.mailAccounts;
  return { store, connections, get config() { return config; } };
}
const task = (activity, id) => activity.snapshot().tasks.find(item => item.id === id);

test('runtime activity tracks in-flight, finish and cancellation, retains 20 completions and filters disconnected owners', () => {
  const f = fixture(), activity = createActivity({ settings: f.store.getSettings, connections: f.connections, importStatus: () => null });
  const finish = activity.start(A, 'sync', 'Fetching mail', 'Checking Inbox');
  assert.equal(activity.snapshot().tasks[0].status, 'running');
  assert.equal(activity.snapshot().tasks[0].completed, null);
  finish(true, 12); finish(false, 99);
  assert.equal(activity.snapshot().tasks[0].status, 'complete');
  assert.equal(activity.snapshot().tasks[0].completed, 12);
  const cancelled = activity.start(B, 'ai', 'AI assistance', 'Waiting for the configured model');
  cancelled(null);
  assert.equal(activity.snapshot().tasks[0].status, 'interrupted');
  const finishes = Array.from({ length: 45 }, () => activity.start(A, 'sync', 'Fetching mail', 'Checking Sent'));
  const keep = activity.start(B, 'sync', 'Fetching mail', 'Checking Inbox');
  finishes.forEach(done => done(true, 1));
  assert.equal(activity.snapshot().tasks.length, 21);
  assert.equal(activity.snapshot().tasks.filter(item => item.status === 'running').length, 1);
  const snapshot = activity.snapshot(); snapshot.tasks[0].label = 'changed';
  assert.doesNotMatch(JSON.stringify(activity.snapshot()), /changed/);
  keep(false);
  assert.equal(activity.snapshot().tasks.length, 20);
  f.config.mailAccounts = {};
  assert.deepEqual(activity.snapshot().tasks, []);
});

test('actual history state is queued between pages, ordinary sync is separate and old unknown counters remain null', async () => {
  const f = fixture();
  let activity, release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const history = createHistory({ store: f.store, connection: account => f.connections()[account], currentMail: async account => f.connections()[account], lock: work => work(), now: () => Date.parse(at), importMessages: () => ['new-message-id'], fetchPage: async mail => {
    const done = activity.start(mail.email, 'import', 'Fetching history', 'Checking All mail');
    entered(); await new Promise(resolve => { release = resolve; });
    done(true, 2);
    return { messages: [{ id: 'private-id-1', date: '2026-09-01T00:00:00.000Z' }, { id: 'private-id-2', date: '2026-09-01T00:00:00.000Z' }], nextCursor: null };
  } });
  activity = createActivity({ settings: f.store.getSettings, connections: f.connections, importStatus: history.status });
  history.start(A, { allMail: true });
  assert.equal(task(activity, `import:${A}`).status, 'queued');
  const sync = activity.start(A, 'sync', 'Fetching mail', 'Checking Inbox');
  assert.equal(task(activity, `import:${A}`).status, 'queued');
  sync(true, 0);
  const work = history.tick(); await started;
  assert.equal(task(activity, `import:${A}`).status, 'running');
  assert.equal(activity.snapshot().tasks.filter(item => item.kind === 'import').length, 1);
  assert.equal(activity.snapshot().tasks.filter(item => item.status === 'running').length, 1);
  assert.match(task(activity, `import:${A}`).detail, /All mail/);
  release(); await work;
  const complete = task(activity, `import:${A}`);
  assert.equal(complete.status, 'complete'); assert.equal(complete.completed, 2); assert.equal(complete.total, null);
  assert.match(complete.detail, /1 pages checked · 2 messages checked · 1 new messages/);
  delete f.config.imports[A].pages; delete f.config.imports[A].processed;
  f.config.imports[A].status = 'failed'; f.config.imports[A].error = 'RAW-PROVIDER-ERROR secret-token private-id';
  const legacy = task(activity, `import:${A}`);
  assert.equal(legacy.completed, null); assert.equal(legacy.total, null);
  assert.match(legacy.detail, /Page count unknown · Checked message count unknown/);
  assert.doesNotMatch(JSON.stringify(activity.snapshot()), /RAW-PROVIDER|secret-token|private-id|private-connection/);
  f.config.imports[A].status = 'paused';
  assert.equal(task(activity, `import:${A}`).status, 'paused');
});

test('summary, learning and serial indexing projections expose only safe per-account metadata', () => {
  const f = fixture(), activity = createActivity({ settings: f.store.getSettings, connections: f.connections, importStatus: () => null });
  const secret = { id: 'PRIVATE-MESSAGE-ID', text: 'PRIVATE-BODY', voice: 'PRIVATE-VOICE', error: 'PRIVATE-ERROR api-key', sources: [{ body: 'PRIVATE-BODY' }], createdAt: at };
  f.store.setSettings({
    automation: { [A]: { jobs: [{ ...secret, status: 'running' }, { ...secret, status: 'queued' }, { ...secret, status: 'skipped' }] }, [OFF]: { jobs: [{ ...secret, status: 'running' }] } },
    styleLearning: { [A]: { preview: { ...secret, status: 'running', sampleCount: 4 } }, [B]: { preview: { ...secret, status: 'ready', sampleCount: 2 } }, [OFF]: { preview: { ...secret, status: 'running' } } },
    searchIndex: { ...secret, status: 'running', completed: 1, sources: [A, B, OFF, A].map(account => ({ account, id: 'PRIVATE-MESSAGE-ID', hash: 'PRIVATE-HASH' })) },
  });
  const before = structuredClone(f.config);
  assert.equal(task(activity, `summaries:${A}`).status, 'running');
  assert.equal(task(activity, `summaries:${A}`).total, 2);
  assert.equal(task(activity, `summaries:${A}`).completed, null);
  assert.equal(task(activity, `last-summary:${A}`).status, 'interrupted');
  assert.match(task(activity, `last-summary:${A}`).detail, /result was discarded/);
  assert.equal(task(activity, `learning:${A}`).completed, null);
  assert.equal(task(activity, `learning:${A}`).total, 4);
  assert.equal(task(activity, `learning:${B}`).completed, 2);
  assert.match(task(activity, `learning:${B}`).detail, /Review and save/);
  assert.deepEqual([task(activity, `semantic-index:${A}`).status, task(activity, `semantic-index:${A}`).completed, task(activity, `semantic-index:${A}`).total], ['queued', 1, 2]);
  assert.equal(task(activity, `semantic-index:${B}`).status, 'running');
  assert.doesNotMatch(JSON.stringify(activity.snapshot()), /PRIVATE-|api-key|disconnected@example/);
  assert.deepEqual(f.config, before);
  f.config.searchIndex.completed = 4;
  assert.equal(task(activity, `semantic-index:${A}`).status, 'complete');
  f.config.searchIndex.status = 'prepared';
  assert.match(task(activity, `semantic-index:${A}`).detail, /Waiting for your confirmation/);
  f.config.styleLearning[A].preview.status = 'prepared';
  assert.equal(task(activity, `learning:${A}`).completed, null);
  f.config.styleLearning[A].preview.status = 'failed';
  assert.doesNotMatch(task(activity, `learning:${A}`).detail, /Analyzing/);
  delete f.config.mailAccounts[B];
  assert.ok(activity.snapshot().tasks.every(item => item.accountId === A));
});
