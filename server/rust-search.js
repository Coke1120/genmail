import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { searchTokens } from './search-index.js';

// Host-only development option. The renderer supplies neither executable nor DB paths.
export const rustSearchExecutable = fileURLToPath(new URL(`../rust/target/release/morrow-search${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url));
export function createRustSearch(databasePath, { executable = rustSearchExecutable } = {}) {
  let child, sequence = 0, failed = false, stopped = false, buffer = Buffer.alloc(0), stopping = Promise.resolve();
  const pending = new Map();
  function stop() {
    stopped = true;
    const running = child; child = undefined;
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(Error('Search worker unavailable.')); }
    pending.clear();
    if (!running) return stopping;
    stopping = new Promise(resolve => {
      running.once('close', resolve);
      running.kill();
    });
    return stopping;
  }
  function unavailable() { failed = true; stop(); }
  function call(operation) {
    if (failed || stopped || pending.size >= 4) return Promise.reject(Error('Search worker unavailable.'));
    const id = ++sequence, input = JSON.stringify({ id, operation }) + '\n';
    if (Buffer.byteLength(input) > 2 * 1024 * 1024) return Promise.reject(Error('Search batch too large.'));
    if (!child) {
      child = spawn(executable, [databasePath], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, env: { ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) } });
      child.once('error', unavailable); child.once('exit', unavailable); child.stdin.on('error', unavailable);
      child.stdout.on('data', chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > 1024 * 1024) return unavailable();
        let end;
        while ((end = buffer.indexOf(10)) >= 0) {
          let response; try { response = JSON.parse(buffer.subarray(0, end)); } catch { return unavailable(); }
          buffer = buffer.subarray(end + 1);
          const item = pending.get(response.id); if (!item) return unavailable();
          pending.delete(response.id); clearTimeout(item.timer);
          if (response.error) item.reject(Error('Search worker rejected the operation.'));
          else item.resolve(response.result);
        }
      });
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(unavailable, 5000);
      pending.set(id, { resolve, reject, timer }); child.stdin.write(input);
    });
  }
  return {
    call, stop,
    get pid() { return child?.pid; },
    async lexical(options, accounts, candidates = false) {
      const tokens = [...new Set(options.terms.flatMap(term => searchTokens(term).split(' ').filter(Boolean)))];
      return call({ kind: 'lexical', accounts, terms: options.terms, tokens, conditions: options.conditions, folder: options.scope === 'folder' ? options.folder : null, sort: options.sort, page: options.page, candidates });
    },
    async cosine(query, rows) {
      const scores = [];
      for (let i = 0; i < rows.length; i += 16) {
        const batch = rows.slice(i, i + 16), result = await call({ kind: 'cosine', query, vectors: batch.map(row => JSON.parse(row.vector)) });
        if (!Array.isArray(result?.scores) || result.scores.length !== batch.length || result.scores.some(value => !Number.isFinite(value))) throw Error('Invalid cosine response.');
        scores.push(...result.scores);
      }
      return scores;
    },
  };
}
