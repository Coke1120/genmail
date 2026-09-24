import { useEffect, useState } from 'react';

async function request(path, body) {
  const response = await fetch('/api/search/' + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await response.json(); if (!response.ok) throw Error(value.error || 'Search settings request failed.'); return value;
}
const editable = value => { const { hasApiKey, ...settings } = value.settings; return { ...settings, apiKey: '', clearApiKey: false }; };
export default function SearchSettings({ state, onDirtyChange, onBusyChange, disabled }) {
  const [value, setValue] = useState(null), [options, setOptions] = useState(null), [baseline, setBaseline] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const dirty = !!options && JSON.stringify(options) !== baseline, indexing = value?.job?.status === 'running';
  useEffect(() => { let active = true; request('settings').then(next => { if (active) { setValue(next); const fields = editable(next); setOptions(fields); setBaseline(JSON.stringify(fields)); } }).catch(error => { if (active) setError(error.message); }); return () => { active = false; }; }, []);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange(busy || indexing); }, [busy, indexing, onBusyChange]);
  useEffect(() => () => { onDirtyChange(false); onBusyChange(false); }, [onDirtyChange, onBusyChange]);
  useEffect(() => { if (!indexing) return; let active = true; const timer = setInterval(() => { request('settings').then(next => { if (active) { setValue(next); setError(''); } }).catch(error => { if (active) setError(error.message); }); }, 1500); return () => { active = false; clearInterval(timer); }; }, [indexing]);
  async function action(path, body = {}) {
    if (busy || disabled) return; setBusy(true); setError('');
    try { const next = await request(path, body); setValue(next); if (path === 'settings') { const fields = editable(next); setOptions(fields); setBaseline(JSON.stringify(fields)); } }
    catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }
  if (!options) return <p role="status">{error || 'Loading search settings…'}</p>;
  const set = (key, value) => setOptions({ ...options, [key]: value });
  return <section className="settings-fields">
    <h2 className="settings-section-title">Search & semantic indexing</h2>
    <p className="settings-intro">Keyword search is local and always available. Smart search (智慧搜尋) is optional; it uses a separate embedding model. Selected mail text is sent to that endpoint only after you review and start an indexing batch.</p>
    <fieldset className="settings-fields" disabled={busy || indexing || disabled}>
      <label className="settings-permission"><input type="checkbox" checked={options.enabled} onChange={e => set('enabled', e.target.checked)} /><span>Enable smart search</span></label>
      <label className="settings-field">Embedding protocol<select value={options.protocol} onChange={e => set('protocol', e.target.value)}><option value="openai">OpenAI-compatible (/embeddings)</option><option value="ollama">Ollama native (/api/embed)</option></select></label>
      <label className="settings-field">Embedding base URL<input value={options.baseUrl} onChange={e => set('baseUrl', e.target.value)} /><span className="settings-help">Local example: http://127.0.0.1:11434/v1 for OpenAI-compatible, or http://127.0.0.1:11434 for Ollama native. Remote endpoints require HTTPS.</span></label>
      <label className="settings-field">Embedding model ID<input value={options.model} onChange={e => set('model', e.target.value)} /><span className="settings-help">Choose an embedding model; a chat model alone is not enough. Changing the model or scope invalidates existing vectors.</span></label>
      <label className="settings-field">Embedding API key<input type="password" autoComplete="off" value={options.apiKey} onChange={e => set('apiKey', e.target.value)} /><span className="settings-help">{value.settings.hasApiKey ? 'Leave blank to keep the saved key at the same base URL.' : 'Optional for local models.'}</span></label>
      <label className="settings-permission"><input type="checkbox" checked={options.clearApiKey} onChange={e => set('clearApiKey', e.target.checked)} /><span>Remove saved key</span></label>
      <h3>Accounts to index</h3>{state.accounts.map(account => <label className="settings-permission" key={account.id}><input type="checkbox" checked={options.accounts.includes(account.id)} onChange={e => set('accounts', e.target.checked ? [...options.accounts, account.id] : options.accounts.filter(id => id !== account.id))} /><span>{account.email}</span></label>)}
      {['folders', 'content'].map(group => <div key={group}><h3>{group === 'folders' ? 'Folders' : 'Allowed content'}</h3>{Object.entries(options[group]).map(([key, checked]) => <label className="settings-permission" key={key}><input type="checkbox" checked={checked} onChange={e => set(group, { ...options[group], [key]: e.target.checked })} /><span>{key === 'sender' ? 'Sender and recipients (including Cc/Bcc)' : key}</span></label>)}</div>)}
      <p className="settings-help">Global AI permissions also apply. Unchecked fields and folders are excluded before any embedding request. Separate accounts are indexed in separate requests.</p>
      <label className="settings-field">Index history<select value={options.months} onChange={e => set('months', Number(e.target.value))}>{[1, 3, 6, 12].map(n => <option key={n} value={n}>Last {n} month(s)</option>)}</select></label>
      <label className="settings-field">Estimated token budget per batch<input type="number" min="4000" max="64000" step="1000" value={options.tokenBudget} onChange={e => set('tokenBudget', Number(e.target.value))} /><span className="settings-help">Conservative UTF-8 estimate, not a billing guarantee. Each reviewed batch also respects the global message limit and at most 50 text chunks. Only new or modified permitted text is indexed.</span></label>
      <div className="settings-actions"><button className="button primary" onClick={() => action('settings', options)}>Save search settings</button><button className="button secondary" disabled={dirty || !options.enabled || !value.permitted} onClick={() => action('index/preview')}>Preview next batch · no AI call</button></div>
    </fieldset>
    <div className="settings-test-result" role="status"><strong>{value.indexed} / {value.eligible} eligible messages indexed · {value.pending} pending</strong><p>{value.local ? 'Local embedding endpoint' : 'Remote embedding endpoint — approved mail text leaves this device'}. The index covers downloaded mail only. New mail requires another reviewed batch; there is no automatic paid indexing.</p></div>
    {value.job && <div className="settings-test-result semantic-samples"><strong>{value.job.status} · {value.job.completed} / {value.job.sampleCount} messages</strong><p>{value.job.chunks} chunks · estimated tokens ≤ {value.job.estimatedTokens} · {value.job.oversized} oversized messages excluded from this batch.</p>{value.job.error && <p role="alert">{value.job.error}</p>}
      {value.samples && <details><summary>Review excerpts (first three messages)</summary>{value.samples.map((sample, i) => <div key={i}><strong>{sample.account}</strong><pre>{sample.text}</pre></div>)}</details>}
      {value.job.status === 'prepared' && <button className="button primary" disabled={dirty || busy || disabled} onClick={() => action('index/run', { previewId: value.job.id })}>Index reviewed batch · uses embeddings</button>}
    </div>}
    <button className="button secondary" disabled={busy || disabled} onClick={() => { if (window.confirm('Delete semantic vectors and cancel indexing? Your mail and keyword index stay available.')) action('index/clear'); }}>Clear semantic index / cancel batch</button>
    {error && <p role="alert" className="search-error">{error}</p>}
  </section>;
}
