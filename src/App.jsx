import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArrowDownLeft, ArrowLeft, ArrowRight, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, CalendarDays, CircleHelp, FilePenLine, Inbox, Leaf, LoaderCircle, Mail, MailOpen, Menu, Pencil, Plus, RefreshCw, Search, Send, Settings as SettingsIcon, ShieldCheck, Sparkles, Star, Trash2, X } from 'lucide-react';
import Modal from './Modal';
import { storage } from './storage';
import FooterPreview from './FooterPreview';
import Settings from './Settings';
import Studio from './Studio';
import Calendar from './Calendar';
import { AI_BEHAVIORS, DEFAULT_POLICY, DEFAULT_PREFERENCES } from '../shared/features';

async function api(path, options = {}) {
  const { account, ...request } = options;
  const response = await fetch(`/api${path}`, { ...request, headers: { 'Content-Type': 'application/json', ...(account ? { 'X-Genmail-Account': typeof account === 'string' ? account : account.id || (account.mode === 'demo' ? 'demo' : account.email) } : {}), ...request.headers } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.error || `Request failed (${response.status}). Please try again.`), { status: response.status, requiresSendReview: result.requiresSendReview, draftId: result.draftId, deliveryRequestId: result.deliveryRequestId, messageRecord: result.message });
  return result;
}
const messageKey = message => message?.viewId || JSON.stringify([message?.accountId, message?.id]);
const demoAccount = { id: 'demo', email: 'alex@genmail.example', name: 'Demo workspace', mode: 'demo' };
const folders = [
  { id: 'inbox', name: 'Inbox', icon: Inbox }, { id: 'starred', name: 'Starred', icon: Star },
  { id: 'sent', name: 'Sent', icon: Send }, { id: 'drafts', name: 'Drafts', icon: FilePenLine },
  { id: 'archive', name: 'Archive', icon: Archive }, { id: 'trash', name: 'Trash', icon: Trash2 },
];
const categories = [{ id: 'all', name: 'All mail' }, { id: 'primary', name: 'Primary' }, { id: 'updates', name: 'Updates' }, { id: 'newsletters', name: 'Newsletters' }];
const initials = name => (name || '?').split(/[\s@]+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
const avatarColor = name => ['sage', 'peach', 'lilac', 'blue', 'sand'][([...name].reduce((sum, char) => sum + char.charCodeAt(0), 0)) % 5];
const shortDate = date => {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return '';
  return value.toDateString() === new Date().toDateString() ? value.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : value.toLocaleDateString([], { month: 'short', day: 'numeric' });
};
const fullDate = date => new Date(date).toLocaleString([], { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

function Avatar({ name, large = false }) { return <span className={`avatar ${avatarColor(name)} ${large ? 'large' : ''}`} aria-hidden="true">{initials(name)}</span>; }
function IconButton({ icon: Icon, label, children, ...props }) { return <button className="icon-button" title={label} aria-label={label} {...props}><Icon size={18} />{children}</button>; }

function AccountGroup({ account, active, children }) {
  const key = `morrow.account.collapsed.${account.id}`;
  const [open, setOpen] = useState(() => { try { return storage.getItem(key) !== 'true'; } catch { return true; } });
  return <details className={`account-group ${active ? 'current-account' : ''}`} open={open} onToggle={event => {
    const expanded = event.currentTarget.open;
    setOpen(expanded);
    try { storage.setItem(key, String(!expanded)); } catch { /* UI preferences may be unavailable in private browsing. */ }
  }}><summary title={account.email}><ChevronRight size={14} /><span><strong>{account.email}</strong><small>{account.provider === 'google' ? 'Google' : account.provider === 'microsoft' ? 'Outlook' : account.provider === 'imap' ? 'IMAP' : account.provider}</small></span>{account.unread > 0 && <span className="nav-count">{account.unread}</span>}</summary><div className="account-folders">{children}</div></details>;
}

function Compose({ initial, account: currentAccount, accounts, preferences, footer, policy, onClose, onSaved, onSent, onSettings, notify }) {
  const [owner, setOwner] = useState(initial?.accountId || (currentAccount.id === 'all' ? accounts[0]?.id || 'demo' : currentAccount.id));
  const account = owner === 'demo' ? demoAccount : accounts.find(item => item.id === owner) || { id: owner, email: owner, mode: 'live' };
  const sendLock = useRef(false);
  const aiRequest = useRef(0);
  const [draft, setDraft] = useState({ requestId: initial?.deliveryRequestId || crypto.randomUUID(), id: initial?.id, to: initial?.to || '', cc: initial?.cc || '', bcc: initial?.bcc || '', subject: initial?.subject || '', body: initial?.body || '', footer: initial?.id ? initial.footer : footer, replyToId: initial?.replyToId });
  const [saved, setSaved] = useState(JSON.stringify({ to: draft.to, cc: draft.cc, bcc: draft.bcc, subject: draft.subject, body: draft.body, footer: draft.footer }));
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [needsReview, setNeedsReview] = useState(initial?.deliveryStatus === 'unconfirmed');
  const [deliveryReviewed, setDeliveryReviewed] = useState(false);
  const [reviewSend, setReviewSend] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [aiAction, setAiAction] = useState('write');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const aiAllowed = policy.enabled && policy.behaviors[aiAction] && (aiAction === 'write' || (policy.folders.drafts && policy.content.body));
  const dirty = JSON.stringify({ to: draft.to, cc: draft.cc, bcc: draft.bcc, subject: draft.subject, body: draft.body, footer: draft.footer }) !== saved || (!draft.id && [draft.to, draft.cc, draft.bcc, draft.subject, draft.body].some(value => value.trim()));
  useEffect(() => {
    if (!dirty) return;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => () => { aiRequest.current += 1; }, []);
  useEffect(() => { aiRequest.current += 1; setAiBusy(false); setAiResult(null); }, [JSON.stringify(policy)]);
  function edit(field, value) { setReviewSend(false); aiRequest.current += 1; setAiBusy(false); setAiResult(null); setDraft(previous => ({ ...previous, [field]: value, requestId: crypto.randomUUID() })); }
  function close() { if (!busy && (!dirty || window.confirm('Discard your unsaved changes? Save draft to keep them.'))) onClose(); }
  async function generate() {
    if (aiBusy || busy || !aiAllowed) return;
    const request = ++aiRequest.current;
    setAiBusy(true); setAiResult(null); setError('');
    try {
      const result = await api('/ai', { account, method: 'POST', body: JSON.stringify({ action: aiAction, prompt: aiPrompt, ...(aiAction !== 'write' ? { draftText: draft.body } : {}) }) });
      if (request === aiRequest.current) setAiResult(result);
    } catch (cause) { if (request === aiRequest.current) setError(cause.message); }
    finally { if (request === aiRequest.current) setAiBusy(false); }
  }
  async function submit(send, confirmed = false) {
    if (sendLock.current || (send && needsReview && !deliveryReviewed)) return;
    if (send && !confirmed) { setReviewSend(true); return; }
    sendLock.current = true; setReviewSend(false);
    setBusy(send ? 'send' : 'save'); setError('');
    let submitted = false;
    try {
      let draftId = draft.id;
      if (send && !needsReview) {
        const savedDraft = await api('/drafts', { account, method: 'POST', body: JSON.stringify(draft) });
        draftId = savedDraft.message.id; setDraft(previous => ({ ...previous, id: draftId })); onSaved(savedDraft.message);
      }
      submitted = send;
      const result = await api(send ? '/send' : '/drafts', { account, method: 'POST', body: JSON.stringify(send ? { ...draft, draftId, retryUnconfirmed: needsReview && deliveryReviewed } : draft) });
      if (send) { onSent(result.message, draft.id); notify(result.simulated ? 'Demo message sent. No email left your device.' : 'Your message has been sent.'); onClose(); }
      else { setDraft(previous => ({ ...previous, id: result.message.id })); setSaved(JSON.stringify({ to: draft.to, cc: draft.cc, bcc: draft.bcc, subject: draft.subject, body: draft.body, footer: draft.footer })); onSaved(result.message); notify('Draft saved on this device.'); }
    } catch (cause) {
      setError(cause.message);
      if (cause.requiresSendReview || (submitted && !cause.status)) {
        setNeedsReview(true); setDeliveryReviewed(false); setShowAI(false);
        setDraft(previous => ({ ...previous, ...(cause.messageRecord || {}), id: cause.draftId || previous.id, requestId: cause.deliveryRequestId || previous.requestId }));
        if (!cause.status) setError("Delivery could not be confirmed. Check Sent before retrying this same message; retrying may send a duplicate.");
        setSaved(JSON.stringify({ to: draft.to, cc: draft.cc, bcc: draft.bcc, subject: draft.subject, body: draft.body, footer: draft.footer }));
        if (cause.messageRecord) onSaved(cause.messageRecord);
      }
    }
    finally { sendLock.current = false; setBusy(''); }
  }
  useEffect(() => {
    const shortcut = event => {
      if (!(event.ctrlKey || event.metaKey) || busy || aiBusy) return;
      if (event.key.toLowerCase() === 's' && !event.shiftKey) { event.preventDefault(); submit(false); }
      if (event.key.toLowerCase() === 'd' && event.shiftKey) { event.preventDefault(); submit(true); }
    };
    document.addEventListener('keydown', shortcut); return () => document.removeEventListener('keydown', shortcut);
  });
  return <Modal title={draft.replyToId ? 'A thoughtful reply' : 'A fresh conversation'} description={account.mode === 'demo' ? 'Demo mode · Sending is simulated. No email leaves your device.' : `Sending from ${preferences.displayName || account.name || ''} <${account.email}>`} onClose={close} closeDisabled={!!busy} className="compose-modal">
    <form className="compose-form" onSubmit={event => { event.preventDefault(); submit(true); }}>
      <label className="compose-field"><span>From</span><select aria-label="Sending account" value={owner} disabled={!!busy || aiBusy || !!draft.id || !!draft.replyToId || needsReview} onChange={event => { setOwner(event.target.value); setAiResult(null); setDraft(previous => ({ ...previous, requestId: crypto.randomUUID() })); }}>{[...accounts, demoAccount].map(item => <option key={item.id} value={item.id}>{item.mode === 'demo' ? 'Demo workspace (simulated)' : item.email}</option>)}</select></label>
      {draft.replyToId && <small className="reply-owner"><ShieldCheck size={14} />Replying from the mailbox that received this conversation.</small>}
      {['to', 'cc', 'bcc'].map(field => <label className="compose-field" key={field}><span>{field === 'to' ? 'To' : field === 'cc' ? 'Cc' : 'Bcc'}</span><input aria-label={field.toUpperCase()} value={draft[field]} onChange={event => edit(field, event.target.value)} placeholder="Email addresses, separated by commas or semicolons" autoFocus={field === 'to'} disabled={!!busy || needsReview} /></label>)}
      <small>Up to 100 plain email addresses across To, Cc and Bcc. Bcc stays hidden from other recipients.</small>
      <label className="compose-field"><span>Subject</span><input value={draft.subject} onChange={event => edit('subject', event.target.value)} placeholder="What’s on your mind?" disabled={!!busy || needsReview} /></label>
      <div className="compose-ai-toggle"><button type="button" className="button ghost" onClick={() => setShowAI(!showAI)} aria-expanded={showAI} disabled={needsReview}><Sparkles size={15} />Writing assistant<ChevronDown size={13} /></button><span>{preferences.replyTone} · {preferences.language}</span></div>
      {showAI && !needsReview && <div className="compose-ai-panel"><div className="compose-ai-tools"><label>Action<select value={aiAction} disabled={aiBusy || !!busy} onChange={event => { setAiAction(event.target.value); setAiResult(null); }}><option value="write">Write from instructions</option><option value="rewrite">Rewrite this draft</option><option value="translate">Translate this draft</option></select></label><label>{aiAction === 'translate' ? 'Language / instructions' : 'Instructions'}<input value={aiPrompt} maxLength={2000} disabled={aiBusy || !!busy} onChange={event => { setAiPrompt(event.target.value); setAiResult(null); }} placeholder={aiAction === 'translate' ? `Translate into ${preferences.language}` : aiAction === 'write' ? 'Thank Sam for the proposal and ask for a call Friday' : 'Make this clearer and more concise'} /></label><button type="button" className="button secondary" onClick={generate} disabled={!aiAllowed || aiBusy || !!busy || (aiAction === 'write' ? !aiPrompt.trim() : !draft.body.trim())}>{aiBusy ? <LoaderCircle size={15} className="spinning" /> : <Sparkles size={15} />}Preview</button></div>
        {!aiAllowed && <div className="policy-notice"><ShieldCheck size={14} /><span>This action is disabled by your AI permissions.</span><button type="button" onClick={() => { if (!dirty || window.confirm('Discard unsaved changes and open settings?')) { onClose(); onSettings(); } }}>Settings</button></div>}
        {aiResult && <div className="compose-ai-preview"><div><strong>Review before inserting</strong><span>{aiResult.source === 'demo' ? 'ILLUSTRATIVE DEMO' : 'AI GENERATED'}</span></div><pre>{aiResult.text}</pre><button type="button" className="button primary" onClick={() => edit('body', aiResult.text)}>Replace draft text<ArrowRight size={14} /></button></div>}
      </div>}
      <textarea className="compose-body" aria-label="Message body" placeholder="Make someone's inbox a little brighter…" value={draft.body} onChange={event => edit('body', event.target.value)} required disabled={!!busy || needsReview} />
      {(draft.footer?.text || draft.footer?.html) && <section className="draft-signature"><header><strong>Email footer</strong><button type="button" className="button ghost" disabled={!!busy || needsReview} onClick={() => edit('footer', { text: '', html: '' })}>Remove</button></header><FooterPreview footer={draft.footer} /></section>}
      {needsReview && <div className="inline-error" role="alert"><p>This delivery is unconfirmed. Check your provider’s Sent folder before retrying. The saved draft is preserved; another send may create a duplicate.</p><label><input type="checkbox" checked={deliveryReviewed} disabled={!!busy} onChange={event => setDeliveryReviewed(event.target.checked)} /> I checked Sent and want to retry this delivery.</label></div>}
      {error && <div className="inline-error" role="alert">{error}</div>}
      {reviewSend && <section className="compose-ai-panel" aria-label="Send review"><strong>Review recipients before sending</strong><pre>{`From: ${account.email}\nTo: ${draft.to}\nCc: ${draft.cc}\nBcc: ${draft.bcc}\nSubject: ${draft.subject || '(No subject)'}`}</pre><button type="button" className="button primary" disabled={!!busy} onClick={() => submit(true, true)}>Confirm send</button><button type="button" className="button secondary" onClick={() => setReviewSend(false)}>Cancel review</button></section>}
      <div className="compose-footer"><div className="compose-note"><ShieldCheck size={15} /><span>Review first. Send when ready.</span></div><div className="compose-actions"><button type="button" className="button secondary" onClick={() => submit(false)} disabled={!!busy || needsReview}>{busy === 'save' && <LoaderCircle size={16} className="spinning" />}Save draft</button><button type="submit" className="button primary" disabled={!!busy || (needsReview && !deliveryReviewed)}>{busy === 'send' ? <LoaderCircle size={16} className="spinning" /> : <Send size={16} />}{account.mode === 'demo' ? 'Send demo' : 'Send email'}</button></div></div>
    </form>
  </Modal>;
}

function OrganizeMail({ message, onClose, onUpdate }) {
  const [data, setData] = useState(null), [destination, setDestination] = useState(''), [mode, setMode] = useState('move');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [review, setReview] = useState(false);
  useEffect(() => { let active = true; api('/mail/folders', { account: message.accountId }).then(value => { if (active) setData(value); }).catch(cause => { if (active) setError(cause.message); }); return () => { active = false; }; }, [message.accountId]);
  const choices = (data?.folders || []).filter(folder => mode === 'move' || folder.kind === 'label');
  async function apply(confirmed = false) {
    if (busy || !destination) return;
    if (!confirmed) { setReview(true); return; }
    setBusy(true); setError('');
    try { await api(`/messages/${encodeURIComponent(message.id)}/organize`, { account: message.accountId, method: 'POST', body: JSON.stringify({ destinationId: destination, mode, confirmed: true }) }); onUpdate(); onClose(); }
    catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }
  return <Modal title="Move / Labels on Provider" description={message.accountId} onClose={onClose} closeDisabled={busy}>
    <div className="settings-section"><p>{message.subject}</p>{!data && !error && <p>Loading folders…</p>}
      {data?.provider === 'google' && <label className="settings-field">Action<select value={mode} disabled={busy} onChange={event => { setMode(event.target.value); setDestination(''); setReview(false); }}><option value="move">Move out of Inbox</option><option value="addLabel">Add label</option><option value="removeLabel">Remove label</option></select></label>}
      {data && <label className="settings-field">Folder / label<select value={destination} disabled={busy} onChange={event => { setDestination(event.target.value); setReview(false); }}><option value="">Choose a destination</option>{choices.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>}
      <p>Changes apply within this mailbox on your provider. Cached messages outside Inbox appear in local Archive; full folder sync is not yet supported. Gmail Move removes Inbox and retains other labels.</p>
      {error && <p className="inline-error" role="alert">{error}</p>}<button className="button primary" disabled={busy || !destination} onClick={() => apply()}>{busy ? 'Applying…' : 'Review change'}</button>
      {review && <section aria-label="Provider change review"><p>{message.accountId} · {mode} · {choices.find(folder => folder.id === destination)?.name}</p><button className="button primary" disabled={busy} onClick={() => apply(true)}>Apply provider change</button></section>}
    </div>
  </Modal>;
}

export default function App() {
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [folder, setFolder] = useState('inbox');
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [mobileReading, setMobileReading] = useState(false);
  const [isNarrow, setIsNarrow] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [page, setPage] = useState('mail');
  const [settingsTab, setSettingsTab] = useState('general');
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [calendarDirty, setCalendarDirty] = useState(false);
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [studioDirty, setStudioDirty] = useState(false);
  const [studioBusy, setStudioBusy] = useState(false);
  const [studioSelectedId, setStudioSelectedId] = useState(null);
  const settingsOpen = page === 'settings';
  const [compose, setCompose] = useState(null);
  const [organizing, setOrganizing] = useState(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [pendingIds, setPendingIds] = useState(new Set());
  const [toast, setToast] = useState(null);
  const accountVersion = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const syncLock = useRef(false);
  const preferences = { ...DEFAULT_PREFERENCES, ...state?.settings.preferences };
  const policy = state?.settings.policy || DEFAULT_POLICY;
  const aiRequest = useRef(0);
  const toastTimeout = useRef(null);
  const searchInput = useRef(null);

  const notify = useCallback((message, type = 'success') => { setToast({ message, type }); window.clearTimeout(toastTimeout.current); toastTimeout.current = window.setTimeout(() => setToast(null), 5000); }, []);
  const applyState = useCallback(next => {
    const previous = stateRef.current;
    const changedAccount = previous && (previous.account.mode !== next.account.mode || previous.account.email !== next.account.email);
    accountVersion.current += 1; aiRequest.current += 1;
    setState(next); setAiResult(null); setAiBusy(false); setAiError('');
    if (changedAccount) { setFolder('inbox'); setCategory('all'); setQuery(''); setSelectedId(null); setStudioSelectedId(null); setMobileReading(false); setCompose(null); }
  }, []);
  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    try { applyState(await api('/state')); } catch (cause) { setLoadError(cause.message); } finally { setLoading(false); }
  }, [applyState]);
  useEffect(() => {
    load();
    const params = new URLSearchParams(window.location.search);
    if (params.has('connected')) notify('Your mailbox is connected. Welcome to a calmer inbox.');
    if (params.has('connectionError')) notify(params.get('connectionError') || 'Mailbox connection failed. Please try again.', 'error');
    if (params.has('calendarConnected')) { notify('Your calendar is connected.'); setPage('calendar'); }
    if (params.has('calendarError')) { notify(params.get('calendarError') || 'Calendar connection failed.', 'error'); setPage('settings'); setSettingsTab('calendar'); }
    if (['connected', 'connectionError', 'calendarConnected', 'calendarError'].some(key => params.has(key))) { for (const key of ['connected', 'connectionError', 'calendarConnected', 'calendarError']) params.delete(key); window.history.replaceState({}, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`); }
    return () => window.clearTimeout(toastTimeout.current);
  }, [load, notify]);
  useEffect(() => { aiRequest.current += 1; setAiBusy(false); setAiResult(null); }, [JSON.stringify(policy)]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => { document.documentElement.dataset.theme = preferences.theme === 'system' ? (media.matches ? 'dark' : 'light') : preferences.theme; };
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [preferences.theme]);
  useEffect(() => {
    if (!preferences.syncInterval || !state) return;
    const timer = window.setInterval(() => { if (!compose && !settingsBusy && pendingIds.size === 0) sync(true); }, preferences.syncInterval * 60000);
    return () => window.clearInterval(timer);
  }, [preferences.syncInterval, state?.account.mode, state?.account.email, compose, settingsBusy, pendingIds.size]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => setIsNarrow(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    function shortcut(event) {
      const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
      if ((event.ctrlKey || event.metaKey) && !compose && !settingsBusy && !calendarBusy && !studioBusy && !syncing) {
        const key = event.key.toLowerCase();
        if (key === 'n') { event.preventDefault(); if (navigate('mail')) setCompose({}); }
        if (key === 'f') { event.preventDefault(); if (navigate('mail')) searchInput.current?.focus(); }
        if (key === ',') { event.preventDefault(); setSettingsOpen(true); }
        if (key === 'r') { event.preventDefault(); if (event.shiftKey) { if (page === 'mail' && selected?.folder !== 'drafts') reply(); } else sync(); }
        if (['1', '2', '3'].includes(key)) { event.preventDefault(); if (key === '1') changeFolder('inbox'); else if (key === '2') openStudio(); else navigate('calendar'); }
      }
      if (event.key === '/' && !editing && !settingsOpen && !compose) { event.preventDefault(); searchInput.current?.focus(); }
      if (event.key === 'Escape') { setSidebarOpen(false); if (!settingsOpen && !compose) setAssistantOpen(false); }
    }
    document.addEventListener('keydown', shortcut); return () => document.removeEventListener('keydown', shortcut);
  });

  const messages = state?.messages || [];
  const filtered = useMemo(() => messages.filter(message => (folder === 'starred' ? message.starred && message.folder !== 'trash' : message.folder === folder) && (category === 'all' || message.category === category) && (!query.trim() || `${message.fromName} ${message.fromEmail} ${message.to} ${message.subject} ${message.body}`.toLowerCase().includes(query.trim().toLowerCase()))).sort((a, b) => {
    let difference = 0;
    if (preferences.sort === 'sender' || preferences.sort === 'subject') { const key = preferences.sort === 'sender' ? 'fromName' : 'subject'; difference = a[key].localeCompare(b[key], undefined, { sensitivity: 'base', numeric: true }); }
    if (preferences.sort === 'unread') difference = Number(a.read) - Number(b.read);
    if (preferences.sort === 'starred') difference = Number(b.starred) - Number(a.starred);
    return difference || (preferences.sort === 'oldest' ? new Date(a.date) - new Date(b.date) : new Date(b.date) - new Date(a.date)) || messageKey(a).localeCompare(messageKey(b));
  }), [messages, folder, category, query, preferences.sort]);
  const selected = filtered.find(message => messageKey(message) === selectedId) || filtered[0] || null;
  const unread = messages.filter(message => message.folder === 'inbox' && !message.read).length;
  const currentFolder = folders.find(item => item.id === folder);
  const selectedIndex = filtered.findIndex(message => messageKey(message) === messageKey(selected));
  const localUpdate = useCallback(() => {
    const version = accountVersion.current;
    api('/state', { account: stateRef.current.account }).then(next => { if (version === accountVersion.current) setState(next); }).catch(cause => notify(cause.message, 'error'));
  }, [notify]);

  const patch = useCallback(async (message, changes, silent = false) => {
    const version = accountVersion.current;
    setPendingIds(previous => new Set([...previous, messageKey(message)]));
    try {
      const result = await api(`/messages/${encodeURIComponent(message.id)}`, { account: message.accountId, method: 'PATCH', body: JSON.stringify(changes) });
      if (version !== accountVersion.current) return;
      localUpdate(result.message);
      if (!silent && changes.folder) notify(changes.folder === 'archive' ? 'Moved to Archive on this device.' : changes.folder === 'trash' ? 'Moved to Trash on this device.' : 'Moved to Inbox on this device.');
    } catch (cause) { if (version === accountVersion.current) notify(cause.message, 'error'); }
    finally { setPendingIds(previous => { const next = new Set(previous); next.delete(messageKey(message)); return next; }); }
  }, [localUpdate, notify, state?.account.email, state?.account.mode]);

  useEffect(() => {
    if (page === 'mail' && preferences.markReadOnOpen && selected && !selected.read && selected.folder !== 'drafts' && (!isNarrow || mobileReading)) {
      patch(selected, { read: true }, true);
    }
    setAiResult(previous => previous?.messageId && previous.viewId !== messageKey(selected) ? null : previous);
    setAiError(''); aiRequest.current += 1; setAiBusy(false);
  }, [selected?.viewId, state?.account.email, mobileReading, isNarrow, page, preferences.markReadOnOpen]);

  function navigate(next) {
    if (page === 'settings' && next !== page) {
      if (settingsBusy) { notify('Wait for the current settings operation to finish.', 'error'); return false; }
      if (settingsDirty && !window.confirm('Discard your unsaved settings changes?')) return false;
      setSettingsDirty(false);
    }
    if (page === 'calendar' && next !== page) {
      if (calendarBusy) { notify('Wait for the calendar operation to finish.', 'error'); return false; }
      if (calendarDirty && !window.confirm('Discard your unsaved calendar event?')) return false;
      setCalendarDirty(false);
    }
    if (page === 'studio' && next !== page) {
      if (studioBusy) { notify('Wait for AI Studio to finish.', 'error'); return false; }
      if (studioDirty && !window.confirm('Discard unsaved AI Studio changes?')) return false;
      setStudioDirty(false);
    }
    setPage(next); setSidebarOpen(false); return true;
  }
  function setSettingsOpen(open, tab = 'general') { if (open) setSettingsTab(tab === 'permissions' ? 'policy' : tab); navigate(open ? 'settings' : 'mail'); }
  function openStudio() { if (navigate('studio')) setStudioSelectedId(selected ? messageKey(selected) : null); }
  function allowed(action, message = null) { return (state?.account.id !== 'all' || !!message) && policy.enabled && policy.behaviors[action] && (!message || policy.folders[message.folder]) && (action === 'write' || (['subject', 'body', 'sender'].some(field => policy.content[field]) && (message || Object.values(policy.folders).some(Boolean)))); }
  function changeFolder(next) { if (!navigate('mail')) return; setFolder(next); setCategory('all'); setQuery(''); setSelectedId(null); setMobileReading(false); setSidebarOpen(false); }
  function selectMessage(message) { setSelectedId(messageKey(message)); setMobileReading(true); if (message.folder === 'drafts') setCompose({ ...message }); }
  function reply(body = '') { if (selected) setCompose({ accountId: selected.accountId, to: selected.folder === 'sent' ? selected.to : selected.fromEmail, subject: /^re:/i.test(selected.subject) ? selected.subject : `Re: ${selected.subject}`, body, replyToId: selected.id }); }
  async function sync(automatic = false) {
    if (syncLock.current || !state) return;
    syncLock.current = true;
    const version = accountVersion.current; setSyncing(true);
    try { const next = await api('/sync', { account: state.account, method: 'POST' }); if (version === accountVersion.current) { setState(next); if (next.syncErrors?.length) notify(`Could not sync: ${next.syncErrors.map(item => item.accountId).join(', ')}. Check Settings.`, 'error'); else if (!automatic) notify(state.account.mode === 'demo' ? 'Your demo inbox is up to date.' : 'Mailboxes synced. Latest messages are ready.'); } } catch (cause) { notify(cause.message, 'error'); } finally { syncLock.current = false; setSyncing(false); }
  }
  async function askAI(action, prompt = '') {
    if (aiBusy || !allowed(action, action === 'ask' ? null : selected)) return;
    const request = ++aiRequest.current;
    const messageId = action === 'ask' ? undefined : selected?.id;
    if (action !== 'ask' && !messageId) return;
    setAssistantOpen(true); setAiBusy(true); setAiError(''); setAiResult(null);
    try {
      const result = await api('/ai', { account: action === 'ask' ? state.account : selected.accountId, method: 'POST', body: JSON.stringify({ action, messageId, prompt }) });
      if (request === aiRequest.current) setAiResult({ ...result, action, messageId, viewId: messageKey(selected), prompt });
    } catch (cause) { if (request === aiRequest.current) setAiError(cause.message); }
    finally { if (request === aiRequest.current) setAiBusy(false); }
  }
  function sent() { localUpdate(); }
  async function preference(key, value) {
    const version = accountVersion.current;
    try { const next = await api('/settings/preferences', { account: state.account, method: 'POST', body: JSON.stringify({ [key]: value }) }); if (version === accountVersion.current) setState(next); }
    catch (error) { notify(error.message, 'error'); }
  }
  async function selectAccount(accountId, nextFolder = 'inbox') {
    if (syncing || settingsBusy || pendingIds.size || compose || !navigate('mail')) return;
    if (accountId === state.account.id) { changeFolder(nextFolder); return; }
    setSyncing(true);
    try { applyState(await api('/account/select', { method: 'POST', body: JSON.stringify({ accountId }) })); setFolder(nextFolder); setSidebarOpen(false); }
    catch (cause) { notify(cause.message, 'error'); }
    finally { setSyncing(false); }
  }


  if (loading || !state) return <div className="startup"><img className="startup-brand" src="/brand/morrow-icon.svg" alt="Morrow Mail" /><h1>morrow<span>.</span></h1>{loading ? <><LoaderCircle className="spinning" size={22} /><p>A little more headspace is on its way.</p></> : <><p role="alert">{loadError || 'We couldn’t load your workspace.'}</p><button className="button primary" onClick={load}><RefreshCw size={16} />Try again</button></>}<span className="startup-caption">YOUR INBOX. YOUR TERMS.</span></div>;

  return <div className={`app-shell ${sidebarOpen ? 'nav-open' : ''}`} data-density={preferences.density}>
    {sidebarOpen && <button className="nav-backdrop" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
    <aside className="sidebar" aria-label="Mailbox navigation">
      <a href="#" className="brand" onClick={event => { event.preventDefault(); changeFolder('inbox'); }}><img className="brand-image" src="/brand/morrow-icon.svg" alt="" /><span>morrow<span className="brand-dot">.</span></span><span className="open-tag">OPEN</span></a>
      <button className="compose-button" disabled={settingsBusy} onClick={() => { setCompose({}); setSidebarOpen(false); }}><Pencil size={18} />Compose<span><Plus size={16} /></span></button>
      <div className="nav-label">ACCOUNTS</div>
      <nav aria-label="Account views" className="account-groups">
        {[...(state.accounts.length ? [{ id: 'all', email: 'All accounts', provider: 'Combined mail' }] : []), ...state.accounts, { ...demoAccount, email: 'Demo workspace', provider: 'Sample mail' }].map(account => <AccountGroup key={account.id} account={account} active={state.account.id === account.id}>
          {folders.map(item => {
            const Icon = item.icon;
            const count = account.id === 'all' ? state.accounts.reduce((total, row) => total + (item.id === 'inbox' ? row.unread : row.counts?.[item.id] || 0), 0) : account.id === 'demo' ? (state.account.id === 'demo' ? messages.filter(message => message.folder === item.id && (item.id !== 'inbox' || !message.read)).length : 0) : item.id === 'inbox' ? account.unread : account.counts?.[item.id] || 0;
            const active = state.account.id === account.id && page === 'mail' && folder === item.id;
            return <button key={item.id} className={`nav-item ${active ? 'active' : ''}`} disabled={syncing || settingsBusy || pendingIds.size > 0} onClick={() => selectAccount(account.id, item.id)} aria-current={active ? 'page' : undefined}><Icon size={16} /><span>{item.name}</span>{['inbox', 'drafts'].includes(item.id) && count > 0 && <span className="nav-count">{count}</span>}</button>;
          })}
        </AccountGroup>)}
      </nav>
      <button className="nav-item" onClick={() => setSettingsOpen(true, 'mail')}><Plus size={18} /><span>Add account</span></button>
      <div className="sidebar-divider" />
      <button className={`nav-item ${page === 'calendar' ? 'active' : ''}`} onClick={() => navigate('calendar')} aria-current={page === 'calendar' ? 'page' : undefined}><CalendarDays size={19} /><span>Calendar</span></button>
      <div className="sidebar-divider" />
      <button className={`nav-item assistant-nav ${assistantOpen ? 'selected' : ''}`} onClick={() => { if (navigate('mail')) setAssistantOpen(previous => !previous); }}><Sparkles size={19} /><span>AI assistant</span><span className="tiny-tag">AI</span></button>
      <button className={`nav-item studio-nav ${page === 'studio' ? 'active' : ''}`} onClick={openStudio} aria-current={page === 'studio' ? 'page' : undefined}><Sparkles size={19} /><span>AI Studio</span><span className="tiny-tag">{AI_BEHAVIORS.length}</span></button>
      <div className="sidebar-bottom"><div className="local-card"><div className="local-card-icon"><Leaf size={18} /></div><strong>A calmer kind of email.</strong><p>Open source. Local first.<br />Always on your terms.</p><div className="local-status"><span />Your workspace, your device</div></div>
        <button className="sidebar-settings" onClick={() => { setSettingsOpen(true); setSidebarOpen(false); }}><SettingsIcon size={18} /><span>Settings & connections</span></button>
        <button className="account-button" onClick={() => { setSettingsOpen(true); setSidebarOpen(false); }}><Avatar name={preferences.displayName || state.account.name || state.account.email} /><span className="account-text"><strong>{preferences.displayName || state.account.name || state.account.email.split('@')[0]}</strong><small>{state.account.mode === 'demo' ? 'Demo workspace' : state.account.id === 'all' ? `${state.accounts.length} connected accounts` : state.account.email}</small></span><ChevronDown size={15} /></button>
      </div>
    </aside>

    <main className="workspace">
      <header className="topbar"><div className="breadcrumbs"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button><span className="breadcrumb-home">Workspace</span><ChevronRight size={13} /><strong>{page === 'settings' ? 'Settings' : page === 'studio' ? 'AI Studio' : page === 'calendar' ? 'Calendar' : currentFolder.name}</strong></div><div className="topbar-right"><span className={`mode-badge ${state.account.mode}`}><span />{page === 'calendar' ? 'Live calendars' : state.account.mode === 'demo' ? 'Demo mode' : 'Connected'}</span><button className="topbar-sync" aria-label="Sync mail" onClick={() => sync()} disabled={syncing || settingsBusy || pendingIds.size > 0}><RefreshCw size={14} className={syncing ? 'spinning' : ''} /><span>{syncing ? 'Syncing…' : 'Sync mail'}</span></button><span className="topbar-separator" /><IconButton icon={SettingsIcon} label="Settings and connections" onClick={() => setSettingsOpen(true)} /></div></header>
      {page === 'settings' ? <Settings page initialTab={settingsTab} state={state} onClose={() => { setSettingsDirty(false); setPage('mail'); setFolder('inbox'); setCategory('all'); setQuery(''); setSelectedId(null); setMobileReading(false); }} onUpdate={applyState} notify={notify} onDirtyChange={setSettingsDirty} onBusyChange={setSettingsBusy} /> : page === 'calendar' ? <Calendar onNotify={notify} onOpenSettings={() => setSettingsOpen(true, 'calendar')} onDirtyChange={setCalendarDirty} onBusyChange={setCalendarBusy} /> : page === 'studio' ? state.account.id === 'all' ? <div className="page-heading"><div><h1>Choose an account.</h1><p>Select a mailbox in the sidebar to use its AI Studio. Each account has its own context, skills, and activity.</p></div></div> : <Studio key={state.account.id} onDirtyChange={setStudioDirty} onBusyChange={setStudioBusy} state={state} selectedMessage={messages.find(message => messageKey(message) === studioSelectedId) || null} onUpdate={applyState} onCompose={setCompose} onSettings={tab => setSettingsOpen(true, tab)} notify={notify} /> : <>
      <div className="page-heading"><div><div className="eyebrow"><span />A LITTLE MORE HEADSPACE</div><h1>{currentFolder.name}<span className="heading-period">.</span></h1><p>{folder === 'inbox' ? unread ? `You have ${unread} unread ${unread === 1 ? 'message' : 'messages'}. Let’s make room for what matters.` : 'You’re all caught up. Make room for what matters.' : folder === 'starred' ? 'The conversations you want to keep close.' : folder === 'drafts' ? 'Good things start with a few words.' : folder === 'sent' ? 'Thoughts shared. Conversations started.' : folder === 'archive' ? 'Out of the way. Always here when you need them.' : 'A little room to let things go.'}</p></div><button className={`button assistant-toggle ${assistantOpen ? 'is-active' : ''}`} aria-label="Ask your inbox" onClick={() => setAssistantOpen(previous => !previous)} aria-expanded={assistantOpen}><Sparkles size={17} /><span>Ask your inbox</span><span className="keyboard-hint">AI</span></button></div>
      {state.account.mode === 'demo' && <div className="demo-banner"><span className="demo-banner-dot" /><p>You’re exploring a sample inbox.<span> Connect your mailbox when you’re ready.</span></p><button onClick={() => setSettingsOpen(true, 'mail')}>Connect account<ArrowRight size={14} /></button></div>}
      <div className={`mail-workspace ${mobileReading ? 'show-reader' : ''} ${assistantOpen ? 'with-assistant' : ''}`}>
        <section className="message-pane" aria-label="Messages">
          <div className="message-search"><Search size={17} /><input ref={searchInput} value={query} onChange={event => { setQuery(event.target.value); setSelectedId(null); }} placeholder={`Search ${currentFolder.name.toLowerCase()}…`} aria-label={`Search ${currentFolder.name.toLowerCase()}`} />{query ? <button aria-label="Clear search" onClick={() => setQuery('')}><X size={14} /></button> : <kbd>/</kbd>}</div>
          <div className="category-tabs" role="group" aria-label="Message category">{categories.map(item => <button key={item.id} className={category === item.id ? 'active' : ''} aria-pressed={category === item.id} onClick={() => { setCategory(item.id); setSelectedId(null); }}>{item.name}</button>)}</div>
          <div className="list-meta"><span>{filtered.length} {filtered.length === 1 ? 'conversation' : 'conversations'}</span><select aria-label="Sort messages" value={preferences.sort} onChange={event => preference('sort', event.target.value)}>{[['newest', 'Newest first'], ['oldest', 'Oldest first'], ['sender', 'Sender A–Z'], ['subject', 'Subject A–Z'], ['unread', 'Unread first'], ['starred', 'Starred first']].map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select><select aria-label="Inbox density" value={preferences.density} onChange={event => preference('density', event.target.value)}>{['compact', 'comfortable', 'spacious'].map(value => <option key={value}>{value}</option>)}</select></div>
          <div className="message-list">
            {filtered.length ? filtered.map(message => <article key={messageKey(message)} className={`message-row ${messageKey(selected) === messageKey(message) ? 'selected' : ''} ${!message.read ? 'unread' : ''}`}>
              <button className="message-select" onClick={() => selectMessage(message)} aria-label={`${message.read ? '' : 'Unread: '}${message.fromName}, ${message.subject}`} aria-current={messageKey(selected) === messageKey(message) ? 'true' : undefined}>
                <div className="message-row-top"><Avatar name={message.fromName} /><span className="message-sender">{message.folder === 'sent' || message.folder === 'drafts' ? `To: ${message.to || 'New recipient'}` : message.fromName}</span><time dateTime={message.date}>{shortDate(message.date)}</time></div>
                <div className="message-row-content">{state.account.id === 'all' && <small className="mailbox-label">{message.accountId}</small>}<h3>{message.subject || '(No subject)'}</h3><p>{message.preview || message.body || 'An empty page, ready for your words.'}</p><div className="message-row-bottom"><span className={`category-label ${message.category}`}><span />{message.category === 'primary' ? 'Primary' : message.category === 'updates' ? 'Updates' : 'Newsletter'}</span>{!message.read && <span className="unread-dot" aria-label="Unread" />}</div></div>
              </button>
              <button className={`message-star ${message.starred ? 'starred' : ''}`} aria-label={message.starred ? 'Remove star' : 'Star message'} title={message.starred ? 'Remove star' : 'Star message'} onClick={() => patch(message, { starred: !message.starred }, true)} disabled={pendingIds.has(messageKey(message)) || syncing}><Star size={15} fill={message.starred ? 'currentColor' : 'none'} /></button>
            </article>) : <div className="list-empty"><Search size={27} strokeWidth={1.4} /><h3>{query ? 'No matches, just yet.' : 'A little breathing room.'}</h3><p>{query ? 'Try a different name or keyword.' : category !== 'all' ? 'No messages in this category.' : `Your ${currentFolder.name.toLowerCase()} is empty.`}</p>{(query || category !== 'all') && <button className="button secondary" onClick={() => { setQuery(''); setCategory('all'); }}>Clear filters</button>}</div>}
          </div><div className="list-footer"><ShieldCheck size={13} />Local cache · provider moves available in reader</div>
        </section>
        <section className="reader-pane" aria-label="Message detail">
          {selected ? <>
            <div className="reader-toolbar"><div>{/^(google|microsoft|imap):/.test(selected.remoteId || selected.id) && <button className="button ghost" disabled={syncing || pendingIds.has(messageKey(selected))} onClick={() => setOrganizing(selected)}>Move / Labels</button>}<button className="icon-button reader-back" aria-label="Back to messages" onClick={() => setMobileReading(false)}><ArrowLeft size={18} /></button><IconButton icon={selected.folder === 'archive' || selected.folder === 'trash' ? Inbox : Archive} label={selected.folder === 'archive' || selected.folder === 'trash' ? 'Move to inbox locally' : 'Archive locally'} onClick={() => patch(selected, { folder: selected.folder === 'archive' || selected.folder === 'trash' ? 'inbox' : 'archive' })} disabled={pendingIds.has(messageKey(selected)) || syncing || selected.folder === 'drafts' || selected.folder === 'sent'} /><IconButton icon={Trash2} label="Move to trash locally" onClick={() => patch(selected, { folder: 'trash' })} disabled={pendingIds.has(messageKey(selected)) || syncing || selected.folder === 'trash'} /><span className="toolbar-divider" /><IconButton icon={selected.read ? Mail : MailOpen} label={selected.read ? 'Mark unread locally' : 'Mark read locally'} onClick={() => patch(selected, { read: !selected.read }, true)} disabled={pendingIds.has(messageKey(selected)) || syncing} /><button className={`icon-button ${selected.starred ? 'starred' : ''}`} title={selected.starred ? 'Remove star' : 'Star message'} aria-label={selected.starred ? 'Remove star' : 'Star message'} onClick={() => patch(selected, { starred: !selected.starred }, true)} disabled={pendingIds.has(messageKey(selected)) || syncing}><Star size={18} fill={selected.starred ? 'currentColor' : 'none'} /></button></div><div className="reader-pagination"><span>{selectedIndex + 1} of {filtered.length}</span><IconButton icon={ChevronLeft} label="Previous message" disabled={selectedIndex <= 0} onClick={() => setSelectedId(messageKey(filtered[selectedIndex - 1]))} /><IconButton icon={ChevronRight} label="Next message" disabled={selectedIndex >= filtered.length - 1} onClick={() => setSelectedId(messageKey(filtered[selectedIndex + 1]))} /></div></div>
            <div className="reader-content" key={messageKey(selected)}><div className="reader-heading"><p className="mailbox-label">Mailbox: {selected.accountId}</p><div className="reader-labels"><span className="eyebrow">{selected.folder === 'sent' ? 'SENT CONVERSATION' : selected.folder === 'drafts' ? 'YOUR DRAFT' : 'CONVERSATION'}</span>{selected.labels?.slice(0, 2).map(label => <span className="message-label" key={label}>{label}</span>)}</div><h2>{selected.subject || '(No subject)'}</h2></div>
              {selected.providerFolderName && <p>Provider location: {selected.providerFolderName}</p>}
              {selected.cc && <p>Cc: {selected.cc}</p>}{selected.bcc && <p>Bcc: {selected.bcc}</p>}
              <div className="sender-detail"><Avatar name={selected.fromName} large /><div><div className="sender-name"><strong>{selected.fromName}</strong><span>&lt;{selected.fromEmail}&gt;</span></div><span className="sender-recipient">to {selected.to === state.account.email ? 'me' : selected.to || '—'}<ChevronDown size={12} /></span></div><time dateTime={selected.date} title={fullDate(selected.date)}>{shortDate(selected.date)}</time></div>
              {selected.folder !== 'drafts' && <button className="summary-callout" onClick={() => askAI('summary')} disabled={aiBusy || !allowed('summary', selected)}><span className="summary-icon"><Sparkles size={18} /></span><span><strong>A little clarity, in a click.</strong><small>Get the key points with your AI assistant</small></span><ArrowRight size={17} /></button>}
              <div className="message-body">{selected.body || <span className="muted">This message has no content yet.</span>}</div>
              <FooterPreview footer={selected.footer} />
              <div className="message-end"><span /><Leaf size={14} /><span /></div>
              <div className="reply-actions">{selected.folder === 'drafts' ? <button className="button primary" onClick={() => setCompose({ ...selected })}><Pencil size={16} />Continue writing</button> : <><button className="button primary" onClick={() => reply()}><ArrowDownLeft size={17} />Reply</button><button className="button secondary ai-reply" onClick={() => askAI('reply')} disabled={aiBusy || !allowed('reply', selected)}><Sparkles size={16} />Draft a reply<span>AI</span></button></>}</div>
              <p className="message-privacy"><ShieldCheck size={13} />Your words. Your final say. Nothing sends automatically.</p>
            </div>
          </> : <div className="reader-empty"><div className="empty-art"><Mail size={42} strokeWidth={1} /><span><Leaf size={16} /></span></div><span className="eyebrow">ROOM TO BREATHE</span><h2>Less noise.<br />More possibility.</h2><p>{query ? 'Your next conversation is just a search away.' : 'Choose a conversation, or start a new one.'}</p><button className="button secondary" onClick={() => setCompose({})}><Plus size={16} />Write something good</button></div>}
        </section>
        {assistantOpen && <aside className="assistant-pane" aria-label="AI assistant"><div className="assistant-header"><div><span className="assistant-logo"><Sparkles size={19} /></span><strong>A little assistance</strong></div><IconButton icon={X} label="Close AI assistant" onClick={() => setAssistantOpen(false)} /></div><div className="assistant-scroll"><div className="assistant-intro"><span className="eyebrow">YOUR INBOX, IN FOCUS</span><h2>Let’s lighten<br />the load.</h2><p>Find the important bits.<br />Find the words. Find your flow.</p><span className={`ai-mode ${state.settings.ai.configured ? 'configured' : ''}`}><span />{state.settings.ai.configured ? state.settings.ai.model : state.account.mode === 'demo' ? 'Demo AI · illustrative responses' : 'Choose an AI model in Settings'}</span></div>
          <div className="assistant-suggestions"><button disabled={!selected || aiBusy || !allowed('summary', selected)} onClick={() => askAI('summary')}><Mail size={16} /><span>Summarize this message</span><ArrowRight size={14} /></button><button disabled={!selected || aiBusy || !allowed('reply', selected)} onClick={() => askAI('reply')}><Pencil size={16} /><span>Help me write a reply</span><ArrowRight size={14} /></button><button disabled={aiBusy || !allowed('ask')} onClick={() => { const prompt = 'What needs my attention in my inbox?'; setAiPrompt(prompt); askAI('ask', prompt); }}><CheckCheck size={16} /><span>What needs my attention?</span><ArrowRight size={14} /></button></div>
          {(!allowed('ask') || (selected && (!allowed('summary', selected) || !allowed('reply', selected)))) && <div className="policy-notice"><ShieldCheck size={15} /><span>Some AI actions are disabled by your permissions.</span><button onClick={() => setSettingsOpen(true, 'policy')}>Manage</button></div>}
          <button className="assistant-studio-link" onClick={openStudio}>Explore all {AI_BEHAVIORS.length} tools in AI Studio<ArrowRight size={14} /></button>
          {aiBusy && <div className="ai-loading" role="status"><Sparkles size={18} className="pulse" /><span>Making a little room for clarity…</span></div>}
          {aiError && <div className="ai-error" role="alert"><p>{aiError}</p><button className="button secondary" onClick={() => setSettingsOpen(true, 'model')}>AI settings<ArrowRight size={14} /></button></div>}
          {aiResult && <div className="ai-response"><div className="ai-response-title"><Sparkles size={15} /><strong>{aiResult.action === 'reply' ? 'A starting point' : aiResult.action === 'summary' ? 'The important bits' : 'From your inbox'}</strong><span>{aiResult.source === 'demo' ? 'DEMO' : 'AI'}</span></div>{aiResult.prompt && <p className="ai-question">{aiResult.prompt}</p>}<div className="ai-response-text">{aiResult.text}</div>{aiResult.source === 'demo' && <p className="ai-demo-note">Illustrative demo output. Connect a model for real AI responses.</p>}{aiResult.action === 'reply' && aiResult.viewId === messageKey(selected) && <button className="button primary use-draft" onClick={() => reply(aiResult.text)}>Use in a draft<ArrowRight size={15} /></button>}</div>}
        </div><div className="assistant-bottom"><form className="assistant-input" onSubmit={event => { event.preventDefault(); if (aiPrompt.trim()) askAI('ask', aiPrompt.trim()); }}><textarea maxLength={2000} aria-label="Ask about your inbox" placeholder="Ask about your inbox…" rows={2} value={aiPrompt} onChange={event => setAiPrompt(event.target.value)} disabled={aiBusy} /><div><span><Sparkles size={12} />Made for a lighter day</span><button type="submit" aria-label="Ask AI" disabled={aiBusy || !aiPrompt.trim() || !allowed('ask')}><ArrowRight size={17} /></button></div></form><p><ShieldCheck size={11} />AI runs only when you ask. Review its answers.</p></div></aside>}
      </div>
      </>}
      <footer className="workspace-footer"><span><span className="footer-dot" />A home for your email. A little space for you.</span><span>Open source, by nature.<Leaf size={12} /></span></footer>
    </main>
    {organizing && <OrganizeMail message={organizing} onClose={() => setOrganizing(null)} onUpdate={localUpdate} />}
    {compose && <Compose initial={compose} account={state.account} accounts={state.accounts} preferences={preferences} footer={state.settings.footer} policy={policy} onSettings={() => setSettingsOpen(true, 'policy')} onClose={() => setCompose(null)} onSaved={localUpdate} onSent={sent} notify={notify} />}
    {toast && <div className={`toast ${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'}>{toast.type === 'error' ? <CircleHelp size={18} /> : <Check size={18} />}<span>{toast.message}</span><button aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={15} /></button></div>}
  </div>;
}
