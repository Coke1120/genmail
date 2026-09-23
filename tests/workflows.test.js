import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_BEHAVIORS } from '../shared/features.js';
import { createWorkflowPlan } from '../server/workflows.js';

const messages = [
  { id: 'one', fromName: 'Avery', fromEmail: 'avery@example.com', subject: 'Review the launch', body: 'Hi Alex, please confirm the launch review.', folder: 'inbox', read: false, starred: false, category: 'primary', labels: ['Work'] },
  { id: 'two', fromName: 'Avery', fromEmail: 'AVERY@example.com', subject: 'A newsletter', body: 'Your weekly newsletter.', folder: 'inbox', read: true, starred: false, category: 'newsletters', labels: [] },
  { id: 'three', fromName: 'Alex', fromEmail: 'alex@example.com', subject: 'My reply', body: 'Hi Avery, thanks for the thoughtful update.', folder: 'sent', read: true, starred: false, category: 'primary', labels: [] },
  { id: 'four', fromName: 'Archive', fromEmail: 'archive@example.com', subject: 'Old newsletter', body: 'An older update.', folder: 'archive', read: true, starred: false, category: 'newsletters', labels: [] },
];
const actions = AI_BEHAVIORS.filter(feature => feature.mock).map(feature => feature.id);
const now = new Date('2026-09-23T06:00:00Z');

test('every catalog workflow creates an immutable, local, serializable plan with unique targets', () => {
  const original = structuredClone(messages);
  for (const action of actions) {
    const plan = createWorkflowPlan(action, [...messages, messages[0]], { now });
    assert.ok(plan.title && plan.summary && plan.items.length, action);
    assert.deepEqual(JSON.parse(JSON.stringify(plan)), plan, action);
    assert.equal(new Set(plan.changes.map(change => change.messageId)).size, plan.changes.length, action);
    for (const change of plan.changes) {
      assert.ok(messages.some(message => message.id === change.messageId));
      assert.ok(Object.keys(change.patch).every(key => ['read', 'starred', 'category', 'labels', 'folder'].includes(key)));
      assert.notEqual(change.patch.folder, 'trash');
      if (change.patch.labels) assert.equal(new Set(change.patch.labels).size, change.patch.labels.length);
    }
    for (const collection of ['reminders', 'events', 'unsubscribed']) {
      for (const record of plan.records[collection] || []) {
        assert.ok(record.title && record.detail);
        if (record.when) assert.ok(Number.isFinite(new Date(record.when).getTime()));
      }
    }
    for (const draft of plan.records.drafts || []) assert.ok(draft.to && draft.subject && draft.body && draft.replyToId);
  }
  assert.deepEqual(messages, original);
  assert.throws(() => createWorkflowPlan('nonexistent', messages), /Unknown/);
  assert.throws(() => createWorkflowPlan('summary', messages), /Unknown/);
  assert.throws(() => createWorkflowPlan('research', []), /Select a permitted message/);
  for (const feature of AI_BEHAVIORS.filter(feature => feature.mock && feature.context === 'mailbox')) assert.ok(createWorkflowPlan(feature.id, [], { now }).items.length);
});

test('redacted fields stay unknown and simulated research and fixtures do not invent discoveries', () => {
  const redacted = messages.map(({ fromName, fromEmail, subject, body, ...message }) => message);
  for (const action of actions) {
    const plan = createWorkflowPlan(action, redacted, { now });
    const output = JSON.stringify(plan);
    for (const privateText of ['Avery', 'avery@example.com', 'Review the launch', 'thoughtful update', 'Old newsletter']) assert.equal(output.includes(privateText), false, action);
  }
  const brain = createWorkflowPlan('memory', redacted).records.brain;
  assert.deepEqual(brain.contacts, []);
  assert.match(brain.voice, /Unknown/);
  assert.deepEqual(createWorkflowPlan('batchReplies', redacted).records.drafts, []);
  assert.match(JSON.stringify(createWorkflowPlan('research', redacted)), /Unknown/);
  const fixtures = createWorkflowPlan('attachments', messages);
  assert.match(fixtures.summary, /Fictional.*not discovered/);
  assert.ok(fixtures.items.slice(0, 2).every(item => /Fictional fixture/.test(item.title) && /SAMPLE CONTENT/.test(item.detail)));
});

test('mock changes respect inbox boundaries, contact deduplication, draft limits, and local dates', () => {
  const cleanup = createWorkflowPlan('cleanup', messages);
  assert.deepEqual(cleanup.changes, [{ messageId: 'two', patch: { folder: 'archive' } }]);
  const triage = createWorkflowPlan('triage', messages);
  assert.deepEqual(triage.changes, [{ messageId: 'one', patch: { starred: true } }]);
  const labels = createWorkflowPlan('labels', [{ ...messages[0], labels: ['Work', 'Follow up'] }]);
  assert.deepEqual(labels.changes, []);
  const brain = createWorkflowPlan('memory', messages).records.brain;
  assert.equal(brain.contacts.length, 3);
  assert.match(brain.voice, /1 permitted message/);
  assert.match(createWorkflowPlan('memory', [messages[0]]).records.brain.voice, /Unknown/);
  const many = Array.from({ length: 8 }, (_, index) => ({ ...messages[0], id: `message-${index}`, fromEmail: `person${index}@example.com` }));
  const drafts = createWorkflowPlan('batchReplies', [...many, many[0]]).records.drafts;
  assert.equal(drafts.length, 5);
  assert.equal(new Set(drafts.map(draft => draft.replyToId)).size, 5);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  assert.equal(createWorkflowPlan('followup', messages, { now }).records.reminders[0].when, tomorrow.toISOString());
  const when = '2026-10-01T14:00:00+08:00';
  const event = createWorkflowPlan('schedule', messages, { when, now }).records.events[0];
  assert.equal(event.when, new Date(when).toISOString());
  assert.match(event.detail, /availability are unconfirmed/);
  assert.throws(() => createWorkflowPlan('schedule', messages, { when: 'invalid' }), /valid.*date/);
});
