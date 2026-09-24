import { createHash, randomUUID } from 'node:crypto';
import { DEFAULT_PREFERENCES, matchesAITrigger } from '../shared/features.js';
import { redactMessage, resolvePolicy } from './policy.js';

// Calendar-day keys prevent a second daily run when DST repeats an hour.
export function summaryDue(schedule, previous = {}, now = Date.now()) {
  const config = JSON.stringify(schedule), same = previous.config === config;
  if (schedule.cadence === 'interval') {
    const lastAt = same ? previous.lastAt : now;
    return { due: Number.isFinite(lastAt) && now >= lastAt + schedule.everyHours * 3600000, state: { config, lastAt: lastAt ?? now } };
  }
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: schedule.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(part => [part.type, part.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  return { due: `${parts.hour}:${parts.minute}` >= schedule.time && day > (same ? previous.day || '' : ''), day, state: { config, day: same ? previous.day : '' } };
}

export function createAutomation({ store, accounts, connection, generate, sync, maintenance = async () => {}, now = Date.now }) {
  let timer, busy = false, stopped = false, lastSync = now();
  const read = account => store.getSettings().automation?.[account] || { jobs: [], schedule: {} };
  function write(account, value) {
    store.setSettings({ automation: { ...store.getSettings().automation, [account]: value } });
  }
  function signature(account) {
    const config = store.getSettings(), preferences = { ...DEFAULT_PREFERENCES, ...config.preferences };
    return createHash('sha256').update(JSON.stringify([resolvePolicy(config.policy), config.ai, preferences.language, preferences.translationLanguage, preferences.replyTone, connection(account)?.connectionId || connection(account)?.email || account])).digest('hex');
  }
  const owners = () => accounts().length ? accounts() : ['demo'];
  function sourceDigest(account, ids) {
    const policy = resolvePolicy(store.getSettings().policy);
    return createHash('sha256').update(JSON.stringify(ids.map(id => {
      const message = store.getMessage(account, id);
      if (!message) return null;
      const { subject, body, fromName, fromEmail, to, date } = redactMessage(message, policy);
      return { id, subject, body, fromName, fromEmail, to, date };
    }))).digest('hex');
  }
  function eligible(account, kind, candidates) {
    const policy = resolvePolicy(store.getSettings().policy);
    if (!policy.enabled || !policy.triggers[kind === 'arrival' ? 'onArrival' : 'scheduledSummary'] || !policy.behaviors[kind === 'arrival' ? 'summary' : 'briefing']) return [];
    return (candidates || store.listMessages(account)).filter(message => !['drafts', 'trash'].includes(message.folder) && policy.folders[message.folder] &&
      (!policy.triggers.inboxOnly || message.folder === 'inbox') && (!policy.triggers.starredOnly || message.starred) &&
      ['subject', 'body', 'sender'].some(key => policy.content[key]));
  }
  function append(account, kind, messageIds) {
    const value = read(account), pending = value.jobs.filter(job => ['queued', 'running'].includes(job.status));
    // ponytail: 100 pending jobs/account; overflow stays visible for manual handling.
    if (pending.length >= 100) { write(account, { ...value, overflow: (value.overflow || 0) + 1 }); return; }
    const history = value.jobs.filter(job => !['queued', 'running'].includes(job.status)).slice(-20);
    write(account, { ...value, jobs: [...history, ...pending, { id: randomUUID(), kind, messageIds, signature: signature(account), sourceDigest: sourceDigest(account, messageIds), createdAt: new Date(now()).toISOString(), status: 'queued' }] });
  }
  function arrivals(account, ids) {
    const policy = resolvePolicy(store.getSettings().policy);
    for (const id of new Set(ids)) if (matchesAITrigger(policy, 'onArrival', store.getMessage(account, id))) append(account, 'arrival', [id]);
  }
  function reports(account) {
    if (account === 'all' || !owners().includes(account)) return [];
    const jobs = read(account).jobs;
    if (!jobs.length) return [];
    const candidates = [...new Set(jobs.flatMap(job => job.messageIds))].map(id => store.getMessage(account, id)).filter(Boolean);
    const stamp = signature(account), allowed = Object.fromEntries(['arrival', 'scheduled'].map(kind => [kind, new Set(eligible(account, kind, candidates).map(message => message.id))]));
    return jobs.filter(job => job.signature === stamp && job.messageIds.every(id => allowed[job.kind]?.has(id)) && job.sourceDigest === sourceDigest(account, job.messageIds))
      .slice(-20).reverse().map(({ id, kind, messageIds, createdAt, completedAt, status, source, text, items, error }) => ({ id, kind, messageIds, createdAt, completedAt, status, source, text, items, error }));
  }
  function updateJob(account, id, patch) {
    const value = read(account);
    const jobs = value.jobs.map(job => job.id === id ? { ...job, ...patch } : job);
    const recent = new Set(jobs.filter(job => !['queued', 'running'].includes(job.status)).slice(-20).map(job => job.id));
    write(account, { ...value, jobs: jobs.filter(job => ['queued', 'running'].includes(job.status) || recent.has(job.id)) });
  }
  // A crash may have spent tokens. Never silently replay a previously claimed job.
  for (const [account, value] of Object.entries(store.getSettings().automation || {})) {
    if (value.jobs.some(job => job.status === 'running')) write(account, { ...value, jobs: value.jobs.map(job => job.status === 'running' ? { ...job, status: 'interrupted', error: 'Interrupted by app shutdown. Generate again manually if needed.' } : job) });
  }
  async function tick() {
    if (busy || stopped) return;
    busy = true;
    try {
      const timestamp = now(), preferences = { ...DEFAULT_PREFERENCES, ...store.getSettings().preferences };
      if (preferences.syncInterval > 0 && timestamp >= lastSync + preferences.syncInterval * 60000) {
        lastSync = timestamp;
        try { await sync(); } catch { /* Each provider failure is surfaced by the normal sync state. */ }
      }
      if (stopped) return;
      await maintenance(() => stopped);
      if (stopped) return;
      const policy = resolvePolicy(store.getSettings().policy);
      for (const account of owners()) {
        const messages = eligible(account, 'scheduled');
        if (!messages.length) continue;
        const value = read(account), due = summaryDue(policy.summarySchedule, value.schedule, now());
        if (due.due) {
          store.transaction(() => {
            write(account, { ...value, schedule: { ...due.state, day: due.day, lastAt: now() } });
            append(account, 'scheduled', messages.slice(0, policy.maxMessages).map(message => message.id));
          });
        } else if (JSON.stringify(value.schedule) !== JSON.stringify(due.state)) write(account, { ...value, schedule: due.state });
      }
      // One serial model call at a time, up to four per tick across all accounts.
      let count = 0;
      const queued = owners().flatMap(account => read(account).jobs.filter(job => job.status === 'queued').map(job => ({ account, job }))).sort((a, b) => a.job.createdAt.localeCompare(b.job.createdAt));
      for (const { account, job } of queued) {
        if (stopped || count >= 4) return;
        const allowed = eligible(account, job.kind);
        if (job.signature !== signature(account) || job.sourceDigest !== sourceDigest(account, job.messageIds) || !job.messageIds.every(id => allowed.some(message => message.id === id))) {
          updateJob(account, job.id, { status: 'skipped', error: 'Permissions, model, account or source messages changed.' }); continue;
        }
        count++;
        updateJob(account, job.id, { status: 'running' });
        try {
          const result = await generate(account, job.kind, job.messageIds);
          if (stopped) return;
          if (!owners().includes(account) || job.signature !== signature(account) || job.sourceDigest !== sourceDigest(account, job.messageIds) || !job.messageIds.every(id => eligible(account, job.kind).some(message => message.id === id))) {
            updateJob(account, job.id, { status: 'skipped', error: 'Context changed; the result was discarded.' }); continue;
          }
          updateJob(account, job.id, { ...result, status: 'completed', completedAt: new Date(now()).toISOString() });
        } catch {
          if (stopped) return;
          updateJob(account, job.id, { status: 'failed', error: 'Summary could not be generated. Check model settings and permissions; try a manual summary.' });
        }
      }
    } finally { busy = false; }
  }
  return {
    arrivals, reports, tick,
    overflow: account => owners().includes(account) ? read(account).overflow || 0 : 0,
    resetSchedules() { for (const account of owners()) write(account, { ...read(account), schedule: summaryDue(resolvePolicy(store.getSettings().policy).summarySchedule, {}, now()).state }); },
    start() { if (!timer) { stopped = false; timer = setInterval(() => { void tick().catch(() => {}); }, 30000); timer.unref(); void tick().catch(() => {}); } },
    stop() { stopped = true; clearInterval(timer); timer = undefined; },
  };
}
