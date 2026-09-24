// Fictional fixtures only; Node closes its writer before the private Rust service starts.
// Run after cargo build --manifest-path rust/Cargo.toml --release --locked.
// Optional queue investigation: --sizes=50000 --idleSeconds=0 --probeRevision=true
// Compare --rebuildMode=state (default) against --rebuildMode=revision.
// --missingRows=N removes 1..size derived rows (default min(size,1000)); explicitly
// requesting the full fixture size removes all derived documents, including demo.
// Rebuild observation has a fixed 180-second limit.
// --profileDir=test-results/rust-service-profile enables macOS native stack sampling;
// --profileSeconds=1..180 sets its duration (default 2; profiling adds overhead).
// --binary=/absolute/path/to/release/morrow-service selects a preserved release build.
import assert from 'node:assert/strict';
import { fork, spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cpus, freemem, platform, release, tmpdir, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { createStore } from '../server/store.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')));
const accounts = ['alpha@example.invalid', 'beta@example.invalid'];
const rebuildTimeoutMs = 180000;
const clock = () => performance.now();
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
async function within(promise, ms, message) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(message)), ms); })]); }
  finally { clearTimeout(timer); }
}
function processSample(pid) {
  if (process.platform === 'win32') {
    const text = execFileSync('powershell.exe', ['-NoProfile', '-Command', `$p=Get-Process -Id ${pid}; @{rssBytes=$p.WorkingSet64;cpuMs=$p.TotalProcessorTime.TotalMilliseconds}|ConvertTo-Json -Compress`], { encoding: 'utf8' });
    return JSON.parse(text);
  }
  const [rss, time] = execFileSync('ps', ['-o', 'rss=', '-o', 'time=', '-p', String(pid)], { encoding: 'utf8' }).trim().split(/\s+/);
  assert(rss && time, 'Could not sample the Rust process');
  const [days, rest] = time.includes('-') ? time.split('-') : ['0', time];
  return { rssBytes: Number(rss) * 1024, cpuMs: (Number(days) * 86400 + rest.split(':').reduce((sum, part) => sum * 60 + Number(part), 0)) * 1000 };
}
async function start(executable, directory) {
  const token = randomBytes(32).toString('hex'), started = clock();
  const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let output = '', errors = '', settled = false;
  child.stderr.on('data', data => { errors = (errors + data).slice(-8192); });
  const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', data => {
      output += data;
      if (output.length > 8192) return reject(Error('Unexpected service startup output'));
      if (!settled && output.includes('\n')) {
        settled = true;
        try { const result = JSON.parse(output.split('\n')[0]); assert(Number.isInteger(result.port) && result.port > 0); resolve(result.port); }
        catch { reject(Error('Invalid Rust readiness response')); }
      }
    });
    exited.then(result => reject(Error(`Rust exited before readiness (${result.code ?? result.signal}): ${errors}`)), reject);
  });
  child.stdin.on('error', () => {});
  // Tokens/workspace paths never appear in argv, environment, reports, or logging.
  child.stdin.write(JSON.stringify({ token, dataDirectory: directory, port: 0, parentPID: process.pid }) + '\n');
  let port;
  try { port = await within(ready, 60000, 'Rust migration/startup timed out'); }
  catch (error) { child.kill(); await exited.catch(() => {}); throw error; }
  const startupMs = clock() - started;
  return {
    pid: child.pid, startupMs,
    async request(path, body, timeoutMs = 60000) {
      const at = clock();
      const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
        method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(timeoutMs),
        headers: { Authorization: `Bearer ${token}`, 'X-Genmail-Account': 'all', 'X-Morrow-View': 'paged', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const headersAt = clock();
      const text = await response.text();
      const bodyAt = clock();
      assert.equal(response.status, 200, `${path}: ${text.slice(0, 250)}`);
      const data = JSON.parse(text);
      const completedAt = clock();
      return { data, ms: completedAt - at, bytes: Buffer.byteLength(text), phases: { headersMs: headersAt - at, bodyMs: bodyAt - headersAt, parseMs: completedAt - bodyAt } };
    },
    async stop() {
      const at = clock(); child.stdin.end(); let result;
      try { result = await within(exited, 15000, 'Rust did not release its writer after private-pipe EOF'); }
      catch (error) { child.kill('SIGKILL'); await exited.catch(() => {}); throw error; }
      assert.equal(result.code, 0, `Rust shutdown failed: ${errors}`);
      assert.equal(errors, '', 'Rust must not emit unexpected diagnostics');
      return clock() - at;
    },
  };
}
function verifyRows(data, expectedTotal, limit) {
  assert.equal(data.total ?? data.mailPage?.total, expectedTotal);
  assert.equal(data.messages.length, Math.min(expectedTotal, limit));
  assert.equal(new Set(data.messages.map(message => message.viewId)).size, data.messages.length);
  for (const message of data.messages) {
    assert(accounts.includes(message.accountId), 'Combined view leaked demo/disconnected mail');
    assert.equal(message.viewId, JSON.stringify([message.accountId, message.id]));
    for (const field of ['body', 'footer', 'bcc', 'attachments']) assert(!Object.hasOwn(message, field), `Metadata leaked ${field}`);
    if (message.searchSnippet) assert([...message.searchSnippet.map(part => part.text).join('')].length <= 182, 'Search snippet is unbounded');
  }
  assert(!JSON.stringify(data).includes('x'.repeat(256)), 'Full fixture bodies leaked into a bounded response');
}
async function measure(service, path, body, verify, rssSamples) {
  const cpuBefore = processSample(service.pid), samples = [];
  for (let i = 0; i < 6; i++) {
    const result = await service.request(path, body); verify(result.data);
    const process = processSample(service.pid); rssSamples.push(process.rssBytes);
    samples.push({ ms: result.ms, bytes: result.bytes, phases: result.phases, rssBytes: process.rssBytes });
  }
  const after = processSample(service.pid), warm = samples.slice(1).map(sample => sample.ms).sort((a, b) => a - b);
  return { firstMs: samples[0].ms, warmP50Ms: warm[2], warmP95Ms: warm[4], payloadBytes: samples.at(-1).bytes, serviceCpuDeltaMs: Math.max(0, after.cpuMs - cpuBefore.cpuMs), serviceRSSBytes: after.rssBytes, samples };
}
async function idle(service, seconds, rssSamples) {
  const started = clock(), before = processSample(service.pid), samples = [];
  while (clock() - started < seconds * 1000) {
    await delay(Math.min(1000, Math.max(0, seconds * 1000 - (clock() - started))));
    const sample = processSample(service.pid); rssSamples.push(sample.rssBytes); samples.push({ elapsedMs: clock() - started, ...sample });
  }
  const elapsedMs = clock() - started, after = processSample(service.pid), cpuDeltaMs = Math.max(0, after.cpuMs - before.cpuMs);
  return { elapsedMs, cpuDeltaMs, cpuPercentOfOneCore: cpuDeltaMs / elapsedMs * 100, rssBeforeBytes: before.rssBytes, rssAfterBytes: after.rssBytes, samples };
}
async function run(size) {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-rust-benchmark-')), rssSamples = [];
  const requestedMissingRows = args.missingRows === undefined ? Math.min(size, 1000) : Number(args.missingRows);
  const fullIndexLoss = args.missingRows !== undefined && requestedMissingRows === size;
  assert(Number.isInteger(requestedMissingRows) && requestedMissingRows >= 1 && requestedMissingRows <= size, '--missingRows must be an integer between 1 and every fixture size');
  let store, service;
  try {
    let at = clock(); store = createStore(directory); const nodeEmptyOpenMs = clock() - at;
    store.setSettings({ activeAccount: 'all', mailAccounts: Object.fromEntries(accounts.map(email => [email, { email, provider: 'imap', connectionId: email }])), preferences: { syncInterval: 0 }, policy: { enabled: false } });
    const expected = [], bodyBytes = new Set(); at = clock();
    store.transaction(() => {
      for (let i = 0; i < size; i++) {
        const message = { id: `fixture-${Math.floor(i / 2)}`, folder: i % 5 === 0 ? 'sent' : 'inbox',
          date: new Date(Date.UTC(2026, 0, 1) + Math.floor(i / 4) * 1000).toISOString(), fromName: `Sender ${i % 100}`, fromEmail: 'sender@example.invalid', to: accounts[i % 2],
          subject: i % 10 === 0 ? `發票 INV-${i}` : `Project update ${i}`, body: (i % 10 === 0 ? '請於本月付款。 Invoice payment. ' : 'Meeting notes and project timeline. ').padEnd(1024, 'x'),
          preview: 'Fictional benchmark mail', read: i % 3 !== 0, starred: i % 7 === 0, category: 'primary', labels: [] };
        store.upsertMessage(accounts[i % 2], message); bodyBytes.add(Buffer.byteLength(message.body));
        expected.push({ id: message.id, account: accounts[i % 2], date: message.date, sender: message.fromName });
      }
    });
    const nodeSeedAndIndexMs = clock() - at;
    store.close(); store = undefined; // Single writer ownership transfers only after close.
    const databaseBytesBeforeMigration = statSync(join(directory, 'genmail.sqlite')).size;
    service = await start(args.executable, directory); const migrationStartupMs = service.startupMs;
    const health = await service.request('/health'); assert.equal(health.data.status, 'ok');
    const firstAfterMigration = await service.request('/state'); verifyRows(firstAfterMigration.data, size, 50);
    const migrationStopMs = await service.stop(); service = undefined;
    service = await start(args.executable, directory); const restartStartupMs = service.startupMs;
    const initialProcess = processSample(service.pid); rssSamples.push(initialProcess.rssBytes);
    const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
    expected.sort((a, b) => collator.compare(a.sender, b.sender) || b.date.localeCompare(a.date) || a.account.localeCompare(b.account) || a.id.localeCompare(b.id));
    const senderIDs = expected.slice(0, 50).map(row => JSON.stringify([row.account, row.id]));
    const state = await measure(service, '/state', undefined, data => verifyRows(data, size, 50), rssSamples);
    const revision = await measure(service, '/state/revision', undefined, data => { assert.equal(data.accountId, 'all'); assert.equal(typeof data.revision, 'string'); assert(!Object.hasOwn(data, 'messages')); }, rssSamples);
    const search = await measure(service, '/search', { query: '发票', scope: 'all' }, data => { verifyRows(data, Math.ceil(size / 10), 30); assert.equal(data.engine, 'rust'); }, rssSamples);
    const page = await measure(service, '/mail/page', { folder: 'inbox', pageSize: 50, sort: 'newest' }, data => verifyRows(data, size - Math.ceil(size / 5), 50), rssSamples);
    const sender = await measure(service, '/mail/page', { pageSize: 50, sort: 'sender', locale: 'en' }, data => { verifyRows(data, size, 50); assert.deepEqual(data.messages.map(message => message.viewId), senderIDs); }, rssSamples);
    const first = await service.request('/mail/page', { pageSize: 50 });
    const second = await service.request('/mail/page', { pageSize: 50, cursor: first.data.nextCursor });
    verifyRows(second.data, size, 50);
    assert.equal(new Set([...first.data.messages, ...second.data.messages].map(message => message.viewId)).size, 100);
    const quiet = await idle(service, Number(args.idleSeconds), rssSamples);
    const stopMs = await service.stop(); service = undefined;
    // Simulate an interrupted derived-index rebuild, never alter messages/settings.
    // This connection exists only while the Rust process is fully stopped.
    const db = new DatabaseSync(join(directory, 'genmail.sqlite'));
    let removed, removedTotal;
    try {
      db.exec('BEGIN IMMEDIATE');
      assert.equal(Number(db.prepare('SELECT count(*) AS n FROM search_documents WHERE account IN (?,?)').get(...accounts).n), size);
      if (fullIndexLoss) {
        removedTotal = Number(db.prepare('DELETE FROM search_documents').run().changes);
        removed = size;
        assert(removedTotal >= size);
        assert.equal(Number(db.prepare('SELECT count(*) AS n FROM search_documents').get().n), 0);
      } else {
        removed = removedTotal = Number(db.prepare('DELETE FROM search_documents WHERE rowid IN (SELECT rowid FROM search_documents WHERE account IN (?,?) ORDER BY rowid LIMIT ?)').run(...accounts, requestedMissingRows).changes);
      }
      assert.equal(removed, requestedMissingRows);
      db.exec('DELETE FROM search_meta; COMMIT');
    } finally { db.close(); }
    service = await start(args.executable, directory); const rebuildStartupMs = service.startupMs, trace = [], rebuildStart = clock();
    const requestBudget = () => Math.max(1, Math.min(60000, Math.ceil(rebuildTimeoutMs - (clock() - rebuildStart))));
    const eventLoop = monitorEventLoopDelay({ resolution: 10 }); eventLoop.enable();
    const revisionProbes = [], foregroundPath = args.rebuildMode === 'revision' ? '/state/revision' : '/state';
    let probing = args.probeRevision === 'true', probeFailure;
    const probes = (async () => {
      while (probing && clock() - rebuildStart < rebuildTimeoutMs) {
        const startedMs = clock() - rebuildStart, result = await service.request('/state/revision', undefined, requestBudget());
        assert.equal(result.data.accountId, 'all'); assert.equal(typeof result.data.revision, 'string');
        assert(!Object.hasOwn(result.data, 'messages'));
        revisionProbes.push({ startedMs, completedMs: clock() - rebuildStart, ms: result.ms, bytes: result.bytes, phases: result.phases });
        if (probing) await delay(25);
      }
    })().catch(error => { probing = false; if (!(error.name === 'TimeoutError' && clock() - rebuildStart >= rebuildTimeoutMs)) probeFailure = error; });
    // Optional native stack sampling profiles only this fictional service process.
    // It adds profiler overhead and is intentionally excluded from default benchmarks.
    let sampler, rebuildMs, profilePath, rebuildComplete = false, phase = 'starting';
    let previousCoverage = size - removed, previousMatches = 0;
    try {
    if (args.profileDir) {
      assert.equal(process.platform, 'darwin', '--profileDir requires macOS sample');
      mkdirSync(args.profileDir, { recursive: true });
      const path = join(args.profileDir, `rust-service-${size}-${foregroundPath.endsWith('revision') ? 'revision' : 'state'}-${service.pid}.sample.txt`);
      sampler = new Promise((resolve, reject) => {
        const child = spawn('/usr/bin/sample', [String(service.pid), String(args.profileSeconds || 2), '1', '-file', path], { stdio: 'ignore' });
        child.once('error', reject); child.once('exit', code => code === 0 ? resolve(path) : reject(Error(`Native sample failed (${code})`)));
      }).then(path => ({ path }), error => ({ error }));
    }
    while (clock() - rebuildStart < rebuildTimeoutMs) {
      const startedMs = clock() - rebuildStart, before = processSample(service.pid);
      phase = foregroundPath;
      const state = await service.request(foregroundPath, undefined, requestBudget());
      if (foregroundPath === '/state') verifyRows(state.data, size, 50);
      else { assert.equal(state.data.accountId, 'all'); assert.equal(typeof state.data.revision, 'string'); }
      const foregroundCompletedMs = clock() - rebuildStart;
      if (clock() - rebuildStart >= rebuildTimeoutMs) break;
      phase = '/search';
      const result = await service.request('/search', { query: '发票', scope: 'all' }, requestBudget());
      assert(result.data.total <= Math.ceil(size / 10)); verifyRows(result.data, result.data.total, 30);
      const coverage = result.data.coverage.reduce((sum, row) => sum + row.count, 0), process = processSample(service.pid); rssSamples.push(process.rssBytes);
      assert(coverage >= previousCoverage && coverage <= size, 'Index coverage regressed or exceeded the fixture');
      assert(result.data.total >= previousMatches, 'Search progress regressed during backfill');
      for (const message of result.data.messages) {
        assert.equal(message.accountId, accounts[0]);
        const match = /^fixture-(\d+)$/.exec(message.id); assert(match && Number(match[1]) * 2 < size && Number(match[1]) % 5 === 0, 'Unexpected invoice search identity');
      }
      previousCoverage = coverage; previousMatches = result.data.total;
      trace.push({ startedMs, foregroundCompletedMs, elapsedMs: clock() - rebuildStart, foregroundPath, foregroundMs: state.ms, ...(foregroundPath === '/state' ? { stateMs: state.ms, stateBytes: state.bytes } : {}), foregroundPhases: state.phases, searchMs: result.ms, searchPhases: result.phases, indexedMessages: coverage, invoiceMatches: result.data.total, warning: result.data.warning, cpuDeltaMs: Math.max(0, process.cpuMs - before.cpuMs), ...process });
      // Coverage describes connected real accounts; the rebuild warning also covers
      // demo/other accounts. Do not stop before those derived rows are restored.
      if (coverage === size && result.data.warning === '') { assert.equal(result.data.total, Math.ceil(size / 10)); rebuildComplete = true; break; }
      phase = 'between requests';
      await delay(Math.max(0, Math.min(100, rebuildTimeoutMs - (clock() - rebuildStart))));
    }
    } catch (error) {
      if (!(error.name === 'TimeoutError' && clock() - rebuildStart >= rebuildTimeoutMs)) throw error;
    } finally {
      rebuildMs = clock() - rebuildStart;
      probing = false; eventLoop.disable(); await probes;
      if (sampler) { const result = await sampler; if (result.error) throw result.error; profilePath = result.path; }
      if (probeFailure) throw probeFailure;
    }
    await service.stop(); service = undefined;
    return { size, bodyCodeUnits: 1024, bodyUTF8Bytes: [...bodyBytes].sort((a, b) => a - b), nodeEmptyOpenMs, nodeSeedAndIndexMs, databaseBytesBeforeMigration,
      migrationStartupMs, migrationFirstStateMs: firstAfterMigration.ms, migrationFirstStateBytes: firstAfterMigration.bytes, migrationStopMs, restartStartupMs,
      state, revision, search, page, sender, idle: quiet, stopMs, serviceInitialRSSBytes: initialProcess.rssBytes, serviceSampledMaxRSSBytes: Math.max(...rssSamples),
      driver: { pid: process.pid, rssBytes: process.memoryUsage().rss, note: 'Fixture writer + HTTP driver; excluded from all service RSS/CPU measurements.' },
      interruptedDerivedIndex: { requestedMissingRows, removedRows: removed, removedTotalDerivedRows: removedTotal, retainedFixtureRows: size - removed, fullIndexLoss, status: rebuildComplete ? 'complete' : 'timed_out', timeoutMs: rebuildTimeoutMs, ...(rebuildComplete ? { completionMsAfterReadiness: rebuildMs } : { elapsedMsAfterReadiness: rebuildMs, timeoutPhase: phase }), startupMs: rebuildStartupMs, foregroundPath, concurrentRevisionProbes: args.probeRevision === 'true', driverEventLoop: { resolutionMs: 10, meanDelayMs: eventLoop.mean / 1e6, p99DelayMs: eventLoop.percentile(99) / 1e6, maxDelayMs: eventLoop.max / 1e6 }, trace, ...(revisionProbes.length ? { revisionProbes } : {}), ...(profilePath ? { nativeSamplePath: profilePath } : {}) }, checks: { counts: true, senderOrder: true, boundedMetadata: true, distinctOwnersAndCursorPages: true, noDualWriter: true, indexProgressMonotonic: true, exactInvoiceIdentities: true, indexRebuildCompleted: rebuildComplete } };
  } finally {
    if (service) await service.stop();
    store?.close(); rmSync(directory, { recursive: true, force: true });
  }
}

