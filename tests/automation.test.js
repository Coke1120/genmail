import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createStore } from '../server/store.js';
import { createAutomation, summaryDue } from '../server/automation.js';
import { updatePolicy, updatePreferences } from '../server/policy.js';
import { prioritySummary } from '../server/summaries.js';

const daily = { cadence: 'daily', time: '09:00', timeZone: 'Asia/Hong_Kong', everyHours: 4 };
const timestamp = value => Date.parse(value);
test('summary schedules validate and run once across time zones, DST, restarts and clock changes', () => {
  for (const summarySchedule of [null, [], { cadence: 'minute' }, { time: '24:00' }, { time: '9:00' }, { everyHours: 0 }, { everyHours: 1.5 }, { everyHours: 169 }, { timeZone: 'Invalid/Zone' }, { unknown: true }]) assert.throws(() => updatePolicy({}, { summarySchedule }), { status: 400 });
  assert.deepEqual(updatePolicy({}, { summarySchedule: daily }).summarySchedule, daily);
  assert.equal(updatePreferences({}, { syncInterval: 1, language: '繁體中文', translationLanguage: '日本語' }).translationLanguage, '日本語');
  assert.throws(() => updatePreferences({}, { translationLanguage: 'a'.repeat(61) }), { status: 400 });
  assert.equal(summaryDue(daily, {}, timestamp('2026-09-24T00:59:59Z')).due, false);
  const run = summaryDue(daily, {}, timestamp('2026-09-24T01:00:00Z'));
  assert.equal(run.due, true);
  const done = { ...run.state, day: run.day };
  assert.equal(summaryDue(daily, done, timestamp('2026-09-24T23:00:00Z')).due, false);
  assert.equal(summaryDue(daily, done, timestamp('2026-09-25T01:00:00Z')).due, true);
  assert.equal(summaryDue(daily, done, timestamp('2026-09-23T02:00:00Z')).due, false);
  const dst = { ...daily, timeZone: 'America/New_York', time: '01:30' };
  const first = summaryDue(dst, {}, timestamp('2026-11-01T05:30:00Z'));
  assert.equal(first.due, true);
  assert.equal(summaryDue(dst, { ...first.state, day: first.day }, timestamp('2026-11-01T06:30:00Z')).due, false);
  assert.equal(summaryDue({ ...dst, time: '02:30' }, {}, timestamp('2026-03-08T07:00:00Z')).due, true);
  const interval = { ...daily, cadence: 'interval' }, anchor = summaryDue(interval, {}, 0);
  assert.equal(anchor.due, false);
  assert.equal(summaryDue(interval, anchor.state, 4 * 3600000 - 1).due, false);
  assert.equal(summaryDue(interval, JSON.parse(JSON.stringify(anchor.state)), 4 * 3600000).due, true);
  assert.equal(summaryDue(interval, anchor.state, -1).due, false);
  assert.equal(summaryDue({ ...interval, everyHours: 1 }, anchor.state, 4 * 3600000).due, false);
});

test('P0–P4 reports require exact source IDs and reject missing, duplicate or invented results', () => {
  const messages = [{ id: 'a' }, { id: 'b' }], items = [{ messageId: 'a', priority: 'P4', summary: 'A newsletter' }, { messageId: 'b', priority: 'P1', summary: 'Reply today' }];
  const result = prioritySummary(JSON.stringify({ items }), messages);
  assert.equal(result.items[0].priority, 'P1');
  assert.match(result.text, /P0 \(0\)/);
  assert.match(result.text, /P4 \(1\)/);
  for (const value of ['invalid', '{}', JSON.stringify({ items: [items[0]] }), JSON.stringify({ items: [items[0], items[0]] }), JSON.stringify({ items: [items[0], { ...items[1], messageId: 'outside' }] }), JSON.stringify({ items: [items[0], { ...items[1], priority: 'P5' }] })]) assert.throws(() => prioritySummary(value, messages), { status: 502 });
});

