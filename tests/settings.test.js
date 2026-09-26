import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_POLICY, DEFAULT_PREFERENCES } from '../shared/features.js';
import { createStore } from '../server/store.js';
import { createSmartSearch } from '../server/smart-search.js';
import { updatePreferences } from '../server/policy.js';

test('Settings renders connected IMAP, Google and Outlook with import and learning controls', async t => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  t.after(async () => { await vite.close(); delete globalThis.window; });
  globalThis.window = {};
  const { default: Settings } = await vite.ssrLoadModule('/src/Settings.jsx');
  for (const provider of ['imap', 'google', 'microsoft']) {
    const state = { account: { id: 'fixture@example.com', email: 'fixture@example.com', mode: 'live' }, accounts: [], workspace: { styleLearning: { settings: { enabled: false, weekly: false, months: 3, maxSamples: 50, tokenBudget: 16000 } } }, settings: { mail: { configured: true, provider }, ai: {}, preferences: DEFAULT_PREFERENCES, policy: DEFAULT_POLICY } };
    const html = renderToString(React.createElement(Settings, { state }));
    assert.match(html, /Learn my writing style/); assert.match(html, /History range/);
    assert.match(html, /Preferences saved automatically/); assert.doesNotMatch(html, /Save preferences/i);
    assert.match(html, /Save model/); assert.match(html, /Save permissions/);
    const searchPanel = html.slice(html.indexOf('id="settings-panel-search"'), html.indexOf('id="settings-panel-learning"'));
    const modelPanel = html.slice(html.indexOf('id="settings-panel-model"'), html.indexOf('id="settings-panel-policy"'));
    assert.match(searchPanel, /Loading search settings/); assert.doesNotMatch(searchPanel, /Loading embedding settings/);
    assert.match(modelPanel, /Loading embedding settings/); assert.doesNotMatch(modelPanel, /Loading search settings/);
    if (provider === 'imap') assert.doesNotMatch(html, /Allow moving mail and managing labels/);
    else {
      assert.match(html, new RegExp(`Sign in with ${provider === 'google' ? 'Google' : 'Microsoft'} in browser`));
      assert.match(html, /Do not open this URL to sign in/);
      assert.match(html, /<details[^>]*><summary>Advanced: callback URL/);
    }
    if (provider !== 'imap') {
      state.settings.oauthClients = { [provider]: { configured: true } };
      const builtIn = renderToString(React.createElement(Settings, { state }));
      assert.match(builtIn, /No client ID or secret is needed/);
      assert.match(builtIn, new RegExp(`Use my own (?:<!-- -->)?${provider === 'google' ? 'Google' : 'Microsoft'}(?:<!-- -->)? OAuth client`));
      assert.doesNotMatch(builtIn, /placeholder="Your Microsoft application \(client\) ID"|placeholder="Your Google OAuth client ID"|placeholder="Your Google desktop app client secret"|Register your own OAuth app first/);
    }
  }
});

test('Search and Model save only their visible fields and preserve embedding key semantics across stale panels', async t => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  const directory = mkdtempSync(join(tmpdir(), 'morrow-settings-')), store = createStore(directory);
  t.after(async () => { store.close(); rmSync(directory, { recursive: true, force: true }); await vite.close(); });
  const { editableSearchSettings } = await vite.ssrLoadModule('/src/SearchSettings.jsx');
  const account = 'settings@example.com';
  store.setSettings({ mailAccounts: { [account]: { email: account } } });
  const smart = createSmartSearch({ store, connections: () => store.getSettings().mailAccounts, apiBase: value => value });
  smart.update({ enabled: true, model: 'original', apiKey: 'fixture-key', accounts: [account] });
  const search = editableSearchSettings(smart.state()), model = editableSearchSettings(smart.state(), 'model');
  assert.deepEqual(Object.keys(search).sort(), ['accounts', 'content', 'enabled', 'folders', 'months', 'tokenBudget']);
  assert.deepEqual(Object.keys(model).sort(), ['apiKey', 'baseUrl', 'clearApiKey', 'model', 'protocol']);
  assert.equal(model.apiKey, ''); assert.equal(model.clearApiKey, false);

  smart.update({ ...model, model: 'updated', protocol: 'ollama', baseUrl: 'https://embedding.example', apiKey: 'new-fixture-key' });
  smart.update({ ...search, months: 6, tokenBudget: 32000, content: { ...search.content, sender: true } });
  assert.equal(smart.state().settings.model, 'updated');
  assert.equal(smart.state().settings.protocol, 'ollama');
  assert.equal(smart.state().settings.baseUrl, 'https://embedding.example');
  assert.equal(store.getSettings().searchAI.apiKey, 'new-fixture-key');

  const embedding = editableSearchSettings(smart.state(), 'model');
  smart.update({ tokenBudget: 64000, months: 12 });
  smart.update({ ...embedding, model: 'another-model' });
  assert.equal(smart.state().settings.months, 12); assert.equal(smart.state().settings.tokenBudget, 64000);
  assert.equal(smart.state().settings.content.sender, true);
  assert.equal(store.getSettings().searchAI.apiKey, 'new-fixture-key');
  smart.update({ ...embedding, clearApiKey: true });
  assert.equal(smart.state().settings.hasApiKey, false);
  smart.update({ ...embedding, apiKey: 'replacement-fixture-key' });
  smart.update({ ...embedding, baseUrl: 'https://different.example' });
  assert.equal(smart.state().settings.hasApiKey, false);
});

