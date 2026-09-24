import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('unsigned publisher accepts matching alpha/beta tags but never stable or mismatched tags', t => {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-release-check-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const script = fileURLToPath(new URL('../scripts/publish-release.js', import.meta.url));
  for (const [version, tag, allowed] of [
    ['0.5.0-alpha.1', 'v0.5.0-alpha.1', true], ['0.5.0-beta.1', 'v0.5.0-beta.1', true],
    ['0.5.0', 'v0.5.0', false], ['0.5.0-rc.1', 'v0.5.0-rc.1', false],
    ['0.5.0-beta.1', 'v0.5.0-beta.2', false],
  ]) {
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ version }));
    const result = spawnSync(process.execPath, [script], { cwd: directory, env: { ...process.env, GITHUB_REF_NAME: tag }, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 1);
    // The empty workspace stops allowed tags at the artifact check, before any GitHub operation.
    assert.match(result.stderr, allowed ? /ENOENT.*release-artifacts/ : /Unsigned releases require an alpha or beta tag exactly matching package.json/);
  }
});
