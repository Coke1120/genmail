import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CalendarDays, Info, LoaderCircle, Mail, Settings2, ShieldCheck, Sparkles } from 'lucide-react';
import { AI_BEHAVIORS, DEFAULT_POLICY, DEFAULT_PREFERENCES } from '../shared/features';
import Modal from './Modal';
import FooterPreview from './FooterPreview';
import './settings.css';
import CalendarSettings from './CalendarSettings';

const TABS = [['general', Settings2, 'General'], ['mail', Mail, 'Mail'], ['calendar', CalendarDays, 'Calendar'], ['model', Sparkles, 'Model'], ['policy', ShieldCheck, 'AI permissions'], ['about', Info, 'About']];
const CONTENT_LABELS = {
  subject: ['Email subjects', 'Subject lines used for context and search.'],
  body: ['Email & draft text', 'The written content of permitted messages and drafts.'],
  sender: ['Sender & recipient', 'Names and email addresses in permitted messages.'],
  contacts: ['Contacts', 'Contact notes in the local Email Brain; no address book access.'],
  calendar: ['Calendar simulations', 'Allows local AI Studio event simulations. Connected calendars are manual and are never sent to AI.'],
  attachments: ['Attachments', 'Sample attachment fixtures only; no real files are fetched.'],
};

function mailValues(mail) {
  return { email: mail.email || '', password: '', imapHost: mail.imapHost || 'imap.gmail.com', imapPort: mail.imapPort || 993, smtpHost: mail.smtpHost || 'smtp.gmail.com', smtpPort: mail.smtpPort || 465 };
}

function modelValues(ai) {
  return { baseUrl: ai.baseUrl || 'http://127.0.0.1:11434/v1', model: ai.model || '', apiKey: '', clearApiKey: false, temperature: ai.temperature ?? 0.7, maxTokens: ai.maxTokens ?? 1024 };
}

function policyValues(policy = {}) {
  return { ...DEFAULT_POLICY, ...policy, behaviors: { ...DEFAULT_POLICY.behaviors, ...policy.behaviors }, folders: { ...DEFAULT_POLICY.folders, ...policy.folders }, content: { ...DEFAULT_POLICY.content, ...policy.content } };
}

function Permission({ checked, onChange, title, description, simulated = false }) {
  return <label className="settings-permission">
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    <span><strong>{title}{simulated && <small>Simulated</small>}</strong>{description && <span>{description}</span>}</span>
  </label>;
}

