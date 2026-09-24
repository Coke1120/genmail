// Fictional data only. Each size gets a fresh process and temporary workspace.
import assert from 'node:assert/strict';
import { fork, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, cpus, platform, release } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createStore } from '../server/store.js';
import { createApp } from '../server/app.js';

const args = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')));
if (!args.child) {
  const sizes = (args.sizes || '1000,10000,50000').split(',').map(Number);
  assert(sizes.every(n => Number.isInteger(n) && n >= 100 && n <= 50000));
  const results = [];
  for (const size of sizes) results.push(await new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), [`--child=${size}`, `--engine=${args.engine || 'node'}`], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    let result;
    child.on('message', value => { result = value; });
    child.on('error', reject);
    child.on('exit', code => code === 0 && result ? resolve(result) : reject(Error(`Benchmark failed (${code}).`)));
  }));
  const report = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
    engine: args.engine || 'node', platform: platform(), os: release(), cpu: cpus()[0]?.model, node: process.version,
    fixture: 'mail-v1: two accounts, colliding IDs, mixed English/Chinese, 1 KiB bodies; no providers or models',
    processScope: 'Node service + in-process HTTP driver + Rust worker when enabled; excludes UI, parent harness and OS filesystem cold-cache guarantees. RSS is sampled, not whole-app acceptance.', results };
  const output = JSON.stringify(report, null, 2) + '\n';
  if (args.output) { mkdirSync(dirname(args.output), { recursive: true }); writeFileSync(args.output, output); }
  else process.stdout.write(output);
} else {
  const size = Number(args.child), directory = mkdtempSync(join(tmpdir(), 'morrow-benchmark-'));
  let store, server, app;
  const clock = () => performance.now(), accounts = ['alpha@example.invalid', 'beta@example.invalid'];
  try {
    let start = clock(); store = createStore(directory); const emptyOpenMs = clock() - start;
    store.setSettings({ activeAccount: 'all', mailAccounts: Object.fromEntries(accounts.map(email => [email, { email, provider: 'imap', connectionId: email }])), preferences: { syncInterval: 0 } });
    start = clock();
    store.transaction(() => {
      for (let i = 0; i < size; i++) store.upsertMessage(accounts[i % 2], { id: `fixture-${Math.floor(i / 2)}`, folder: i % 5 === 0 ? 'sent' : 'inbox',
        date: new Date(Date.UTC(2026, 0, 1) + Math.floor(i / 4) * 1000).toISOString(), fromName: `Sender ${i % 100}`, fromEmail: 'sender@example.invalid', to: accounts[i % 2],
        subject: i % 10 === 0 ? `發票 INV-${i}` : `Project update ${i}`, body: (i % 10 === 0 ? '請於本月付款。 Invoice payment. ' : 'Meeting notes and project timeline. ').padEnd(1024, 'x'),
        preview: 'Fictional benchmark mail', read: i % 3 !== 0, starred: i % 7 === 0, category: 'primary', labels: [] });
    });
    const seedAndIndexMs = clock() - start;
    store.close(); start = clock(); store = createStore(directory); const reopenMs = clock() - start;
    const counters = {};
    for (const name of ['getSettings', 'listMessages', 'getMessage']) {
      const original = store[name]; store[name] = (...args) => { const at = clock(); try { return original(...args); } finally { const entry = counters[name] ||= { calls: 0, ms: 0 }; entry.calls++; entry.ms += clock() - at; } };
    }
    const query = store.search.query; store.search.query = (...args) => { const at = clock(); try { return query(...args); } finally { const entry = counters.searchSQL ||= { calls: 0, ms: 0 }; entry.calls++; entry.ms += clock() - at; } };
    server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port, origin = `http://127.0.0.1:${port}`;
    app = createApp({ store, port, appUrl: origin, searchEngine: args.engine || 'node' }); server.on('request', app);
    const worker = app.locals.smartSearch.worker;
    if (worker) {
      const lexical = worker.lexical;
      worker.lexical = async (...args) => { const at = clock(); try { return await lexical(...args); } finally { const entry = counters.rustRoundTrip ||= { calls: 0, ms: 0 }; entry.calls++; entry.ms += clock() - at; } };
    }
    function workerRSS() {
      if (!worker?.pid) return 0;
      const output = process.platform === 'win32'
        ? execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${worker.pid}).WorkingSet64`], { encoding: 'utf8' })
        : execFileSync('ps', ['-o', 'rss=', '-p', String(worker.pid)], { encoding: 'utf8' });
      return Number(output.trim()) * (process.platform === 'win32' ? 1 : 1024);
    }
    async function measure(path, options = {}) {
      const samples = [], cpu = process.cpuUsage(); let bytes = 0, result, firstCounters;
      for (let i = 0; i < 6; i++) {
        for (const key of Object.keys(counters)) delete counters[key];
        const at = clock();
        const response = await fetch(origin + '/api' + path, { ...options, headers: { 'Content-Type': 'application/json', 'X-Genmail-Account': 'all', ...options.headers } });
        const payload = await response.text(); assert.equal(response.status, 200, path);
        bytes = Buffer.byteLength(payload); result = JSON.parse(payload); samples.push(clock() - at);
        if (!i) firstCounters = structuredClone(counters);
      }
      const warm = samples.slice(1).sort((a, b) => a - b);
      return { firstMs: samples[0], warmP50Ms: warm[2], warmP95Ms: warm[4], bytes, cpu: process.cpuUsage(cpu), firstCounters,
        rows: result.messages?.length, total: result.total, engine: result.engine, workerRSSBytes: workerRSS(), totalRSSBytes: process.memoryUsage().rss + workerRSS(), serviceProcesses: worker?.pid ? 2 : 1, rssBytes: process.memoryUsage().rss, maxRSSKiB: process.resourceUsage().maxRSS };
    }
    const state = await measure('/state', { headers: args.compact === 'false' ? {} : { 'X-Morrow-View': 'paged' } });
    const lexical = await measure('/search', { method: 'POST', body: JSON.stringify({ query: '发票', scope: 'all' }), headers: { 'X-Morrow-View': 'paged' } });
    assert.equal(lexical.total, Math.ceil(size / 10));
    if (args.engine === 'rust') assert.equal(lexical.engine, 'rust');
    process.send({ size, emptyOpenMs, seedAndIndexMs, reopenMs, state, lexical });
  } finally {
    await app?.locals.smartSearch.stop();
    if (server) await new Promise(resolve => server.close(resolve));
    store?.close(); rmSync(directory, { recursive: true, force: true });
  }
}
