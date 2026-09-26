import { CircleCheck, Clock3, LoaderCircle, TriangleAlert } from 'lucide-react';

const attentionStatuses = new Set(['paused', 'failed', 'interrupted']);
const labels = { sync: 'Fetching mail', import: 'Importing history', ai: 'AI processing', learning: 'Learning writing style', index: 'Indexing mail' };
const count = value => Number.isSafeInteger(value) && value >= 0;
function timestamp(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
function Updated({ value, label = 'Updated' }) {
  const date = timestamp(value);
  return date ? <span>{label} <time dateTime={date.toISOString()}>{date.toLocaleString()}</time></span> : null;
}

export default function ActivityStatus({ value, error = '', onOpenSettings }) {
  const tasks = Array.isArray(value?.tasks) ? value.tasks.filter(task => task && typeof task === 'object') : [];
  const ready = Array.isArray(value?.tasks);
  const running = tasks.filter(task => task.status === 'running');
  const fetching = running.filter(task => ['sync', 'import'].includes(task.kind)).length;
  const ai = running.filter(task => ['ai', 'learning', 'index'].includes(task.kind)).length;
  const queued = tasks.filter(task => task.status === 'queued').length;
  const attention = tasks.filter(task => attentionStatuses.has(task.status)).length;
  const parts = [fetching && `Fetching mail · ${fetching}`, ai && `AI · ${ai}`, queued && `Queued · ${queued}`, attention && `Needs attention · ${attention}`].filter(Boolean);
  const summary = error ? `Activity unavailable${ready ? ' · Showing last known status' : ''}` : !ready ? 'Checking activity…' : parts.join(' / ') || 'No work in progress';
  const spinning = !error && (running.length > 0 || !ready);
  const Icon = spinning ? LoaderCircle : error || attention ? TriangleAlert : queued ? Clock3 : CircleCheck;
  const groups = [...new Set(tasks.map(task => task.accountId || 'Workspace'))];
  return <details aria-label="Mail and AI activity" style={{ fontSize: 12, minWidth: 0 }}>
    <summary style={{ cursor: 'pointer', padding: '8px 0', overflowWrap: 'anywhere' }}>
      <Icon size={14} aria-hidden="true" className={spinning ? 'settings-spinner' : undefined} style={{ verticalAlign: 'middle', marginRight: 6 }} />
      {spinning && attention > 0 && <TriangleAlert size={14} aria-hidden="true" style={{ verticalAlign: 'middle', marginRight: 6 }} />}
      <span role="status" aria-live="polite" aria-atomic="true">{summary}</span>
    </summary>
    <div style={{ maxHeight: 360, overflowY: 'auto', overflowWrap: 'anywhere', padding: '0 4px 8px' }}>
      {error && <p className="inline-error">{error}</p>}
      <p>Idle does not mean your entire mailbox is downloaded. Mail views and AI use only downloaded mail; history is limited to your selected import range.</p>
      <p><Updated value={value?.checkedAt} label="Last checked" /></p>
      {groups.map(account => <section key={account} aria-label={account} style={{ borderTop: '1px solid currentColor', paddingTop: 8, marginTop: 10 }}>
        <strong>{account}</strong>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {tasks.filter(task => (task.accountId || 'Workspace') === account).map((task, index) => <li key={task.id || index} style={{ padding: '10px 0' }}>
            <div><strong>{task.label || labels[task.kind] || 'Background task'}</strong> · {task.status === 'complete' || task.status === 'completed' ? 'Completed' : task.status ? task.status.charAt(0).toUpperCase() + task.status.slice(1) : 'Status unknown'}</div>
            {task.detail && <p style={{ margin: '4px 0' }}>{task.detail}</p>}
            {count(task.completed) && <div>{task.completed}{count(task.total) ? ` / ${task.total}` : ' completed · Total not yet known'}</div>}
            {!count(task.completed) && count(task.total) && <div>Total {task.total} · Progress not yet known</div>}
            {task.error && <p className="inline-error">{task.error}</p>}
            <small><Updated value={task.updatedAt} /></small>
          </li>)}
        </ul>
      </section>)}
      {ready && !tasks.length && <p>No recent tasks.</p>}
      {onOpenSettings && <button type="button" className="button secondary" onClick={onOpenSettings}>Import settings</button>}
    </div>
  </details>;
}
