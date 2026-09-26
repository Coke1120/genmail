import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
if (process.platform !== 'darwin') throw new Error('Native reader acceptance requires macOS.');
const directory = mkdtempSync(join(tmpdir(), 'morrow-reader-'));
let requests = 0;
const server = createServer((_request, response) => { requests++; response.end('blocked content'); });
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const binary = join(directory, 'reader-check');
  execFileSync('swiftc', ['-parse-as-library', 'macos/Sources/MorrowMail/Models.swift', 'macos/Sources/MorrowMail/MessageBodyView.swift', 'macos/Checks/MessageHTML.swift', '-o', binary], { stdio: 'inherit' });
  await new Promise((resolve, reject) => {
    const child = spawn(binary, [String(server.address().port)], { stdio: 'inherit' });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Reader check timed out')); }, 30_000);
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Reader check exited ${code}`)); });
  });
  assert.equal(requests, 0, 'Email triggered an unsolicited network request');
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  rmSync(directory, { recursive: true, force: true });
}
