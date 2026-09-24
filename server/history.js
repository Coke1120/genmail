import { createHash, randomUUID } from 'node:crypto';

const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };
export function importOptions(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['months', 'inbox', 'sent'].includes(key))) invalid('Invalid import options.');
  const options = { months: 3, inbox: true, sent: true, ...value };
  if (![1, 3, 6, 12].includes(options.months) || typeof options.inbox !== 'boolean' || typeof options.sent !== 'boolean' || !(options.inbox || options.sent)) invalid('Choose 1, 3, 6, or 12 months and at least one folder.');
  return options;
}
export function monthsAgo(months, now = Date.now()) {
  const date = new Date(now), day = date.getUTCDate();
  date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() - months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.toISOString();
}

export function createHistory({ store, connection, currentMail, fetchPage, importMessages, lock, now = Date.now }) {
  const read = account => store.getSettings().imports?.[account];
  const write = (account, value) => store.setSettings({ imports: { ...store.getSettings().imports, [account]: value } });
  function start(account, input) {
    const options = importOptions(input);
    if (!connection(account)) invalid('Choose a connected mailbox.');
    const before = new Date(now()).toISOString();
    write(account, { id: randomUUID(), options, since: monthsAgo(options.months, now()), before, folderIndex: 0, cursor: null, visited: [], status: 'running', imported: 0, connectionId: connection(account).connectionId, updatedAt: before });
  }
  function control(account, action) {
    const job = read(account);
    if (!job || job.status === 'complete' || !['pause', 'resume'].includes(action)) invalid('No import to pause or resume.');
    if (action === 'resume' && (job.status === 'complete' || job.connectionId !== connection(account)?.connectionId)) invalid('Start a new import for this connection.');
    write(account, { ...job, id: randomUUID(), status: action === 'pause' ? 'paused' : 'running', error: '', updatedAt: new Date(now()).toISOString() });
  }
  function status(account) {
    const job = read(account);
    if (!job) return null;
    const { options, since, before, status, imported, updatedAt, error } = job;
    return { options, since, before, status, imported, updatedAt, error };
  }
  async function tick() {
    // One read-only page per tick keeps interactive mailbox operations responsive.
    const entry = Object.entries(store.getSettings().imports || {}).filter(([account, job]) => connection(account) && job.status === 'running').sort((a, b) => a[1].updatedAt.localeCompare(b[1].updatedAt))[0];
    if (!entry) return;
    const [account, job] = entry;
    try {
      await lock(async () => {
        if (job.connectionId !== connection(account)?.connectionId) { write(account, { ...job, status: 'paused', error: 'Connection changed. Start a new import.' }); return; }
        const folders = ['inbox', 'sent'].filter(key => job.options[key]);
        const result = await fetchPage(await currentMail(account), { folder: folders[job.folderIndex], since: job.since, before: job.before, cursor: job.cursor });
        if (read(account)?.id !== job.id || read(account)?.status !== 'running' || job.connectionId !== connection(account)?.connectionId) return;
        if (!Array.isArray(result.messages) || result.messages.length > 50 || (result.nextCursor && JSON.stringify(result.nextCursor) === JSON.stringify(job.cursor))) throw new Error('Invalid import page.');
        const cursorHash = result.nextCursor ? createHash('sha256').update(JSON.stringify(result.nextCursor)).digest('hex') : null;
        if (cursorHash && (job.visited || []).includes(cursorHash)) throw new Error('Repeated import page.');
        store.transaction(() => {
          const imported = importMessages(connection(account), result.messages.filter(message => message.date >= job.since && message.date < job.before)).length;
          const folderIndex = result.nextCursor ? job.folderIndex : job.folderIndex + 1;
          write(account, { ...job, imported: job.imported + imported, cursor: result.nextCursor || null, visited: cursorHash ? [...(job.visited || []), cursorHash] : [], folderIndex, status: folderIndex >= folders.length ? 'complete' : 'running', error: '', updatedAt: new Date(now()).toISOString() });
        });
      });
    } catch (error) {
      if (error.status === 409) return; // Foreground operation owns the mailbox lock.
      if (read(account)?.id === job.id) write(account, { ...job, status: 'failed', error: 'Import stopped. Check the connection and Sent folder support, then resume. If the mailbox changed, start again.', updatedAt: new Date(now()).toISOString() });
    }
  }
  return { start, control, status, tick, options: account => read(account)?.options };
}
