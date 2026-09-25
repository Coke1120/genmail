import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';
import { DEFAULT_POLICY, DEFAULT_PREFERENCES } from '../shared/features.js';

test('Settings renders connected IMAP, Google and Outlook with import and learning controls', async t => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  t.after(async () => { await vite.close(); delete globalThis.window; });
  globalThis.window = {};
  const { default: Settings } = await vite.ssrLoadModule('/src/Settings.jsx');
  for (const provider of ['imap', 'google', 'microsoft']) {
    const state = { account: { id: 'fixture@example.com', email: 'fixture@example.com', mode: 'live' }, accounts: [], workspace: { styleLearning: { settings: { enabled: false, weekly: false, months: 3, maxSamples: 50, tokenBudget: 16000 } } }, settings: { mail: { configured: true, provider }, ai: {}, preferences: DEFAULT_PREFERENCES, policy: DEFAULT_POLICY } };
    const html = renderToString(React.createElement(Settings, { state }));
    assert.match(html, /Learn my writing style/); assert.match(html, /History range/);
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
