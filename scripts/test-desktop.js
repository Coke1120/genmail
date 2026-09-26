import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createStore } from '../server/store.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const packaged = process.argv.includes('--packaged');
if (packaged && process.platform !== 'win32') throw new Error('The packaged desktop check requires Windows.');
const executable = packaged ? resolve(root, 'build/windows/Morrow Mail-win32-x64/Morrow Mail.exe') : (await import('electron')).default;
if (!existsSync(executable)) throw new Error('Build the app before its packaged smoke test.');
async function run(workspace) {
  await new Promise((accept, reject) => {
    const child = spawn(executable, [...(packaged ? [] : [resolve(root, 'desktop/main.cjs')]), '--smoke-test'], { cwd: root, env: { ...process.env, MORROW_NODE_BINARY: process.execPath, MORROW_SMOKE_WORKSPACE: workspace }, stdio: 'inherit' });
    let expired = false;
    const timer = setTimeout(() => { expired = true; child.kill(); }, 90_000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); code === 0 && !expired ? accept() : reject(new Error(expired ? 'Desktop smoke timed out.' : `Desktop smoke exited ${code}.`)); });
  });
}
for (const seeded of [false, true]) {
  const workspace = mkdtempSync(join(tmpdir(), 'morrow-desktop-check-'));
  try {
    if (seeded) {
      // Seed outside the packaged app, before its exclusive Rust writer starts.
      const store = createStore(workspace), owner = 'smoke@fixture.invalid';
      try {
        const connection = { provider: 'imap', email: owner, password: 'fixture', imapHost: 'fixture.invalid', imapPort: 993, smtpHost: 'fixture.invalid', smtpPort: 465 };
        store.setSettings({ mailAccounts: { [owner]: connection }, mail: connection, activeAccount: owner, preferences: { syncInterval: 0, markReadOnOpen: true }, policy: { enabled: false }, ai: null, smartSearch: { enabled: false } });
        for (const message of store.listMessages('demo')) store.upsertMessage(owner, { ...message, to: owner });
      } finally { store.close(); }
    }
    writeFileSync(join(workspace, 'disposable-smoke-fixture'), 'Morrow desktop acceptance fixture');
    await run(workspace);
    console.log(`Desktop smoke exited: ${seeded ? 'owned mailbox' : 'fresh onboarding'}.`);
  } finally {
    // Windows keeps Chromium files open until the entire desktop process exits.
    rmSync(workspace, { recursive: true, force: true, maxRetries: 5 });
  }
}