function fixture(t, generate = async (account, kind, ids) => ({ text: account, items: ids.map(messageId => ({ messageId, priority: 'P2', summary: account })), source: 'model' })) {
  const directory = mkdtempSync(`${tmpdir()}/morrow-automation-`), store = createStore(directory);
  let now = timestamp('2026-09-24T01:00:00Z'), syncs = 0;
  store.setSettings({ mailAccounts: Object.fromEntries(['a@example.com', 'b@example.com'].map(email => [email, { email, connectionId: email }])), policy: updatePolicy({}, { triggers: { onArrival: true, scheduledSummary: true }, summarySchedule: daily }) });
  for (const account of Object.keys(store.getSettings().mailAccounts)) store.upsertMessage(account, { ...store.getMessage('demo', 'demo-1'), id: 'same-id', folder: 'inbox', subject: account });
  const options = { store, accounts: () => Object.keys(store.getSettings().mailAccounts), connection: account => store.getSettings().mailAccounts[account], generate, now: () => now, sync: async () => { syncs++; } };
  let automation = createAutomation(options);
  t.after(() => { automation.stop(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { store, get automation() { return automation; }, restart() { automation.stop(); automation = createAutomation(options); }, advance: milliseconds => { now += milliseconds; }, get syncs() { return syncs; } };
}

test('scheduled summaries stay account-bound, persist once-only execution, and poll centrally', async t => {
  const f = fixture(t);
  f.store.setSettings({ preferences: { syncInterval: 1 } });
  await f.automation.tick();
  for (const account of ['a@example.com', 'b@example.com']) {
    const [report] = f.automation.reports(account);
    assert.equal(report.status, 'completed'); assert.equal(report.text, account);
  }
  assert.deepEqual(f.automation.reports('all'), []);
  assert.deepEqual(f.automation.reports('demo'), []);
  f.restart(); await f.automation.tick();
  assert.equal(f.automation.reports('a@example.com').length, 1);
  f.advance(60000); await f.automation.tick(); assert.equal(f.syncs, 1);
  f.advance(86400000); await f.automation.tick(); assert.equal(f.automation.reports('a@example.com').length, 2);
  f.store.setSettings({ policy: updatePolicy(f.store.getSettings().policy, { content: { body: false } }) });
  assert.deepEqual(f.automation.reports('a@example.com'), []);
});

test('arrival jobs enforce filters and discard in-flight results when content or access changes', async t => {
  let release, begin;
  const started = new Promise(resolve => { begin = resolve; });
  const f = fixture(t, async () => { begin(); await new Promise(resolve => { release = resolve; }); return { text: 'must be discarded' }; });
  f.store.setSettings({ policy: updatePolicy(f.store.getSettings().policy, { triggers: { scheduledSummary: false, starredOnly: true } }) });
  f.store.updateMessage('a@example.com', 'same-id', { starred: false });
  f.automation.arrivals('a@example.com', ['same-id']); assert.deepEqual(f.automation.reports('a@example.com'), []);
  f.store.updateMessage('a@example.com', 'same-id', { starred: true });
  f.automation.arrivals('a@example.com', ['same-id']);
  const pending = f.automation.tick(); await started;
  assert.equal(f.store.getSettings().automation['a@example.com'].jobs[0].status, 'running');
  f.store.updateMessage('a@example.com', 'same-id', { body: 'Changed during request' });
  release(); await pending;
  assert.equal(f.store.getSettings().automation['a@example.com'].jobs[0].status, 'skipped');
  assert.deepEqual(f.automation.reports('a@example.com'), []);
});

test('claimed jobs survive interruption without retry and queue overflow is visible', async t => {
  let calls = 0;
  const f = fixture(t, async () => { calls++; return { text: 'ok' }; });
  f.store.setSettings({ policy: updatePolicy(f.store.getSettings().policy, { triggers: { scheduledSummary: false } }) });
  f.automation.arrivals('a@example.com', ['same-id']);
  const state = f.store.getSettings().automation;
  state['a@example.com'].jobs[0].status = 'running'; f.store.setSettings({ automation: state });
  f.restart(); await f.automation.tick();
  assert.equal(calls, 0); assert.equal(f.automation.reports('a@example.com')[0].status, 'interrupted');
  for (let n = 0; n < 101; n++) {
    const id = `arrival-${n}`;
    f.store.upsertMessage('a@example.com', { ...f.store.getMessage('a@example.com', 'same-id'), id });
    f.automation.arrivals('a@example.com', [id]);
  }
  assert.equal(f.automation.overflow('a@example.com'), 1);
  assert.equal(f.store.getSettings().automation['a@example.com'].jobs.filter(job => job.status === 'queued').length, 100);
  await f.automation.tick(); assert.equal(calls, 4);
  for (let n = 0; n < 25; n++) await f.automation.tick();
  assert.equal(calls, 100);
  assert.equal(f.store.getSettings().automation['a@example.com'].jobs.length, 20);
});

test('pending automation is invalidated by permission, model or connection changes; failures never auto-retry', async t => {
  for (const change of ['permission', 'model', 'connection']) {
    let release, begin;
    const started = new Promise(resolve => { begin = resolve; });
    const f = fixture(t, async () => { begin(); await new Promise(resolve => { release = resolve; }); return { text: 'discard me' }; });
    f.store.setSettings({ policy: updatePolicy(f.store.getSettings().policy, { triggers: { scheduledSummary: false } }) });
    f.automation.arrivals('a@example.com', ['same-id']);
    const pending = f.automation.tick(); await started;
    if (change === 'permission') f.store.setSettings({ policy: updatePolicy(f.store.getSettings().policy, { enabled: false }) });
    if (change === 'model') f.store.setSettings({ ai: { model: 'different' } });
    if (change === 'connection') f.store.setSettings({ mailAccounts: { ...f.store.getSettings().mailAccounts, 'a@example.com': { email: 'a@example.com', connectionId: 'reconnected' } } });
    release(); await pending;
    assert.equal(f.store.getSettings().automation['a@example.com'].jobs[0].status, 'skipped');
    assert.deepEqual(f.automation.reports('a@example.com'), []);
  }
  let calls = 0;
  const f = fixture(t, async () => { calls++; throw Error('private model failure'); });
  f.store.setSettings({ policy: updatePolicy(f.store.getSettings().policy, { triggers: { scheduledSummary: false } }) });
  f.automation.arrivals('a@example.com', ['same-id']); await f.automation.tick(); await f.automation.tick(); f.restart(); await f.automation.tick();
  assert.equal(calls, 1); assert.equal(f.automation.reports('a@example.com')[0].status, 'failed');
  assert.doesNotMatch(JSON.stringify(f.automation.reports('a@example.com')), /private model failure/);
});
