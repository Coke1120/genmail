import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('activity UI distinguishes work, attention and stale status without implying a complete mailbox', async t => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  t.after(() => vite.close());
  const { default: ActivityStatus } = await vite.ssrLoadModule('/src/ActivityStatus.jsx');
  const render = props => renderToStaticMarkup(React.createElement(ActivityStatus, props));
  const checkedAt = '2026-09-27T09:00:00.000Z';
  const tasks = [
    { id: 'sync', kind: 'sync', accountId: 'one@example.invalid', status: 'running', label: 'Fetching Gmail', detail: 'Reading Sent and custom labels', completed: 12, updatedAt: checkedAt },
    { id: 'ai', kind: 'ai', accountId: 'two@example.invalid', status: 'running', label: 'Summarizing arrivals', detail: 'Waiting for model response', updatedAt: checkedAt },
    { id: 'index', kind: 'index', accountId: 'two@example.invalid', status: 'queued', completed: 0, total: 20 },
    { id: 'learning', kind: 'learning', accountId: 'one@example.invalid', status: 'paused', detail: 'Permission changed' },
    { id: 'import', kind: 'import', accountId: 'one@example.invalid', status: 'failed', error: '<script>unsafe()</script>', detail: 'Last 3 months; Inbox and Sent', body: 'DO NOT RENDER', apiKey: 'DO NOT RENDER' },
  ];
  const html = render({ value: { tasks, checkedAt }, onOpenSettings() {} });
  assert.match(html, /Fetching mail · 1 \/ AI · 1 \/ Queued · 1 \/ Needs attention · 2/);
  assert.match(html, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(html, /settings-spinner/);
  assert.match(html, /<details[^>]*aria-label="Mail and AI activity"/);
  for (const text of ['one@example.invalid', 'two@example.invalid', 'Waiting for model response', 'Reading Sent and custom labels', '12 completed · Total not yet known', '0 / 20', 'Permission changed', 'Last 3 months; Inbox and Sent', 'Last checked', 'Updated', 'Import settings']) assert.ok(html.includes(text), text);
  assert.match(html, /&lt;script&gt;unsafe\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /DO NOT RENDER|<script>|role="progressbar"|NaN|%/);
  const idle = render({ value: { tasks: [], checkedAt } });
  assert.match(idle, /No work in progress/);
  assert.match(idle, /Idle does not mean your entire mailbox is downloaded/);
  assert.match(idle, /only downloaded mail; history is limited to your selected import range/);
  assert.doesNotMatch(idle, /Import settings|settings-spinner/);
  assert.match(render({}), /Checking activity…/);
  const stale = render({ value: { tasks, checkedAt }, error: 'Cannot reach the local service.' });
  assert.match(stale, /Activity unavailable · Showing last known status/);
  assert.match(stale, /Cannot reach the local service/);
  assert.doesNotMatch(stale, /settings-spinner/);
  for (const status of ['complete', 'completed', 'interrupted']) {
    const result = render({ value: { tasks: [{ id: 'task', kind: 'index', status, completed: -1, total: null, updatedAt: 'invalid' }] } });
    assert.match(result, status === 'interrupted' ? /Needs attention · 1/ : /No work in progress/);
    assert.match(result, status === 'interrupted' ? /Interrupted/ : /Completed/);
    assert.doesNotMatch(result, />-1[ <]|Invalid Date|Total |settings-spinner/);
  }
  assert.match(render({ value: { tasks: [{ kind: 'import', status: 'queued', total: 50 }] } }), /Total 50 · Progress not yet known/);
});