test('General autosave sends only changed preferences and retains concurrent sort, footer and explicit settings', async t => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  const directory = mkdtempSync(join(tmpdir(), 'morrow-autosave-')), store = createStore(directory);
  t.after(async () => { store.close(); rmSync(directory, { recursive: true, force: true }); await vite.close(); });
  const { preferencePatch } = await vite.ssrLoadModule('/src/Settings.jsx');
  const baseline = { ...DEFAULT_PREFERENCES };
  store.setSettings({ preferences: baseline, ai: { model: 'explicit-model', apiKey: 'fixture-only-key' }, policy: DEFAULT_POLICY });
  const draft = { ...baseline, displayName: 'Edited name', sort: 'oldest', apiKey: 'must-not-be-sent' };
  const patch = preferencePatch(draft, baseline);
  assert.deepEqual(patch, { displayName: 'Edited name' });
  assert.deepEqual(preferencePatch(baseline, baseline), {});

  // A mailbox sort and another footer write occur after the Settings form opens.
  store.setSettings({ preferences: updatePreferences(store.getSettings().preferences, { sort: 'sender', signature: 'Concurrent footer' }) });
  const before = store.getSettings();
  store.setSettings({ preferences: updatePreferences(before.preferences, patch) });
  const result = store.getSettings();
  assert.equal(result.preferences.displayName, 'Edited name');
  assert.equal(result.preferences.sort, 'sender');
  assert.equal(result.preferences.signature, 'Concurrent footer');
  assert.deepEqual(result.ai, before.ai); assert.deepEqual(result.policy, before.policy);

  const invalid = preferencePatch({ ...result.preferences, language: '' }, result.preferences);
  assert.throws(() => store.setSettings({ preferences: updatePreferences(store.getSettings().preferences, invalid) }), /language/);
  assert.deepEqual(store.getSettings().preferences, result.preferences);
  const corrected = preferencePatch({ ...result.preferences, language: '繁體中文' }, result.preferences);
  store.setSettings({ preferences: updatePreferences(store.getSettings().preferences, corrected) });
  assert.equal(store.getSettings().preferences.language, '繁體中文');
});

