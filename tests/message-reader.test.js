import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';
import { normalizeGoogleMessage, normalizeMicrosoftMessage } from '../server/providers.js';
import { redactMessage, resolvePolicy } from '../server/policy.js';
import { messageSummary } from '../server/mail-pages.js';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('HTML survives provider normalization only as sanitized reader content; lists and AI exclude it', async () => {
  const raw = '<p>Hello <b>reader</b> <a href="https://example.invalid/read">Read more</a><img src="https://example.invalid/pixel"><script>secret()</script></p>';
  const google = await normalizeGoogleMessage({ id: 'g', payload: { mimeType: 'text/html', body: { data: Buffer.from(raw).toString('base64url') } } });
  const outlook = await normalizeMicrosoftMessage({ id: 'm', body: { contentType: 'html', content: raw } });
  for (const message of [google, outlook]) {
    assert.match(message.bodyHtml, /<b>reader<\/b>/);
    assert.match(message.bodyHtml, /https:\/\/example.invalid\/pixel/);
    assert.doesNotMatch(message.bodyHtml, /script|secret\(/);
    assert.match(message.body, /Hello reader/);
    assert.equal(messageSummary(message).bodyHtml, undefined);
    assert.equal(redactMessage(message, resolvePolicy()).bodyHtml, undefined);
  }
});

test('email reader isolates HTML, blocks images by default and validates external link protocols', async t => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  t.after(() => vite.close());
  const { default: MessageBody, emailDocument, safeMailLink } = await vite.ssrLoadModule('/src/MessageBody.jsx');
  for (const link of ['javascript:alert(1)', 'file:///tmp/secret', 'data:text/html,bad', 'https://user:secret@example.invalid', '/api/state']) assert.equal(safeMailLink(link), '');
  assert.equal(safeMailLink('https://example.invalid/read'), 'https://example.invalid/read');
  assert.match(emailDocument('<p>Mail</p>'), /img-src 'none'/);
  assert.match(emailDocument('<p>Mail</p>', true), /img-src https:/);
  assert.match(emailDocument(''), /script-src 'none'.*connect-src 'none'.*form-action 'none'/);
  const html = renderToString(React.createElement(MessageBody, { message: { body: 'text', bodyHtml: '<img src="https://example.invalid/pixel">' } }));
  assert.match(html, /sandbox="allow-same-origin"/);
  assert.doesNotMatch(html, /allow-scripts|allow-forms|allow-top-navigation/);
  assert.match(html, /referrerPolicy="no-referrer"/);
  assert.match(html, /External images blocked/);
});

test('desktop layout persists only the narrow layout values', () => {
  const { clientState } = createRequire(import.meta.url)('../desktop/client-state.cjs');
  const directory = mkdtempSync(join(tmpdir(), 'morrow-layout-')), file = join(directory, 'state.json');
  try {
    for (const value of ['right', 'bottom', 'focus']) {
      clientState(file, 'set', 'morrow.mail.layout', value);
      assert.equal(clientState(file, 'get', 'morrow.mail.layout'), value);
    }
    assert.throws(() => clientState(file, 'set', 'morrow.mail.layout', 'arbitrary'));
    assert.throws(() => clientState(file, 'set', 'morrow.unrestricted', 'value'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
