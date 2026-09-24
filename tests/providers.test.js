import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { simpleParser } from 'mailparser';
import { oauthStart, oauthFinish, refreshMail, normalizeGoogleMessage, normalizeMicrosoftMessage, fetchProviderMessages, sendProviderMessage } from '../server/providers.js';

test('OAuth uses random state, PKCE, least-privilege scopes and keeps client secrets out of URLs', () => {
  for (const provider of ['google', 'microsoft']) {
    const result = oauthStart(provider, { clientId: 'client', clientSecret: 'private' }, `http://localhost:3001/api/oauth/${provider}/callback`);
    const params = new URL(result.url).searchParams;
    assert.equal(params.get('code_challenge'), createHash('sha256').update(result.verifier).digest('base64url'));
    assert.equal(params.get('code_challenge_method'), 'S256');
    assert.equal(params.get('state'), result.state);
    assert.ok(result.state.length >= 43);
    assert.notEqual(result.state, oauthStart(provider, { clientId: 'client' }, 'http://localhost').state);
    assert.doesNotMatch(result.url, /private|client_secret|gmail\.modify|Mail\.ReadWrite/);
    assert.match(params.get('scope'), provider === 'google' ? /gmail\.readonly.*gmail\.send/ : /offline_access.*Mail\.Read.*Mail\.Send/);
  }
  assert.throws(() => oauthStart('toString', { clientId: 'id' }, 'http://localhost'), /Unsupported/);
});

test('refresh rotates tokens without mutating settings and sanitizes remote errors', async t => {
  const mail = { provider: 'microsoft', clientId: 'client', refreshToken: 'secret', accessToken: 'expired', expiresAt: 0 };
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://login.microsoftonline.com/common/oauth2/v2.0/token');
    assert.equal(options.body.get('refresh_token'), 'secret');
    assert.equal(options.body.get('grant_type'), 'refresh_token');
    assert.equal(options.redirect, 'error');
    return new Response(JSON.stringify({ access_token: 'new-token', refresh_token: 'rotated', expires_in: 3600 }));
  });
  const updated = await refreshMail(mail);
  assert.equal(mail.accessToken, 'expired');
  assert.equal(updated.accessToken, 'new-token');
  assert.equal(updated.refreshToken, 'rotated');
  assert.ok(updated.expiresAt > Date.now() + 3_500_000);
  await refreshMail(updated);
  assert.equal(fetch.mock.callCount(), 1);
  fetch.mock.mockImplementation(async () => new Response('private token secret', { status: 400 }));
  await assert.rejects(refreshMail(mail), error => /HTTP 400/.test(error.message) && !/secret/.test(error.message));
  fetch.mock.mockImplementation(async () => { throw new Error('private secret'); });
  await assert.rejects(refreshMail(mail), error => /could not be reached/.test(error.message) && !/secret/.test(error.message));
});

test('OAuth code exchange resolves the mailbox profile', async t => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify(requests.length === 1
      ? { access_token: 'token', refresh_token: 'refresh', expires_in: 3600 }
      : { emailAddress: 'Person@Example.com' }));
  });
  const result = await oauthFinish('google', { code: 'code', verifier: 'a'.repeat(64), config: { clientId: 'client', clientSecret: 'secret' }, redirectUri: 'http://localhost/callback' });
  assert.equal(result.email, 'person@example.com');
  assert.equal(requests[0].options.body.get('code_verifier'), 'a'.repeat(64));
  assert.equal(requests[0].options.body.get('client_secret'), 'secret');
  assert.equal(requests[1].options.headers.Authorization, 'Bearer token');
});

test('normalization decodes MIME, prefers plain text, skips attachments, and safely converts HTML', async () => {
  const part = (mimeType, content, extra = {}) => ({ mimeType, body: { data: Buffer.from(content).toString('base64url') }, ...extra });
  const google = await normalizeGoogleMessage({ id: 'g1', internalDate: '1700000000000', labelIds: ['UNREAD', 'STARRED'], payload: {
    headers: [{ name: 'From', value: 'Alice <alice@example.com>' }, { name: 'To', value: 'me@example.com' }, { name: 'Subject', value: '=?UTF-8?B?SGVsbG8g4pyT?=' }, { name: 'Message-ID', value: '<one@example.com>' }, { name: 'List-Unsubscribe', value: '<https://example.com/unsubscribe>' }],
    parts: [part('text/html', '<b>wrong alternative</b>'), part('text/plain', 'Hi from plain text.'), part('text/plain', 'attachment secret', { filename: 'notes.txt' })],
  } });
  assert.equal(google.id, 'google:g1');
  assert.equal(google.fromEmail, 'alice@example.com');
  assert.equal(google.subject, 'Hello ✓');
  assert.equal(google.body, 'Hi from plain text.');
  assert.equal(google.messageId, '<one@example.com>');
  assert.equal(google.category, 'newsletters');
  assert.equal(google.read, false);
  assert.equal(google.starred, true);
  const microsoft = await normalizeMicrosoftMessage({ id: 'm1', subject: 'Receipt', body: { contentType: 'html', content: '<p>Hello &amp; welcome</p><script>secretScript()</script>' }, receivedDateTime: 'invalid' });
  assert.match(microsoft.body, /Hello & welcome/);
  assert.doesNotMatch(microsoft.body, /<p>|secretScript/);
  assert.equal(microsoft.category, 'updates');
  assert.equal(microsoft.date, '1970-01-01T00:00:00.000Z');
});

