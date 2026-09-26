import { randomUUID } from 'node:crypto';

const pending = status => ['queued', 'running'].includes(status);
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const status = value => ['queued', 'running', 'paused', 'complete', 'completed', 'failed', 'interrupted'].includes(value) ? value : 'interrupted';
const failure = value => ['failed', 'interrupted'].includes(value);
function timestamp(...values) {
  for (const value of values) if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return null;
}
function retain(tasks) {
  let excess = tasks.filter(task => task.status !== 'running').length - 20;
  for (let i = 0; excess > 0 && i < tasks.length;) {
    if (tasks[i].status !== 'running') { tasks.splice(i, 1); excess--; } else i++;
  }
}
function importDetail(job, phase) {
  const folders = job.options?.allMail ? 'All mail' : ['inbox', 'sent'].filter(key => job.options?.[key] === true).map(key => key === 'inbox' ? 'Inbox' : 'Sent').join(' + ');
  const months = [1, 3, 6, 12].includes(job.options?.months) ? `${job.options.months} months` : 'Selected history range';
  const pages = count(job.pages), processed = count(job.processed), added = count(job.imported);
  const current = { all: 'All mail', inbox: 'Inbox', sent: 'Sent' }[job.currentFolder];
  return `${months}${folders ? ` · ${folders}` : ''}${current ? ` · Current folder: ${current}` : ''} · ${pages === null ? 'Page count unknown' : `${pages} pages checked`} · ${processed === null ? 'Checked message count unknown' : `${processed} messages checked`} · ${added === null ? 'New message count unknown' : `${added} new messages`}. ${job.phase === 'retrying' && timestamp(job.nextRetryAt) ? `Temporary interruption. Retry ${count(job.retryCount) ?? 0}/3 scheduled for ${timestamp(job.nextRetryAt)}.` : phase === 'queued' ? 'Waiting for the next background page.' : phase === 'running' ? 'Fetching the next history page.' : 'Downloaded mail only.'}`;
}

// Runtime label/detail arguments are server-authored phase text, never provider/model output.
export function createActivity({ settings, connections, importStatus }) {
  const tasks = [];
  function start(accountId, kind, label, detail) {
    const task = { id: randomUUID(), accountId, kind, label, detail, status: 'running', completed: null, total: null, updatedAt: new Date().toISOString() };
    tasks.push(task);
    return (success, completed) => {
      if (task.status !== 'running') return;
      task.status = success === null ? 'interrupted' : success ? 'complete' : 'failed'; task.updatedAt = new Date().toISOString();
      task.completed = count(completed);
      if (!success) task.error = 'Operation did not complete. Check its page or connection settings; no automatic retry was started here.';
      tasks.splice(tasks.indexOf(task), 1); tasks.push(task);
      retain(tasks); // Also bounds many operations that finish together without another start.
    };
  }
  function snapshot() {
    const config = settings(), live = connections();
    const result = tasks.filter(task => !task.accountId || Object.hasOwn(live, task.accountId)).map(task => ({ ...task }));
    for (const accountId of Object.keys(live)) {
      const job = importStatus(accountId);
      if (job) {
        // Ordinary sync for this account is not evidence that a history page is in flight.
        const fetching = result.some(task => task.accountId === accountId && task.kind === 'import' && task.status === 'running');
        const phase = job.status === 'running' ? fetching ? 'running' : 'queued' : status(job.status);
        for (let i = result.length - 1; i >= 0; i--) if (result[i].accountId === accountId && result[i].kind === 'import') result.splice(i, 1);
        result.push({ id: `import:${accountId}`, accountId, kind: 'import', label: 'Mail history', status: phase, completed: count(job.processed), total: null, detail: importDetail(job, phase), updatedAt: timestamp(job.updatedAt), error: failure(phase) ? job.error || 'Import stopped. Review the connection and import settings before resuming.' : phase === 'paused' ? 'Import is paused. Review import settings to resume or start again.' : null });
      }
      const jobs = Array.isArray(config.automation?.[accountId]?.jobs) ? config.automation[accountId].jobs.filter(job => job && typeof job === 'object') : [];
      const active = jobs.filter(job => pending(job.status));
      if (active.length) result.push({ id: `summaries:${accountId}`, accountId, kind: 'ai', label: 'AI summaries', status: active.some(job => job.status === 'running') ? 'running' : 'queued', detail: `${active.filter(job => job.status === 'running').length} running · ${active.filter(job => job.status === 'queued').length} queued`, completed: null, total: active.length, updatedAt: timestamp(active.at(-1).updatedAt, active.at(-1).createdAt) });
      const last = jobs.findLast(job => !pending(job.status));
      if (last) {
        const phase = status(last.status);
        result.push({ id: `last-summary:${accountId}`, accountId, kind: 'ai', label: 'Last AI summary', status: phase, detail: last.status === 'skipped' ? 'Context changed; the result was discarded. Review Summaries to run again.' : 'Results in AI Studio → Summaries', completed: ['complete', 'completed'].includes(phase) ? 1 : null, total: 1, updatedAt: timestamp(last.updatedAt, last.completedAt, last.createdAt), error: failure(phase) ? 'Analysis did not complete. Review Summaries; no automatic retry.' : null });
      }
      const style = config.styleLearning?.[accountId]?.preview;
      if (style && typeof style === 'object') {
        const phase = ['prepared', 'ready'].includes(style.status) ? 'complete' : status(style.status);
        result.push({ id: `learning:${accountId}`, accountId, kind: 'learning', label: 'Writing-style learning', status: phase, detail: style.status === 'ready' ? 'Proposal ready. Review and save in Learning.' : style.status === 'prepared' ? 'Samples prepared. Waiting for your confirmation in Learning.' : phase === 'running' ? 'Analyzing approved Sent samples.' : 'Review Learning before starting another analysis.', completed: style.status === 'ready' ? count(style.sampleCount) : null, total: count(style.sampleCount), updatedAt: timestamp(style.updatedAt, style.completedAt, style.createdAt), error: failure(phase) ? 'Learning did not complete. Review Learning; no automatic retry.' : null });
      }
    }
    const index = config.searchIndex;
    if (Array.isArray(index?.sources)) {
      const completed = count(index.completed), phase = index.status === 'prepared' ? 'complete' : status(index.status);
      for (const accountId of Object.keys(live)) {
        const owned = index.sources.map((source, i) => source?.account === accountId ? i : -1).filter(i => i >= 0);
        if (!owned.length) continue;
        const done = completed === null || completed > index.sources.length ? null : owned.filter(i => i < completed).length;
        const accountPhase = phase === 'running' ? done === owned.length ? 'complete' : done !== null && index.sources[completed]?.account === accountId ? 'running' : 'queued' : phase;
        result.push({ id: `semantic-index:${accountId}`, accountId, kind: 'index', label: 'Embedding index', status: accountPhase, detail: index.status === 'prepared' ? 'Preview ready. Waiting for your confirmation in Search.' : 'Approved messages in the current batch; only downloaded mail is indexed.', completed: done, total: owned.length, updatedAt: timestamp(index.updatedAt, index.createdAt), error: failure(accountPhase) ? 'Indexing did not complete. Review Search; retry only after reviewing a new batch.' : null });
      }
    }
    const rank = task => ({ running: 0, queued: 1, failed: 2, interrupted: 2, paused: 3 }[task.status] ?? 4);
    result.sort((a, b) => rank(a) - rank(b) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return { tasks: result, checkedAt: new Date().toISOString() };
  }
  return { start, snapshot };
}