if (args.child) {
  process.send(await run(Number(args.child)));
} else {
  const sizes = (args.sizes || '1000,10000,50000').split(',').map(Number), idleSeconds = Number(args.idleSeconds ?? 30);
  assert(sizes.length && sizes.every(size => Number.isInteger(size) && size >= 100 && size <= 50000));
  assert(Number.isFinite(idleSeconds) && idleSeconds >= 0 && idleSeconds <= 60);
  assert(args.missingRows === undefined || (Number.isInteger(Number(args.missingRows)) && Number(args.missingRows) >= 1 && sizes.every(size => Number(args.missingRows) <= size)), '--missingRows must be an integer between 1 and every fixture size');
  assert(!args.rebuildMode || ['state', 'revision'].includes(args.rebuildMode));
  assert(!args.probeRevision || ['true', 'false'].includes(args.probeRevision));
  assert(args.profileSeconds === undefined || (args.profileDir && Number.isInteger(Number(args.profileSeconds)) && Number(args.profileSeconds) >= 1 && Number(args.profileSeconds) <= 180), '--profileSeconds requires --profileDir and an integer from 1 to 180');
  const source = resolve(args.binary || join(root, 'rust/target/release/morrow-service' + (process.platform === 'win32' ? '.exe' : '')));
  const snapshotDirectory = mkdtempSync(join(tmpdir(), 'morrow-release-benchmark-')), executable = join(snapshotDirectory, 'morrow-service' + (process.platform === 'win32' ? '.exe' : ''));
  try {
    copyFileSync(source, executable);
    const binary = { mode: 'release', sha256: sha256(readFileSync(executable)), bytes: statSync(executable).size, version: execFileSync(executable, ['--version'], { encoding: 'utf8' }).trim() };
    assert(binary.version.endsWith(JSON.parse(readFileSync(join(root, 'package.json'))).version));
    const profileDirectory = args.profileDir ? resolve(args.profileDir) : undefined;
    const results = [];
    for (const size of sizes) {
      process.stderr.write(`Rust service benchmark: ${size} fictional messages\n`);
      results.push(await new Promise((resolve, reject) => {
        const child = fork(fileURLToPath(import.meta.url), [`--child=${size}`, `--idleSeconds=${idleSeconds}`, `--executable=${executable}`, `--rebuildMode=${args.rebuildMode || 'state'}`, `--probeRevision=${args.probeRevision || 'false'}`, ...(args.missingRows === undefined ? [] : [`--missingRows=${args.missingRows}`]), ...(profileDirectory ? [`--profileDir=${profileDirectory}`, `--profileSeconds=${args.profileSeconds || 2}`] : [])], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
        let result;
        child.on('message', value => { result = value; }); child.once('error', reject);
        child.once('exit', code => code === 0 && result ? resolve(result) : reject(Error(`Rust benchmark fixture failed (${code})`)));
      }));
      const result = results.at(-1); process.stderr.write(`  search warm p95 ${result.search.warmP95Ms.toFixed(2)} ms; sampled service max RSS ${(result.serviceSampledMaxRSSBytes / 1024 / 1024).toFixed(1)} MiB\n`);
    }
    const report = { measuredAt: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), dirty: !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(), binary,
      platform: platform(), os: release(), architecture: process.arch, cpu: cpus()[0]?.model, logicalCPUs: cpus().length, totalMemoryBytes: totalmem(), freeMemoryBytesAtEnd: freemem(), driverNode: process.version,
      fixture: 'Same mail-v1 corpus as benchmark-mail.js: two fictional accounts, colliding IDs, mixed Chinese/English, 1024-code-unit bodies (UTF-8 sizes reported); no providers or models.',
      method: `Node writer closes before Rust starts. An immutable copy of the actual release executable starts through its private stdin pipe. Migration startup includes backup/schema open of the Node-produced current index; restart uses that migrated workspace. Each operation records first request plus five warm requests; nearest-rank p50/p95 uses warm samples only. RSS and cumulative CPU are sampled from the Rust service PID, excluding the Node fixture/HTTP driver. Idle samples issue no HTTP requests. A stopped-process fixture mutation removes ${args.missingRows === undefined ? 'min(size,1000)' : Number(args.missingRows)} selected-account derived rows. An explicit --missingRows equal to the fixture size deletes all derived documents, including any other accounts; the default preserves other accounts. Each result reports removed and retained counts and whether this is full index loss. Rebuild observation is bounded to 180 seconds; a timeout preserves progress in this report and exits unsuccessfully. Mailbox metadata and monotonically increasing search coverage/expected invoice identities are verified throughout.`,
      profiling: { rebuildForeground: args.rebuildMode || 'state', concurrentRevisionProbes: args.probeRevision === 'true', nativeSampling: !!args.profileDir, nativeSampleSeconds: args.profileDir ? Number(args.profileSeconds || 2) : 0, note: 'Header timing includes client scheduling, network, server execution and DB queue; it does not by itself isolate server phases. Concurrent revision probes share the service DB queue. Optional macOS sampling and probes change workload and can add overhead. The sampler can continue observing the idle service after rebuild completes; that wait is excluded from reported rebuild completion time.' },
      limitations: 'No UI, whole-app, real-account, external-model, or OS cold-cache claims. Rebuild results apply only to the reported missing-row counts and body sizes; partial rebuild cases do not establish full-index-loss performance. Sampled RSS is not a guaranteed peak. CPU timer resolution is OS-dependent; zero small deltas can mean below-resolution work. Five warm samples provide a smoke benchmark, not a latency-distribution acceptance study. Concurrent developer activity and shared filesystem cache can affect timings.', results };
    const output = resolve(args.output || join(root, 'test-results/migration-rust-service.json')); mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); process.stdout.write(`Saved ${output}\n`);
    if (results.some(result => !result.checks.indexRebuildCompleted)) { process.stderr.write('Background indexing exceeded the 180-second limit; progress was saved.\n'); process.exitCode = 1; }
  } finally { rmSync(snapshotDirectory, { recursive: true, force: true }); }
}
