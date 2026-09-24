import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import './search.css';

export function SearchHighlight({ segments, fallback }) {
  return segments?.length ? segments.map((part, i) => part.hit ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>) : fallback;
}
const emptyFilters = { from: '', to: '', subject: '', label: '', after: '', before: '', is: '', in: '' };
export default function MailSearch({ api, account, folder, query, setQuery, inputRef, revision, onResult, onSettings }) {
  const [scope, setScope] = useState('folder'), [sort, setSort] = useState('relevance'), [filters, setFilters] = useState(emptyFilters);
  const [searchFolder, setSearchFolder] = useState(folder);
  const [smart, setSmart] = useState(false), [advanced, setAdvanced] = useState(false), [history, setHistory] = useState({ recent: [], saved: [] });
  const [result, setResult] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const request = useRef(0), abort = useRef(null), mounted = useRef(true);
  const active = !!query.trim() || scope !== 'folder' || searchFolder !== folder || Object.values(filters).some(Boolean);
  const options = { query, scope, folder: searchFolder, filters, sort, smart };
  const key = JSON.stringify(options);
  const lastKey = useRef(key);
  const publish = value => { setResult(value); onResult(value); };
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    api('/search/preferences', { account, signal: controller.signal }).then(setHistory).catch(() => {});
    return () => { mounted.current = false; controller.abort(); abort.current?.abort(); request.current++; };
  }, [account]);
  async function remember(action, value = options) {
    try { const next = await api('/search/preferences', { account, method: 'POST', body: JSON.stringify({ action, value }) }); if (mounted.current) setHistory(next); }
    catch (cause) { if (mounted.current) setError(cause.message); }
  }
  async function run(page = 0, record = false, cachedOnly = false) {
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    const ticket = ++request.current; setBusy(true); setError(''); publish({ messages: [], loading: true });
    try {
      const next = await api('/search', { account, method: 'POST', body: JSON.stringify({ ...options, page, cachedOnly }), signal: controller.signal });
      if (ticket === request.current && mounted.current) { publish(next); if (record) remember('recent'); }
    } catch (cause) { if (ticket === request.current && !controller.signal.aborted && mounted.current) { setError(cause.message); publish({ messages: [], error: true }); } }
    finally { if (ticket === request.current && mounted.current) setBusy(false); }
  }
  useEffect(() => {
    const changed = lastKey.current !== key; lastKey.current = key;
    request.current++; abort.current?.abort(); setBusy(false); setError('');
    if (!active) { publish(null); return; }
    publish({ messages: [], waiting: true });
    if (smart) { if (!changed && result?.total !== undefined) run(result.page, false, true); return; }
    const timer = setTimeout(() => run(), 250);
    return () => clearTimeout(timer);
  }, [key, revision]);
  function restore(value) { setQuery(value.query); setScope(value.scope); setSearchFolder(value.folder); setSort(value.sort); setFilters({ ...emptyFilters, ...value.filters }); setSmart(value.smart); setAdvanced(true); }
  function clear() { setQuery(''); setScope('folder'); setSearchFolder(folder); setFilters(emptyFilters); setSmart(false); }
  const label = value => value.query || Object.entries(value.filters).filter(([, text]) => text).map(([key, text]) => `${key}:${text}`).join(' ') || `${value.scope} mail`;
  return <section className="mail-search-controls" aria-label="Mail search">
    <form onSubmit={event => { event.preventDefault(); run(0, true); }}>
      <div className="message-search"><Search size={17} /><input ref={inputRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search mail or use from:, after:…" aria-label={`Search ${folder}`} /><button type="button" aria-label="Clear search" onClick={clear}><X size={14} /></button></div>
      <div className="search-actions"><button type="button" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>Filters & scope</button><button type="submit" disabled={busy}>{busy ? 'Searching…' : 'Search'}</button></div>
      {advanced && <div className="search-options">
        <label>Search scope<select value={scope} onChange={e => setScope(e.target.value)}><option value="folder">Folder: {searchFolder}</option><option value="account">Current account view</option><option value="all">All connected accounts</option></select></label>
        <label>Result order<select value={sort} onChange={e => setSort(e.target.value)}><option value="relevance">Most relevant</option><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
        {['from', 'to', 'subject', 'label', 'after', 'before'].map(field => <label key={field}>{({ from: 'From', to: 'To / Cc / Bcc', subject: 'Subject', label: 'Label', after: 'On / after (UTC)', before: 'Before (UTC)' })[field]}<input type={['after', 'before'].includes(field) ? 'date' : 'text'} value={filters[field]} onChange={e => setFilters({ ...filters, [field]: e.target.value })} /></label>)}
        <label>State<select value={filters.is} onChange={e => setFilters({ ...filters, is: e.target.value })}><option value="">Any</option><option value="unread">Unread</option><option value="read">Read</option><option value="starred">Starred</option></select></label>
        <label>Folder<select value={filters.in} onChange={e => setFilters({ ...filters, in: e.target.value })}><option value="">Any in selected scope</option>{['inbox', 'sent', 'drafts', 'archive', 'trash', 'starred'].map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="search-wide"><input type="checkbox" checked={smart} onChange={e => setSmart(e.target.checked)} />Smart search (智慧搜尋)</label>
        <small className="search-wide">Smart search sends your query to the configured embedding model only when you press Search. <button type="button" onClick={onSettings}>Configure indexing</button></small>
        <small className="search-wide">Words are combined with AND. Use quotes for an exact phrase. Filters narrow the chosen scope; Trash requires an explicit folder choice. Dates use UTC.</small>
      </div>}
    </form>
    <div className="search-chips">{Object.entries(filters).filter(([, value]) => value).map(([field, value]) => <button key={field} aria-label={`Remove ${field} filter`} onClick={() => setFilters({ ...filters, [field]: '' })}>{field}: {value} ×</button>)}{result?.chips?.map((chip, i) => <button key={i} onClick={() => setQuery(chip.query)} aria-label={`Remove ${chip.label}`}>{chip.label} ×</button>)}</div>
    <details className="search-history"><summary>Recent & saved searches</summary>
      {active && <button onClick={() => remember('save')}>Save this search</button>}
      {history.saved.map((value, i) => <div key={`s${i}`}><button onClick={() => restore(value)}>★ {label(value)}</button><button aria-label={`Remove saved search ${label(value)}`} onClick={() => remember('remove', value)}>×</button></div>)}
      {history.recent.map((value, i) => <button key={`r${i}`} onClick={() => restore(value)}>{label(value)}</button>)}
      {!!history.recent.length && <button onClick={() => remember('clear')}>Clear recent searches</button>}
    </details>
    {error && <p role="alert" className="search-error">{error}</p>}
    {smart && result?.waiting && <p role="status">Press Search to run semantic matching.</p>}
    {result?.total !== undefined && <div className="search-status" aria-live="polite"><strong>{result.total} {smart ? 'ranked matches' : 'matches'}</strong>
      <details><summary>Downloaded mail coverage</summary>{result.coverage.map(item => <p key={item.account}>{item.account}: {item.count} cached · {item.oldest?.slice(0, 10)} – {item.newest?.slice(0, 10)}</p>)}<p>Search covers downloaded mail only. Import older mail in Settings → Mail.</p></details>
      {result.warning && <p>{result.warning}</p>}
      <div className="search-actions"><button disabled={busy || !result.page} onClick={() => run(result.page - 1)}>Previous</button><span>Page {result.page + 1} / {Math.max(1, Math.ceil(result.total / 30))}</span><button disabled={busy || (result.page + 1) * 30 >= result.total} onClick={() => run(result.page + 1)}>Next</button></div>
    </div>}
  </section>;
}