test('Autosave acknowledgement retains later edits, reversions and the complete unsaved footer pair', async t => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  t.after(() => vite.close());
  const { preferencePatch, acceptPreferences } = await vite.ssrLoadModule('/src/Settings.jsx');
  const baseline = { ...DEFAULT_PREFERENCES, displayName: 'Original', signature: 'Original footer' };
  const sent = { displayName: 'First edit' };
  const received = updatePreferences({ ...baseline, sort: 'sender' }, sent);
  for (const displayName of ['Later edit', 'Original']) {
    const current = { ...baseline, displayName, theme: 'dark' };
    const accepted = acceptPreferences(current, baseline, sent, received);
    assert.equal(accepted.value.displayName, displayName);
    assert.equal(accepted.value.sort, baseline.sort);
    assert.equal(accepted.value.theme, 'dark');
    assert.equal(accepted.baseline.displayName, 'First edit');
    const followup = preferencePatch(accepted.value, accepted.baseline);
    assert.deepEqual(followup, { displayName, theme: 'dark' });
    const saved = updatePreferences(received, followup);
    const final = acceptPreferences(accepted.value, accepted.baseline, followup, saved);
    assert.deepEqual(preferencePatch(final.value, final.baseline), {});
    assert.equal(current.displayName, displayName); assert.equal(baseline.displayName, 'Original');
  }

  const htmlDraft = { ...baseline, signatureFormat: 'html', signature: '<b>Hello</b><script>unsafe()</script>' };
  const footerPatch = preferencePatch(htmlDraft, baseline);
  assert.deepEqual(Object.keys(footerPatch).sort(), ['signature', 'signatureFormat']);
  const normalized = updatePreferences(baseline, footerPatch);
  assert.doesNotMatch(normalized.signature, /<script/i);
  const accepted = acceptPreferences(htmlDraft, baseline, footerPatch, normalized);
  assert.equal(accepted.value.signature, normalized.signature);
  assert.deepEqual(preferencePatch(accepted.value, accepted.baseline), {});
  // Format changes while the HTML request is pending: never pair normalized HTML with the new plain format.
  const newer = { ...htmlDraft, signatureFormat: 'plain' };
  const pending = acceptPreferences(newer, baseline, footerPatch, normalized);
  assert.equal(pending.value.signature, newer.signature);
  assert.equal(pending.value.signatureFormat, 'plain');
  assert.deepEqual(preferencePatch(pending.value, pending.baseline), { signature: newer.signature, signatureFormat: 'plain' });
});

test('Mail settings distinguish queued, retrying, stopped and completed imports with safe recovery actions', async t => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  t.after(async () => { await vite.close(); delete globalThis.window; });
  globalThis.window = {};
  const { default: Settings, importControl, importStatusLabel } = await vite.ssrLoadModule('/src/Settings.jsx');
  const base = { options: { months: 3 }, imported: 4, pages: null, processed: null, currentFolder: 'all' };
  const cases = [
    [null, /has not started/, null],
    [{ ...base, status: 'running', phase: 'queued' }, /queued.*waiting for the next page/, 'pause'],
    [{ ...base, status: 'running', phase: 'retrying', nextRetryAt: '2026-09-27T12:00:00Z', retryCount: 2, recoveryAction: 'retry' }, /waiting to retry/, 'pause'],
    [{ ...base, status: 'paused' }, /paused/, 'resume'],
    [{ ...base, status: 'failed' }, /stopped after an error/, 'resume'],
    [{ ...base, status: 'failed', recoveryAction: 'reconnect' }, /stopped after an error/, null],
    [{ ...base, status: 'failed', recoveryAction: 'restart', errorCode: 'sent_unavailable', error: 'This server does not identify a Sent folder. Choose Inbox only and start a new import.' }, /stopped after an error/, null],
    [{ ...base, status: 'complete', phase: 'complete', pages: 3, processed: 40 }, /range completed/, null],
  ];
  for (const [job, label, action] of cases) {
    assert.match(importStatusLabel(job), label); assert.equal(importControl(job), action);
    const account = { id: 'fixture@example.com', email: 'fixture@example.com', provider: 'google', import: job };
    const state = { account: { ...account, mode: 'live' }, accounts: [account], workspace: { styleLearning: { settings: { enabled: false, weekly: false, months: 3, maxSamples: 50, tokenBudget: 16000 } } }, settings: { mail: { provider: 'google', configured: true }, ai: {}, preferences: DEFAULT_PREFERENCES, policy: DEFAULT_POLICY } };
    const html = renderToString(React.createElement(Settings, { state, initialTab: 'mail' }));
    const mail = html.slice(html.indexOf('id="settings-panel-mail"'), html.indexOf('id="settings-panel-model"'));
    assert.match(mail, label);
    if (action === 'resume') assert.match(mail, /Resume from checkpoint/); else assert.doesNotMatch(mail, /Resume from checkpoint/);
    if (action === 'pause') assert.match(mail, />Pause<\/button>/); else assert.doesNotMatch(mail, />Pause<\/button>/);
    if (job?.phase === 'retrying') assert.match(mail, /Next retry:/);
    if (job?.recoveryAction === 'reconnect') assert.match(mail, /Reconnect this account using the sign-in form below/);
    if (job?.errorCode === 'sent_unavailable') assert.match(mail, /Choose Inbox only/);
    if (job?.pages == null) assert.doesNotMatch(mail, /0 pages|0 checked/);
    else { assert.match(mail, /3 pages/); assert.match(mail, /40 checked/); }
  }
});