export default function Settings({ state, onClose, onUpdate, notify, page = false, initialTab = 'general', onDirtyChange, onBusyChange }) {
  const savedMail = state.settings.mail;
  const savedAi = state.settings.ai;
  const imapConfigured = savedMail.configured && (!savedMail.provider || savedMail.provider === 'imap');
  const [tab, setTab] = useState(TABS.some(([id]) => id === initialTab) ? initialTab : 'general');
  const [provider, setProvider] = useState(savedMail.configured ? savedMail.provider || 'imap' : 'google');
  const [oauth, setOauth] = useState({ google: { clientId: '', clientSecret: '' }, microsoft: { clientId: '' } });
  const [busy, setBusy] = useState('');
  const [calendarDirty, setCalendarDirty] = useState(false);
  const [calendarBusy, setCalendarBusy] = useState(false);
  const operationBusy = !!busy || calendarBusy;
  const [error, setError] = useState('');
  const [mail, setMail] = useState(() => mailValues({}));
  const [ai, setAi] = useState(() => modelValues(savedAi));
  const [preferences, setPreferences] = useState(() => ({ ...DEFAULT_PREFERENCES, ...state.settings.preferences }));
  const [policy, setPolicy] = useState(() => policyValues(state.settings.policy));
  const [testResult, setTestResult] = useState('');
  const [footerPreview, setFooterPreview] = useState(null);
  useEffect(() => setFooterPreview(null), [preferences.signature, preferences.signatureFormat]);
  const saved = useRef({ mail, model: ai, general: preferences, policy });
  const allowUnload = useRef(false);
  const dirty = Object.fromEntries(Object.entries({ mail, model: ai, general: preferences, policy }).map(([key, value]) => [key, JSON.stringify(value) !== JSON.stringify(saved.current[key])]));
  dirty.mail ||= Object.values(oauth).some(credentials => Object.values(credentials).some(Boolean));
  dirty.calendar = calendarDirty;
  const isDirty = Object.values(dirty).some(Boolean);

  useEffect(() => { onDirtyChange?.(isDirty); }, [isDirty, onDirtyChange]);
  useEffect(() => { onBusyChange?.(operationBusy); }, [operationBusy, onBusyChange]);
  useEffect(() => {
    const warn = (event) => { if ((isDirty || operationBusy) && !allowUnload.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty, operationBusy]);
  useEffect(() => { setTestResult(''); }, [ai]);

  function closeSettings() {
    if (operationBusy || (isDirty && !window.confirm('Discard your unsaved settings and return to your inbox?'))) return;
    onClose();
  }

  async function save(path, body, label, message, accountId = state.account.id) {
    if (operationBusy) return;
    if (label === 'oauth' && (dirty.general || dirty.model || dirty.policy || JSON.stringify(mail) !== JSON.stringify(saved.current.mail)) && !window.confirm('Continue to sign-in and discard your other unsaved settings?')) return;
    setBusy(label);
    setError('');
    if (label === 'test') setTestResult('');
    try {
      const response = await fetch(`/api/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Genmail-Account': accountId }, body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to save. Please try again.');
      if (label === 'oauth') {
        if (!result.url) throw new Error('No sign-in URL returned. Please try again.');
        allowUnload.current = true;
        window.location.assign(result.url);
        return;
      }
      if (label === 'footer') { setFooterPreview(result.footer); return; }
      if (label === 'test') {
        setTestResult(result.text || 'Your model is responding.');
        return;
      }
      if (label === 'mail' || label === 'disconnect') {
        const nextMail = mailValues(result.settings.mail);
        saved.current.mail = nextMail;
        setMail(nextMail);
        setOauth({ google: { clientId: '', clientSecret: '' }, microsoft: { clientId: '' } });
      }
      if (label === 'ai') { const nextAi = modelValues(result.settings.ai); saved.current.model = nextAi; setAi(nextAi); }
      if (label === 'preferences') { const nextPreferences = { ...DEFAULT_PREFERENCES, ...result.settings.preferences }; saved.current.general = nextPreferences; setPreferences(nextPreferences); }
      if (label === 'policy') { const nextPolicy = policyValues(result.settings.policy); saved.current.policy = nextPolicy; setPolicy(nextPolicy); }
      onUpdate(result);
      notify(message);
    } catch (err) {
      allowUnload.current = false;
      setError(err.message || 'Unable to connect. Please try again.');
    } finally {
      setBusy('');
    }
  }

  function changeTab(nextTab) {
    if (operationBusy) return;
    setTab(nextTab);
    setError('');
  }

  function tabKeys(event) {
    if (operationBusy || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = TABS.findIndex(([id]) => id === tab);
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    const nextTab = TABS[nextIndex][0];
    changeTab(nextTab);
    document.getElementById(`settings-tab-${nextTab}`)?.focus();
  }

  const content = <>
      <div className="settings-mode">
        <span className={`settings-status-dot ${state.account.mode === 'live' ? 'is-live' : ''}`} />
        <div>
          <strong>{state.account.mode === 'demo' ? 'Exploring the demo' : 'Your mailbox is connected'}</strong>
          <span>{state.account.mode === 'demo' ? 'A sample inbox. Every send is simulated.' : state.account.email}</span>
        </div>
        {(state.account.mode === 'live' || savedMail.configured) && (
          <button className="button ghost settings-mode-switch" type="button" disabled={operationBusy}
            onClick={() => save(`account/${state.account.mode === 'demo' ? 'live' : 'demo'}`, {}, 'mode', 'Workspace switched.')}>
            {busy === 'mode' ? <LoaderCircle size={14} className="settings-spinner" /> : null}
            {state.account.mode === 'demo' ? 'Use my mailbox' : 'Try demo'}
            <ArrowRight size={14} />
          </button>
        )}
      </div>

      <div className="settings-tabs" role="tablist" aria-label="Workspace settings" onKeyDown={tabKeys}>
        {TABS.map(([id, Icon, label]) => (
          <button key={id} id={`settings-tab-${id}`} role="tab" type="button"
            aria-controls={`settings-panel-${id}`} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1}
            disabled={operationBusy} onClick={() => changeTab(id)}>
            <Icon size={16} />{label}
            {dirty[id] && <span className="settings-dirty-dot" aria-label="Unsaved changes" />}
          </button>
        ))}
      </div>

      {error && <p className="settings-error" role="alert">{error}</p>}

      <section id="settings-panel-general" role="tabpanel" aria-labelledby="settings-tab-general" hidden={tab !== 'general'}>
        <form onSubmit={(event) => { event.preventDefault(); save('settings/preferences', preferences, 'preferences', 'Preferences saved.'); }}>
          <fieldset className="settings-fields" disabled={operationBusy}>
            <legend className="settings-section-title">Make room for your rhythm.</legend>
            <p className="settings-intro">A few details that make Morrow feel like yours.</p>
            <label className="settings-field">Display name
              <input maxLength={100} autoComplete="name" value={preferences.displayName} placeholder={state.account.name || 'Your name'} onChange={(event) => setPreferences({ ...preferences, displayName: event.target.value })} />
            </label>
            <label className="settings-field">Footer format<select value={preferences.signatureFormat} onChange={event => setPreferences({ ...preferences, signatureFormat: event.target.value })}><option value="plain">Plain text</option><option value="html">HTML</option></select></label>
            <label className="settings-field">{preferences.signatureFormat === 'html' ? 'HTML signature source' : 'Email signature'}
              <textarea rows={4} maxLength={12000} value={preferences.signature} placeholder="Your sign-off, just the way you like it." onChange={(event) => setPreferences({ ...preferences, signature: event.target.value })} />
              <span className="settings-help">Added to new messages and replies across your accounts. Saved drafts keep their footer. HTML supports text styles, tables and links; images and active content are removed.</span>
            </label>
            <button type="button" className="button secondary" onClick={() => save('signature/preview', { signature: preferences.signature, signatureFormat: preferences.signatureFormat }, 'footer')}>Preview footer</button>
            {footerPreview && <FooterPreview footer={footerPreview} />}
            <div className="settings-columns">
              <label className="settings-field">Theme
                <select value={preferences.theme} onChange={(event) => setPreferences({ ...preferences, theme: event.target.value })}>
                  <option value="system">Match device</option><option value="light">Light</option><option value="dark">Dark</option>
                </select>
              </label>
              <label className="settings-field">Inbox density
                <select value={preferences.density} onChange={(event) => setPreferences({ ...preferences, density: event.target.value })}>
                  <option value="comfortable">Comfortable</option><option value="compact">Compact</option><option value="spacious">Spacious</option>
                </select>
              </label>
              <label className="settings-field">Default reply tone
                <select value={preferences.replyTone} onChange={(event) => setPreferences({ ...preferences, replyTone: event.target.value })}>
                  <option value="friendly">Friendly</option><option value="professional">Professional</option><option value="concise">Concise</option><option value="warm">Warm</option>
                </select>
              </label>
              <label className="settings-field">AI response language
                <input required maxLength={60} value={preferences.language} onChange={(event) => setPreferences({ ...preferences, language: event.target.value })} />
              </label>
            </div>
            <label className="settings-field">Refresh your inbox
              <select value={preferences.syncInterval} onChange={(event) => setPreferences({ ...preferences, syncInterval: Number(event.target.value) })}>
                <option value={0}>Manually</option><option value={5}>Every 5 minutes</option><option value={15}>Every 15 minutes</option><option value={30}>Every 30 minutes</option>
              </select>
              <span className="settings-help">Automatic refresh runs only while Morrow is open. It never triggers AI.</span>
            </label>
            <Permission checked={preferences.markReadOnOpen} onChange={(checked) => setPreferences({ ...preferences, markReadOnOpen: checked })} title="Mark emails as read when opened" description="Updates read status locally in Morrow." />
            <div className="settings-actions">
              <span>{dirty.general ? 'You have unsaved changes' : 'Your preferences are up to date'}</span>
              <button className="button primary" type="submit">{busy === 'preferences' ? <LoaderCircle size={16} className="settings-spinner" /> : <Check size={16} />} Save preferences</button>
            </div>
          </fieldset>
        </form>
      </section>

      <section id="settings-panel-mail" role="tabpanel" aria-labelledby="settings-tab-mail" hidden={tab !== 'mail'}>
        {(state.accounts || []).map(account => <div className="settings-connected" key={account.id}>
          <div><strong>{account.email}</strong><p>{account.provider.toUpperCase()} · Disconnect removes only this account’s credentials. Cached mail and drafts stay on this computer.</p></div>
          <button type="button" className="button secondary" disabled={operationBusy} onClick={() => save('account/select', { accountId: account.id }, 'select', 'Mailbox selected.')}>Use mailbox</button>
          {account.provider === 'imap' && <button type="button" className="button secondary" disabled={operationBusy} onClick={() => { if (dirty.mail && !window.confirm('Discard unsaved mail settings?')) return; const value = mailValues(account.settings); saved.current.mail = value; setMail(value); setProvider('imap'); }}>Edit</button>}
          <button type="button" className="button secondary" disabled={operationBusy} onClick={() => {
            if (window.confirm(`Disconnect ${account.email}? Cached mail and drafts will be retained.`)) save('account/disconnect', {}, 'disconnect', 'Mailbox disconnected. Cached mail is retained.', account.id);
          }}>Disconnect</button>
        </div>)}
        <button type="button" className="button secondary" disabled={operationBusy} onClick={() => { if (dirty.mail && !window.confirm('Discard unsaved mail settings?')) return; const value = mailValues({}); saved.current.mail = value; setMail(value); setOauth({ google: { clientId: '', clientSecret: '' }, microsoft: { clientId: '' } }); }}>Add another account</button>
        <p className="settings-intro">Keep multiple Gmail, Outlook, and IMAP accounts connected. Choose separate or combined mail in the sidebar. Reconnecting an email address updates that account.</p>
        <div className="settings-providers" role="group" aria-label="Mail provider">
          {[['google', 'Gmail'], ['microsoft', 'Outlook / Microsoft 365'], ['imap', 'Custom IMAP']].map(([id, label]) => (
            <button type="button" key={id} aria-pressed={provider === id} disabled={operationBusy}
              onClick={() => { setProvider(id); setError(''); }}>
              {label}{savedMail.configured && savedMail.provider === id && <Check size={13} aria-label="Connected" />}
            </button>
          ))}
        </div>
        {provider !== 'imap' ? <form onSubmit={(event) => {
          event.preventDefault();
          save(`oauth/${provider}/start`, oauth[provider], 'oauth');
        }}>
          <fieldset className="settings-fields" disabled={operationBusy}>
            <legend className="settings-section-title">Connect {provider === 'google' ? 'your Gmail' : 'your Microsoft mailbox'}.</legend>
            <p className="settings-intro">Sign in securely with {provider === 'google' ? 'Google' : 'Microsoft'}. Morrow imports your latest 50 inbox messages.</p>
            <div className="settings-oauth-setup">
              <strong>Register your own OAuth app first</strong>
              <p>{provider === 'google'
                ? 'Create a Desktop app OAuth client in Google Cloud, then enter its client ID and client secret below.'
                : 'Create a desktop app registration in Microsoft Entra, then enter its application (client) ID below. No client secret is needed.'} See README.md in the project folder for setup instructions.</p>
              <span>Redirect URL</span>
              <code>http://localhost:3001/api/oauth/{provider}/callback</code>
            </div>
            <label className="settings-field">Client ID
              <input required value={oauth[provider].clientId} autoComplete="off" autoCapitalize="none" spellCheck={false}
                placeholder={provider === 'google' ? 'Your Google OAuth client ID' : 'Your Microsoft application (client) ID'}
                onChange={(event) => setOauth({ ...oauth, [provider]: { ...oauth[provider], clientId: event.target.value } })} />
            </label>
            {provider === 'google' && <label className="settings-field">Client secret
              <input type="password" required autoComplete="new-password" value={oauth.google.clientSecret} placeholder="Your Google desktop app client secret"
                onChange={(event) => setOauth({ ...oauth, google: { ...oauth.google, clientSecret: event.target.value } })} />
            </label>}
            <label className="settings-permission"><input type="checkbox" checked={!!oauth[provider].organize} onChange={event => setOauth({ ...oauth, [provider]: { ...oauth[provider], organize: event.target.checked } })} /><span>Allow moving mail and managing labels (Gmail modify / Outlook Mail.ReadWrite). Reconnect existing accounts to enable.</span></label>
            <p className="settings-help settings-scope">Read, star, archive, and trash shortcuts stay local. Move / Labels applies reviewed provider changes. Messages are sent only when you click Send. Live email supports plain text, without attachments.</p>
            <div className="settings-actions">
              <span><ShieldCheck size={15} /> Credentials encrypted on disk</span>
              <button className="button primary" type="submit">
                {busy === 'oauth' ? <LoaderCircle size={16} className="settings-spinner" /> : <ArrowRight size={16} />}
                {busy === 'oauth' ? 'Opening sign-in…' : `Continue with ${provider === 'google' ? 'Google' : 'Microsoft'}`}
              </button>
            </div>
          </fieldset>
        </form> : <form onSubmit={(event) => {
          event.preventDefault();
          save('settings/mail', { ...mail, password: mail.password || undefined, imapPort: Number(mail.imapPort), smtpPort: Number(mail.smtpPort) }, 'mail', 'Mailbox connected and inbox synced.');
        }}>
          <fieldset className="settings-fields" disabled={operationBusy}>
            <legend className="settings-section-title">Bring your inbox along.</legend>
            <p className="settings-intro">Connect with IMAP and SMTP. Your latest 50 inbox messages will appear here.</p>
            <label className="settings-field">Email address
              <input type="email" autoComplete="email" required placeholder="you@example.com" value={mail.email}
                onChange={(event) => setMail({ ...mail, email: event.target.value })} />
            </label>
            <label className="settings-field">App password
              <input type="password" autoComplete="new-password" required={!imapConfigured || mail.email !== savedMail.email}
                placeholder={imapConfigured ? 'Leave blank to keep your saved password' : 'Your email provider’s app password'}
                value={mail.password} aria-describedby="settings-password-help"
                onChange={(event) => setMail({ ...mail, password: event.target.value })} />
              <span className="settings-help" id="settings-password-help">Use an app password from your provider. Enable IMAP in your mailbox settings if needed.</span>
            </label>
            <div className="settings-server-row">
              <label className="settings-field">IMAP server
                <input required value={mail.imapHost} autoCapitalize="none" spellCheck={false}
                  onChange={(event) => setMail({ ...mail, imapHost: event.target.value })} />
              </label>
              <label className="settings-field">TLS port
                <input type="number" min="1" max="65535" required value={mail.imapPort}
                  onChange={(event) => setMail({ ...mail, imapPort: event.target.value })} />
              </label>
            </div>
            <div className="settings-server-row">
              <label className="settings-field">SMTP server
                <input required value={mail.smtpHost} autoCapitalize="none" spellCheck={false}
                  onChange={(event) => setMail({ ...mail, smtpHost: event.target.value })} />
              </label>
              <label className="settings-field">Secure port
                <select value={mail.smtpPort} onChange={(event) => setMail({ ...mail, smtpPort: event.target.value })}>
                  <option value="465">465 · TLS</option><option value="587">587 · STARTTLS</option>
                </select>
              </label>
            </div>
            <label className="settings-permission"><input type="checkbox" checked={!!oauth[provider].organize} onChange={event => setOauth({ ...oauth, [provider]: { ...oauth[provider], organize: event.target.checked } })} /><span>Allow moving mail and managing labels (Gmail modify / Outlook Mail.ReadWrite). Reconnect existing accounts to enable.</span></label>
            <p className="settings-help settings-scope">Read, star, archive, and trash shortcuts stay local. Move / Labels applies reviewed provider changes. Sending uses SMTP only when you click Send. Live email supports plain text, without attachments.</p>
            <div className="settings-actions">
              <span><ShieldCheck size={15} /> Credentials encrypted on disk</span>
              <button className="button primary" type="submit">
                {busy === 'mail' ? <LoaderCircle size={16} className="settings-spinner" /> : <ArrowRight size={16} />}
                {busy === 'mail' ? 'Connecting…' : imapConfigured ? 'Update & sync' : 'Connect & sync'}
              </button>
            </div>
          </fieldset>
        </form>}
      </section>

      <section id="settings-panel-model" role="tabpanel" aria-labelledby="settings-tab-model" hidden={tab !== 'model'}>
        <form onSubmit={(event) => {
          event.preventDefault();
          const testing = event.nativeEvent.submitter?.value === 'test';
          save(testing ? 'settings/ai/test' : 'settings/ai', { ...ai, apiKey: ai.apiKey || undefined, temperature: Number(ai.temperature), maxTokens: Number(ai.maxTokens) }, testing ? 'test' : 'ai', 'Model settings saved.');
        }}>
          <fieldset className="settings-fields" disabled={operationBusy}>
            <legend className="settings-section-title">Your inbox. Your model.</legend>
            <p className="settings-intro">Use Ollama locally or connect any OpenAI-compatible endpoint.</p>
            <label className="settings-field">API base URL
              <input type="url" required value={ai.baseUrl} autoCapitalize="none" spellCheck={false} placeholder="http://127.0.0.1:11434/v1"
                aria-describedby="settings-url-help" onChange={(event) => setAi({ ...ai, baseUrl: event.target.value })} />
              <span className="settings-help" id="settings-url-help">Include /v1 if your provider requires it. The default connects to Ollama on this computer.</span>
            </label>
            <label className="settings-field">Model ID
              <input required value={ai.model} placeholder="qwen3:8b" autoCapitalize="none" spellCheck={false}
                onChange={(event) => setAi({ ...ai, model: event.target.value })} />
            </label>
            <label className="settings-field">API key <span className="settings-optional">Optional for local models</span>
              <input type="password" autoComplete="new-password" value={ai.apiKey} disabled={ai.clearApiKey}
                placeholder={savedAi.hasApiKey ? 'Leave blank to keep your saved key' : 'Enter a key if your provider requires one'}
                onChange={(event) => setAi({ ...ai, apiKey: event.target.value })} />
            </label>
            {savedAi.hasApiKey && <label className="settings-checkbox">
              <input type="checkbox" checked={ai.clearApiKey} onChange={(event) => setAi({ ...ai, clearApiKey: event.target.checked, apiKey: '' })} />
              Remove saved API key
            </label>}
            <div className="settings-columns">
              <label className="settings-field">Temperature
                <input type="number" min="0" max="2" step="0.1" required value={ai.temperature} onChange={(event) => setAi({ ...ai, temperature: event.target.value })} />
                <span className="settings-help">0 is more predictable; 2 is more varied.</span>
              </label>
              <label className="settings-field">Maximum response tokens
                <input type="number" min="128" max="4096" step="1" required value={ai.maxTokens} onChange={(event) => setAi({ ...ai, maxTokens: event.target.value })} />
                <span className="settings-help">Limits each model response, from 128 to 4,096.</span>
              </label>
            </div>
            <div className="settings-privacy">
              <ShieldCheck size={19} />
              <div><strong>You choose what your AI sees.</strong>
                <p>Only the selected email or relevant inbox context goes to your model when you ask for help. AI drafts stay yours to review and send.</p>
              </div>
            </div>
            <p className="settings-help">Test connection sends a fixed test prompt, without any email content. It does not save your settings.</p>
            {testResult && <div className="settings-test-result" role="status"><strong>Connection successful</strong><p>{testResult}</p></div>}
            <div className="settings-actions">
              <span>{dirty.model ? 'You have unsaved changes' : savedAi.configured ? <><Check size={15} /> Model is configured</> : 'Bring your own model'}</span>
              <div className="settings-button-row">
                <button className="button secondary" type="submit" value="test">{busy === 'test' ? <LoaderCircle size={16} className="settings-spinner" /> : null}{busy === 'test' ? 'Testing…' : 'Test connection'}</button>
                <button className="button primary" type="submit" value="save">
                  {busy === 'ai' ? <LoaderCircle size={16} className="settings-spinner" /> : <Check size={16} />}
                  {busy === 'ai' ? 'Saving…' : 'Save model'}
                </button>
              </div>
            </div>
          </fieldset>
        </form>
      </section>
      <section id="settings-panel-policy" role="tabpanel" aria-labelledby="settings-tab-policy" hidden={tab !== 'policy'}>
        <form onSubmit={(event) => { event.preventDefault(); save('settings/policy', { ...policy, maxMessages: Number(policy.maxMessages) }, 'policy', 'AI permissions saved.'); }}>
          <fieldset className="settings-fields" disabled={operationBusy}>
            <legend className="settings-section-title">Your assistant. Your boundaries.</legend>
            <p className="settings-intro">Every AI action follows these saved permissions, including demos and local simulations. Unchecked behaviors are blocked by the server before execution.</p>
            <div className="settings-master-permission">
              <Permission checked={policy.enabled} onChange={(checked) => setPolicy({ ...policy, enabled: checked })} title="Enable AI assistance" description="Turn off to block all AI and simulated workflows. Manual reading, composing, and sending still work." />
            </div>
            <h3 className="settings-group-title">What your assistant can do</h3>
            <div className="settings-permissions-grid">
              {AI_BEHAVIORS.map((feature) => <Permission key={feature.id} checked={policy.behaviors[feature.id]} onChange={(checked) => setPolicy({ ...policy, behaviors: { ...policy.behaviors, [feature.id]: checked } })} title={feature.label} description={feature.description} simulated={!!feature.mock} />)}
            </div>
            <h3 className="settings-group-title">Which folders it can use</h3>
            <p className="settings-help">Choose each folder independently. Messages outside these folders cannot become AI context.</p>
            <div className="settings-folder-permissions">
              {Object.keys(DEFAULT_POLICY.folders).map((folder) => <Permission key={folder} checked={policy.folders[folder]} onChange={(checked) => setPolicy({ ...policy, folders: { ...policy.folders, [folder]: checked } })} title={folder[0].toUpperCase() + folder.slice(1)} />)}
            </div>
            <h3 className="settings-group-title">Which information it can see</h3>
            <div className="settings-permissions-grid">
              {Object.keys(DEFAULT_POLICY.content).map((scope) => <Permission key={scope} checked={policy.content[scope]} onChange={(checked) => setPolicy({ ...policy, content: { ...policy.content, [scope]: checked } })} title={CONTENT_LABELS[scope][0]} description={CONTENT_LABELS[scope][1]} />)}
            </div>
            <label className="settings-field settings-limit">Maximum messages per request
              <input type="number" min="1" max="25" required value={policy.maxMessages} onChange={(event) => setPolicy({ ...policy, maxMessages: event.target.value })} />
              <span className="settings-help">Between 1 and 25 permitted messages. Smaller limits share less context.</span>
            </label>
            <div className="settings-privacy"><ShieldCheck size={19} /><div><strong>Permission is never permission to send.</strong><p>Review AI drafts before sending. Simulated workflows only change local Morrow data after you review and apply their preview. Calendar and attachment demos have no external access.</p></div></div>
            <div className="settings-actions">
              <span>{dirty.policy ? 'Unsaved permissions are not active yet' : 'These permissions are active'}</span>
              <button className="button primary" type="submit">{busy === 'policy' ? <LoaderCircle size={16} className="settings-spinner" /> : <Check size={16} />} Save permissions</button>
            </div>
          </fieldset>
        </form>
      </section>

      <section id="settings-panel-calendar" role="tabpanel" aria-labelledby="settings-tab-calendar" hidden={tab !== 'calendar'}>
        <CalendarSettings onNotify={notify} onDirtyChange={setCalendarDirty} onBusyChange={value => { setCalendarBusy(value); if (!value) allowUnload.current = false; }} onBeforeConnect={() => {
          if (Object.entries(dirty).some(([key, value]) => key !== 'calendar' && value) && !window.confirm('Continue to calendar sign-in and discard your other unsaved settings?')) return false;
          allowUnload.current = true;
          return true;
        }} />
      </section>

      <section id="settings-panel-about" role="tabpanel" aria-labelledby="settings-tab-about" hidden={tab !== 'about'}>
        <div className="settings-about-brand"><img src="/brand/morrow-icon.svg" alt="" width="72" height="72" /><div><h2>Morrow Mail</h2><p>A little more room to think.</p></div></div>
        <p><a href="https://github.com/Coke1120/genmail" target="_blank" rel="noreferrer">GitHub</a> · <a href="https://github.com/sponsors/Coke1120" target="_blank" rel="noreferrer">GitHub Sponsors</a> · <a href="https://buymeacoffee.com/Coke1120" target="_blank" rel="noreferrer">Buy Me a Coffee</a></p>
        <p className="settings-about-intro">An independent, open-source email workspace inspired by GenMail. Original design and code, MIT licensed, and built to keep your workspace on your computer.</p>
        <dl className="settings-about-status">
          <div><dt>Mailbox</dt><dd>{state.account.mode === 'demo' ? 'Demo inbox · sample emails and simulated sends' : `${({ google: 'Gmail API', microsoft: 'Microsoft Graph', imap: 'IMAP / SMTP' })[state.account.provider || savedMail.provider] || 'Live provider'} · ${state.account.email}`}</dd></div>
          <div><dt>Model</dt><dd>{savedAi.configured ? `${savedAi.model} · ${savedAi.baseUrl}` : 'Not configured · illustrative demo responses only'}</dd></div>
          <div><dt>AI assistance</dt><dd>{state.settings.policy?.enabled === false ? 'Disabled in your saved permissions' : 'Runs only when you ask, using saved permissions'}</dd></div>
          <div><dt>Simulated features</dt><dd>AI Studio scheduling, attachment discovery, research, unsubscribe, Email Brain, and other marked workflows use local previews. The separate Calendar page connects to real Google and Outlook calendars.</dd></div>
          <div><dt>Your data</dt><dd>Mail and workspace data stay in your local database. Credentials are encrypted on disk. Explicit sending contacts your mail provider; AI actions share only permitted context with your chosen model.</dd></div>
          <div><dt>Documentation</dt><dd>README.md in the project folder includes setup, provider instructions, and feature coverage.</dd></div>
        </dl>
      </section>
    </>;

  return page ? <section className="settings-page" aria-labelledby="settings-page-title">
    <div className="settings-page-inner">
      <header className="settings-page-heading"><div><span className="eyebrow">MAKE YOURSELF AT HOME</span><h1 id="settings-page-title">Your workspace</h1><p>A calmer inbox starts with a workspace that fits you.</p></div><button type="button" className="button secondary" disabled={operationBusy} onClick={closeSettings}><ArrowLeft size={16} />Back to inbox</button></header>
      {content}
    </div>
  </section> : <Modal title="Your workspace" description="Make Morrow yours." onClose={closeSettings} closeDisabled={operationBusy} className="settings-modal">{content}</Modal>;
}