test('provider listing requests immutable Microsoft IDs and bounds Google detail concurrency', async t => {
  let active = 0;
  let maximum = 0;
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.includes('graph.microsoft.com')) {
      assert.match(options.headers.Prefer, /ImmutableId/);
      assert.match(options.headers.Prefer, /body-content-type="text"/);
      return new Response('{"value":[]}');
    }
    if (url.includes('maxResults')) return new Response(JSON.stringify({ messages: Array.from({ length: 12 }, (_, index) => ({ id: String(index) })) }));
    active++;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return new Response(JSON.stringify({ id: url.split('/messages/')[1].split('?')[0], payload: { headers: [] } }));
  });
  assert.deepEqual(await fetchProviderMessages({ provider: 'microsoft', accessToken: 'token' }), []);
  assert.equal((await fetchProviderMessages({ provider: 'google', accessToken: 'token' })).length, 12);
  assert.equal(maximum, 5);
  assert.equal(fetch.mock.callCount(), 14);
});

test('both native sending APIs encode Unicode and RFC reply headers without contacting a mailbox', async t => {
  let count = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    count++;
    const google = url.includes('gmail.googleapis.com');
    const raw = google ? Buffer.from(JSON.parse(options.body).raw, 'base64url') : Buffer.from(options.body, 'base64');
    const parsed = await simpleParser(raw);
    assert.equal(parsed.subject, 'Hello ✓');
    assert.equal(parsed.text.trim(), 'A reply for 你好.');
    assert.equal(parsed.to.value[0].address, 'to@example.com');
    assert.equal(parsed.inReplyTo, '<original@example.com>');
    assert.equal(options.method, 'POST');
    return new Response(google ? '{"id":"sent-id"}' : null, { status: google ? 200 : 202 });
  });
  for (const provider of ['google', 'microsoft']) {
    const result = await sendProviderMessage({ provider, email: 'me@example.com', accessToken: 'token' }, { to: 'to@example.com', subject: 'Hello ✓', body: 'A reply for 你好.', replyMessageId: '<original@example.com>' });
    assert.match(result.messageId, /^<.+>$/);
  }
  await assert.rejects(sendProviderMessage({ provider: 'google', email: 'me@example.com' }, { to: 'to@example.com\r\nBcc: victim@example.com', subject: 'Bad', body: 'Bad' }), /single line/);
  assert.equal(count, 2);
});

test('history pages use chosen folders and dates and reject foreign Graph continuation URLs', async t => {
  const { fetchProviderPage } = await import('../server/providers.js');
  const seen = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    seen.push({ url: new URL(url), options });
    return new Response(JSON.stringify(String(url).includes('googleapis') ? { messages: [], nextPageToken: 'opaque token' } : { value: [], '@odata.nextLink': 'https://attacker.invalid/leak' }));
  });
  const options = { folder: 'sent', since: '2026-06-24T12:00:00.000Z', before: '2026-09-24T12:00:00.000Z' };
  const google = await fetchProviderPage({ provider: 'google', accessToken: 'private' }, options);
  assert.equal(google.nextCursor, 'opaque token');
  assert.equal(seen[0].url.searchParams.get('labelIds'), 'SENT');
  assert.match(seen[0].url.searchParams.get('q'), /after:\d+ before:\d+/);
  await fetchProviderPage({ provider: 'google', accessToken: 'private' }, { ...options, cursor: google.nextCursor });
  assert.equal(seen[1].url.searchParams.get('pageToken'), 'opaque token');
  const graph = await fetchProviderPage({ provider: 'microsoft', accessToken: 'private' }, options);
  assert.equal(seen[2].url.pathname, '/v1.0/me/mailFolders/sentitems/messages');
  assert.match(seen[2].url.searchParams.get('$filter'), /^sentDateTime ge/);
  await assert.rejects(fetchProviderPage({ provider: 'microsoft', accessToken: 'private' }, { ...options, cursor: graph.nextCursor }), /Invalid mailbox pagination/);
  assert.equal(seen.length, 3);
});
