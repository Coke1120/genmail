import { useEffect, useRef, useState } from 'react';

export default function StyleLearning({ state, onUpdate, onDirtyChange, onBusyChange, disabled = false }) {
  const value = state.workspace.styleLearning, saved = value.settings;
  const [options, setOptions] = useState(saved), [voice, setVoice] = useState(value.preview?.voice || '');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const inFlight = useRef(false), currentOwner = useRef(state.account.id);
  currentOwner.current = state.account.id;
  useEffect(() => { currentOwner.current = state.account.id; return () => { currentOwner.current = null; }; }, [state.account.id]);
  const preview = value.preview;
  useEffect(() => { setOptions(saved); setVoice(preview?.voice || ''); }, [state.account.id, JSON.stringify(saved), preview?.id, preview?.voice]);
  const settingsDirty = JSON.stringify(options) !== JSON.stringify(saved);
  const dirty = settingsDirty || voice !== (preview?.voice || '');
  const analysisBlocked = dirty || !saved.enabled || !value.permitted || !state.settings.ai?.configured || preview?.status === 'running';
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => () => { onDirtyChange(false); onBusyChange(false); }, [onDirtyChange, onBusyChange]);
  async function action(path, body = {}, method = 'POST', learnNow = false) {
    if (inFlight.current || busy || disabled || state.account.mode !== 'live') return;
    if (['preview', 'generate'].includes(path) && analysisBlocked) return;
    const owner = state.account.id;
    if (['settings', 'preview'].includes(path) && preview?.status === 'ready' && !window.confirm('Replace the current style proposal? Your approved style will be retained.')) return;
    if (currentOwner.current !== owner) return;
    inFlight.current = true;
    setBusy(true); setError('');
    try {
      async function request(nextPath, nextBody, nextMethod = 'POST') {
        const response = await fetch(`/api/style/${nextPath}`, { method: nextMethod, headers: { 'Content-Type': 'application/json', 'X-Morrow-View': 'paged', 'X-Genmail-Account': owner }, body: JSON.stringify(nextBody) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to complete style learning.');
        return result;
      }
      const result = await request(path, body, method);
      if (currentOwner.current !== owner) return;
      onUpdate(result);
      if (learnNow) {
        const learning = result.workspace.styleLearning, prepared = learning.preview;
        if (prepared?.status !== 'prepared' || !prepared.id || !learning.settings.enabled || !learning.permitted || !result.settings.ai?.configured) return;
        const excerpts = prepared.samples.slice(0, 2).map((sample, index) => `Sample ${index + 1}: ${sample.body.slice(0, 200)}${sample.body.length > 200 ? '…' : ''}`).join('\n\n');
        const confirmed = window.confirm(`Learn Now · Uses AI\nAccount: ${owner} · Your Sent bodies only\nModel: ${result.settings.ai.model}\nEndpoint: ${result.settings.ai.baseUrl}\n${prepared.sampleCount} / ${prepared.eligible} useful samples · Cap ${prepared.effectiveCap}\nEstimated tokens ≤ ${prepared.estimatedTokens.toLocaleString()} · Budget ${prepared.tokenBudget.toLocaleString()}\n\nUp to 2 short excerpts; all selected samples will be analyzed:\n${excerpts}\n\nCancel to review full samples below. Your approved style is retained until Save Approved Style. Continue with AI analysis?`);
        if (!confirmed || currentOwner.current !== owner) return;
        const generated = await request('generate', { previewId: prepared.id });
        if (currentOwner.current === owner) onUpdate(generated);
      }
    } catch (cause) { if (currentOwner.current === owner) setError(cause.message); }
    finally { inFlight.current = false; if (currentOwner.current !== null) setBusy(false); }
  }
  return <section className="settings-fields">
    <h2 className="settings-section-title">Learn my writing style</h2>
    <p className="settings-intro">{state.account.email || 'Choose an individual connected account in the sidebar.'} · Optional. Only your own Sent text is analyzed; contact and project memory stay separate. Importing mail does not use AI tokens.</p>
    <fieldset className="settings-fields" disabled={busy || disabled || state.account.mode !== 'live'}>
      <div className="settings-actions"><button className="button primary" disabled={analysisBlocked} onClick={() => action('preview', {}, 'POST', true)}>Learn Now · Uses AI</button></div>
      <p className="settings-help">Uses saved learning settings. Review samples and the token estimate before AI analysis generates a proposed writing style. Save Approved Style activates it for writing and replies under Email Brain permission; it does not overwrite Email Brain contacts, notes, or voice.</p>
      {dirty && <p className="settings-help">Save learning settings and save or discard any proposal edits before learning again.</p>}
      {!state.settings.ai?.configured && <p className="settings-help">Configure and save an AI model in Model settings first.</p>}
      <label className="settings-permission"><input type="checkbox" checked={options.enabled} onChange={e => setOptions({ ...options, enabled: e.target.checked, weekly: e.target.checked && options.weekly })} /><span>Enable writing-style learning for this account</span></label>
      <label className="settings-permission"><input type="checkbox" checked={options.weekly} disabled={!options.enabled} onChange={e => setOptions({ ...options, weekly: e.target.checked })} /><span>Analyze newly sent mail weekly within this budget. Each update still needs review and Save. Uses cached Sent mail while Morrow is open; enable mail refresh to capture mail sent elsewhere. Paused while a preview awaits review.</span></label>
      <label className="settings-field">Sent history<select value={options.months} onChange={e => setOptions({ ...options, months: Number(e.target.value) })}>{[1, 3, 6, 12].map(n => <option key={n} value={n}>Last {n} month{n > 1 ? 's' : ''}</option>)}</select></label>
      <label className="settings-field">Maximum samples<input type="number" min="1" max="50" value={options.maxSamples} onChange={e => setOptions({ ...options, maxSamples: Number(e.target.value) })} /><span className="settings-help">Also limited by AI Permissions → Maximum messages (currently {state.settings.policy.maxMessages}).</span></label>
      <label className="settings-field">Token budget per analysis<input type="number" min="4000" max="64000" step="1000" value={options.tokenBudget} onChange={e => setOptions({ ...options, tokenBudget: Number(e.target.value) })} /><span className="settings-help">Conservative UTF-8 estimate including response allowance; your custom model’s billing may differ. No currency estimate.</span></label>
      <div className="settings-actions"><button className="button secondary" onClick={() => action('settings', options)} disabled={preview?.status === 'running'}>Save learning settings</button><button className="button secondary" disabled={analysisBlocked} onClick={() => action('preview')}>Preview samples · no AI call</button></div>
      {!value.permitted && <p className="settings-help">Requires saved learning opt-in plus AI Permissions: AI on, Email Brain, Sent and email body access.</p>}
      {preview && <div className="settings-test-result" role="status"><strong>{preview.status} · {preview.sampleCount} / {preview.eligible} useful samples</strong><p>Estimated tokens ≤ {preview.estimatedTokens.toLocaleString()} · budget {preview.tokenBudget.toLocaleString()} · effective sample cap {preview.effectiveCap}. Quote/signature removal is heuristic; review the exact text below.</p>
        <details><summary>Review text sent to the model</summary>{preview.samples.map((sample, i) => <pre key={i} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{sample.body}</pre>)}</details>
        {preview.error && <p>{preview.error}</p>}
        {preview.status === 'prepared' && <button className="button primary" disabled={analysisBlocked} onClick={() => action('generate', { previewId: preview.id })}>Analyze these samples · uses AI</button>}
        {preview.status === 'ready' && <><label className="settings-field">Review and edit proposed style<textarea rows="7" maxLength="2000" value={voice} onChange={e => setVoice(e.target.value)} /></label><p>Provider-reported tokens: {preview.usage?.total_tokens ?? 'not supplied'}</p><button className="button primary" disabled={!voice.trim() || voice.length > 2000 || settingsDirty} onClick={() => action('apply', { previewId: preview.id, voice })}>Save approved style</button></>}
      </div>}
      {value.profile && <div className="settings-test-result"><strong>Saved style · {value.profile.active ? 'active for writing and replies' : 'inactive under current permissions or source scope'}</strong><p style={{ whiteSpace: 'pre-wrap' }}>{value.profile.voice}</p></div>}
      <button className="button secondary" onClick={() => { if (window.confirm('Delete this account’s learned style and sample preview, and turn off learning?')) action('profile', {}, 'DELETE'); }}>Delete learned style & stop learning</button>
    </fieldset>
    {busy && <p role="status">Working…</p>}{error && <p role="alert" className="settings-error">{error}</p>}
  </section>;
}
