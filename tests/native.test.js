import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../server/native.js', import.meta.url));
test('native service requires its private token, shares feature policy, and shuts down with its parent pipe', { timeout: 15_000 }, async () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'morrow-native-'));
  const token = randomBytes(32).toString('hex');
  const child = spawn(process.execPath, [entry], { stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = once(child, 'exit');
  try {
    const lines = createInterface({ input: child.stdout });
    const ready = once(lines, 'line');
    child.stdin.write(JSON.stringify({ token, dataDirectory }) + '\n');
    const [line] = await ready;
    const { port } = JSON.parse(line);
    const base = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(`${base}/api/state`)).status, 401);
    assert.equal((await fetch(`${base}/api/state`, { headers: { Authorization: 'Bearer incorrect' } })).status, 401);
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Genmail-Account': 'demo' };
    const state = await (await fetch(`${base}/api/state`, { headers })).json();
    assert.equal(state.features.length, 19);
    assert.ok(state.messages.length > 0);
    assert.equal(state.account.mode, 'demo');
    const settings = await fetch(`${base}/api/settings/policy`, { headers, method: 'POST', body: JSON.stringify({ behaviors: { summary: false } }) });
    assert.equal(settings.status, 200);
    assert.equal((await fetch(`${base}/api/ai`, { headers, method: 'POST', body: JSON.stringify({ action: 'summary', messageId: state.messages[0].id }) })).status, 403);
    const callback = await fetch(`${base}/?calendarError=%3Cscript%3Ealert(1)%3C/script%3E`);
    assert.match(await callback.text(), /Connection was not completed/);
    assert.match(callback.headers.get('content-security-policy'), /default-src 'none'/);
    assert.equal((await fetch(`${base}/api/oauth/google/authorize?state=unissued`)).status, 400);
    const untrusted = await fetch(`${base}/api/state`, { headers: { ...headers, Origin: 'https://untrusted.example' } });
    assert.equal(untrusted.status, 403);
    child.stdin.end();
    const [code] = await closed;
    assert.equal(code, 0);
  } finally {
    child.kill();
    await closed;
    rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test('native service rejects invalid startup configuration without creating a workspace', { timeout: 5000 }, async () => {
  const child = spawn(process.execPath, [entry], { stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  child.stdin.end(JSON.stringify({ token: 'short', dataDirectory: '/tmp/invalid-morrow' }) + '\n');
  const [code] = await exited;
  assert.equal(code, 1);
});
