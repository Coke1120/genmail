import test from 'node:test';
import assert from 'node:assert/strict';
import { checkUpdates, currentVersion } from '../server/updates.js';

const release = (tag_name, extra = {}) => ({ tag_name, draft: false, prerelease: tag_name.includes('-'), html_url: 'https://untrusted.invalid', ...extra });
const response = releases => async (url, options) => {
  assert.equal(url, 'https://api.github.com/repos/Coke1120/genmail/releases?per_page=100');
  assert.equal(options.redirect, 'error');
  assert.equal(options.headers.Authorization, undefined);
  assert.ok(options.signal instanceof AbortSignal);
  return { ok: true, status: 200, json: async () => releases };
};

test('GitHub release checks compare semantic versions and filter drafts and release channels', async () => {
  const releases = [release('v0.4.0-alpha.2'), release('v0.3.0'), release('v0.4.0-alpha.10'), release('v9.0.0', { draft: true }), release('not-a-version')];
  const options = { installed: '0.4.0-alpha.2', fetchImpl: response(releases) };
  const alpha = await checkUpdates({ ...options, includePrereleases: true });
  assert.equal(alpha.latestVersion, '0.4.0-alpha.10');
  assert.equal(alpha.updateAvailable, true);
  assert.equal(alpha.prerelease, true);
  assert.equal(alpha.url, 'https://github.com/Coke1120/genmail/releases/tag/v0.4.0-alpha.10');
  assert.ok(Number.isFinite(Date.parse(alpha.checkedAt)));
  const stable = await checkUpdates(options);
  assert.equal(stable.latestVersion, '0.3.0');
  assert.equal(stable.updateAvailable, false);
  for (const [installed, tag, expected] of [
    ['1.0.0-alpha.9', 'v1.0.0-alpha.10', true], ['1.0.0-alpha', '1.0.0-alpha.1', true],
    ['1.0.0-beta', '1.0.0', true], ['1.0.0', '1.0.0-beta', false],
    ['1.0.0-2', '1.0.0-alpha', true], ['1.9.0', '1.10.0', true],
    ['2.0.0', '1.99.0', false], ['1.0.0+local', 'v1.0.0+release', false],
    [currentVersion, 'v' + currentVersion, false],
  ]) assert.equal((await checkUpdates({ installed, includePrereleases: true, fetchImpl: response([release(tag)]) })).updateAvailable, expected, `${installed} -> ${tag}`);
});

test('failed, malformed and empty update checks never report up-to-date', async () => {
  for (const fetchImpl of [async () => { throw Error('offline'); }, async () => ({ ok: false, status: 500 }), response({}), async () => ({ ok: true, json: async () => { throw Error('bad JSON'); } })]) {
    await assert.rejects(checkUpdates({ fetchImpl }), { status: 502 });
  }
  for (const status of [403, 429]) await assert.rejects(checkUpdates({ fetchImpl: async () => ({ ok: false, status }) }), { status: 503 });
  for (const releases of [[], [release('v1.0.0-alpha.1')], [release('v1.0.0-01')], [release('v01.0.0')], [release('v2.0.0', { draft: true })]]) {
    await assert.rejects(checkUpdates({ fetchImpl: response(releases) }), { status: 404 });
  }
});
