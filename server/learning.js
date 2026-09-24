import { createHash, randomUUID } from 'node:crypto';
import { resolvePolicy } from './policy.js';
import { monthsAgo } from './history.js';
import { modelPayload } from './integrations.js';

const defaults = { enabled: false, weekly: false, months: 3, maxSamples: 50, tokenBudget: 16000 };
const fail = (message, status = 409) => { throw Object.assign(new Error(message), { status }); };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// ponytail: deterministic quote/signature heuristics; review samples because mail formats vary.
export function ownText(body = '') {
  return body.replace(/\r\n?/g, '\n').split('\n').filter(line => !/^\s*>/.test(line)).join('\n')
    .split(/\n(?:On .{3,200}wrote:|在.{3,200}(?:寫道|写道)[：:]|[-_ ]{2,}(?:Original Message|Forwarded message|原始郵件|轉寄郵件)|From:\s|寄件者[：:]|--\s*$|Sent from my |Get Outlook for |CONFIDENTIAL(?:ITY)?\b|DISCLAIMER\b|免責聲明|保密聲明)/im)[0].trim();
}
export function createLearning({ store, connection, runModel, now = Date.now }) {
  const read = account => ({ settings: defaults, ...store.getSettings().styleLearning?.[account] });
  const write = (account, value) => store.setSettings({ styleLearning: { ...store.getSettings().styleLearning, [account]: value } });
  const config = account => ({ ...defaults, ...read(account).settings });
  function permitted(account) {
    const policy = resolvePolicy(store.getSettings().policy);
    return !!connection(account) && config(account).enabled && policy.enabled && policy.behaviors.memory && policy.folders.sent && policy.content.body;
  }
  function stamp(account) {
    const settings = store.getSettings();
    return hash([connection(account)?.connectionId || connection(account)?.email, settings.ai, resolvePolicy(settings.policy), settings.preferences, config(account)]);
  }
  function source(account, id) {
    const message = store.getMessage(account, id);
    return message && message.folder === 'sent' && message.fromEmail?.toLowerCase() === account.toLowerCase() && !message.automated ? ownText(message.body) : null;
  }
  function valid(account, preview) {
    return permitted(account) && preview && preview.stamp === stamp(account) && preview.sources.every(item => hash(source(account, item.id)) === item.hash);
  }
  function updateSettings(account, input) {
    if (!connection(account)) fail('Choose a connected mailbox.');
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !Object.hasOwn(defaults, key))) fail('Invalid style settings.', 400);
    const next = { ...config(account), ...input };
    if (typeof next.enabled !== 'boolean' || typeof next.weekly !== 'boolean' || ![1, 3, 6, 12].includes(next.months) || !Number.isInteger(next.maxSamples) || next.maxSamples < 1 || next.maxSamples > 50 || !Number.isInteger(next.tokenBudget) || next.tokenBudget < 4000 || next.tokenBudget > 64000) fail('Choose 1–50 samples and a 4,000–64,000 token budget.', 400);
    if (next.weekly && !next.enabled) fail('Enable style learning before weekly updates.', 400);
    const current = read(account);
    write(account, { ...current, settings: next, preview: null, lastWeeklyAt: now(), weeklySince: next.weekly && !config(account).weekly ? new Date(now()).toISOString() : current.weeklySince });
  }
  const modelOptions = () => ({ preferences: store.getSettings().preferences || {}, includeUsage: true });
  const modelSettings = () => ({ ...store.getSettings().ai, maxTokens: Math.min(store.getSettings().ai?.maxTokens || 1200, 1200) });
  // UTF-8 bytes plus framing is deliberately conservative, not a model-specific tokenizer.
  const estimate = messages => Buffer.byteLength(JSON.stringify(modelPayload(modelSettings(), 'style', messages, '', modelOptions()))) + 256 + modelSettings().maxTokens;
  function prepare(account, incremental = false) {
    if (!permitted(account)) fail('Enable style learning, Email Brain, Sent folder and email body access in AI permissions.', 403);
    const current = read(account), options = config(account), settings = store.getSettings();
    if (!settings.ai?.baseUrl || !settings.ai?.model) fail('Configure an AI model first.');
    if (current.preview?.status === 'running') fail('Style analysis is already running.');
    const end = new Date(now()).toISOString(), start = monthsAgo(options.months, now());
    const since = incremental ? [start, current.analyzedThrough, current.weeklySince].filter(Boolean).sort().at(-1) : start;
    const unique = new Map();
    for (const message of store.listMessages(account)) {
      if (message.date < since || message.date >= end) continue;
      const body = source(account, message.id);
      if (!body || body.length < 40) continue;
      const digest = hash(body.toLowerCase().replace(/\s+/g, ' '));
      if (!unique.has(digest)) unique.set(digest, { message, body });
    }
    // Round-robin date/recipient buckets avoid choosing only one conversation.
    const buckets = new Map();
    for (const item of unique.values()) {
      const key = `${item.message.date.slice(0, 7)}:${item.message.to?.toLowerCase() || ''}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(item);
    }
    const ordered = [];
    while ([...buckets.values()].some(items => items.length)) for (const items of buckets.values()) if (items.length) ordered.push(items.shift());
    const sources = [], messages = [], cap = Math.min(options.maxSamples, resolvePolicy(settings.policy).maxMessages, 50);
    for (const item of ordered) {
      if (sources.length >= cap) break;
      const candidate = { body: item.body.slice(0, 6000) };
      if (estimate([...messages, candidate]) > options.tokenBudget) continue;
      messages.push(candidate); sources.push({ id: item.message.id, hash: hash(item.body), body: candidate.body });
    }
    if (!sources.length) fail('No useful Sent samples fit your dates, permissions and budget. Import Sent mail or increase the budget.');
    const preview = { id: randomUUID(), status: 'prepared', createdAt: end, through: end, incremental, stamp: stamp(account), sources, eligible: unique.size, sampleCount: sources.length, effectiveCap: cap, estimatedTokens: estimate(messages), tokenBudget: options.tokenBudget };
    write(account, { ...current, preview });
    return preview;
  }
  async function generate(account, id) {
    const preview = read(account).preview;
    if (!valid(account, preview) || preview.id !== id || preview.status !== 'prepared') fail('Preview expired or was already used. Prepare fresh samples.');
    write(account, { ...read(account), preview: { ...preview, status: 'running' } });
    try {
      const result = await runModel(modelSettings(), 'style', preview.sources.map(item => ({ body: item.body })), '', modelOptions());
      if (read(account).preview?.id !== id || !valid(account, preview)) fail('Permissions, account, model or source mail changed. Result discarded.');
      const voice = (typeof result === 'string' ? result : result?.text)?.trim();
      if (!voice || voice.length > 2000) fail('The model returned an invalid style guide. Try again with fresh samples.');
      write(account, { ...read(account), analyzedThrough: preview.through, preview: { ...preview, status: 'ready', voice, usage: result.usage || {} } });
    } catch (error) {
      if (read(account).preview?.id === id) write(account, { ...read(account), preview: { ...preview, status: 'failed', error: 'Analysis failed or its context changed. Tokens may have been used. Prepare a new preview to retry explicitly.' } });
      throw Object.assign(new Error('Style analysis failed or its context changed. Check settings and prepare fresh samples; tokens may have been used.'), { status: 502 });
    }
  }
  function apply(account, input) {
    const value = read(account), preview = value.preview;
    if (!valid(account, preview) || preview.id !== input?.previewId || preview.status !== 'ready') fail('Prepare and analyze fresh samples before saving.');
    if (typeof input.voice !== 'string' || !input.voice.trim() || input.voice.length > 2000) fail('Style guide must contain 1–2000 characters.', 400);
    write(account, { ...value, profile: { voice: input.voice.trim(), updatedAt: new Date(now()).toISOString(), sources: preview.sources.map(({ id, hash }) => ({ id, hash })) }, preview: null });
  }
  function voice(account) {
    const profile = read(account).profile;
    return permitted(account) && profile && profile.sources.every(item => hash(source(account, item.id)) === item.hash) ? profile.voice : '';
  }
  function state(account) {
    const value = read(account), preview = value.preview;
    const visible = preview && valid(account, preview);
    return { settings: config(account), permitted: permitted(account), profile: value.profile ? { voice: value.profile.voice, updatedAt: value.profile.updatedAt, active: !!voice(account) } : null,
      preview: visible ? { ...Object.fromEntries(['id', 'status', 'createdAt', 'incremental', 'eligible', 'sampleCount', 'effectiveCap', 'estimatedTokens', 'tokenBudget', 'voice', 'usage', 'error'].map(key => [key, preview[key]])), samples: preview.sources.map(item => ({ body: item.body })) } : null, lastWeeklyAt: value.lastWeeklyAt || null };
  }
  for (const [account, value] of Object.entries(store.getSettings().styleLearning || {})) {
    if (value.preview?.status === 'running') write(account, { ...value, preview: { ...value.preview, status: 'interrupted', error: 'Interrupted by shutdown. Tokens may have been used. Prepare new samples to retry.' } });
  }
  async function tick() {
    for (const account of Object.keys(store.getSettings().styleLearning || {})) {
      const value = read(account);
      if (!permitted(account) || !config(account).weekly || now() < (value.lastWeeklyAt || now()) + 7 * 86400000 || (valid(account, value.preview) && ['prepared', 'running', 'ready'].includes(value.preview?.status))) continue;
      write(account, { ...value, lastWeeklyAt: now() }); // Claim before model use; never replay after a crash.
      try { const preview = prepare(account, true); await generate(account, preview.id); } catch { /* Persisted failure or no new samples; retry next week. */ }
      break;
    }
  }
  return { updateSettings, prepare, generate, apply, voice, state, tick, clear: account => write(account, { settings: { ...config(account), enabled: false, weekly: false } }) };
}
