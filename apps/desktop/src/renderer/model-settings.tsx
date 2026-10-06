import { useEffect, useId, useRef, useState } from 'react';
import type { AgentModelSettings, ModelSelectionConfirmation } from '@hermes-app/client';

/** Default model of one connection's Hermes profile; shared by every device on that connection. */
export function ModelSettings({ connectionKey }: { connectionKey?: string }) {
  const [current, setCurrent] = useState<AgentModelSettings | null>(null);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmation, setConfirmation] = useState<ModelSelectionConfirmation | null>(null);
  const [reload, setReload] = useState(0);
  const alive = useRef(false);
  const working = useRef(false);
  useEffect(() => {
    let active = true;
    alive.current = true;
    if (!connectionKey) return () => { alive.current = false; };
    setBusy(true); setError(''); setNotice(''); setConfirmation(null); setCurrent(null);
    void window.hermesDesktop.getModelSettings(connectionKey).then(value => {
      if (active) { setCurrent(value); setProvider(value.provider); setModel(value.model); }
    }, () => { if (active) setError('Could not load model settings. Try again.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; alive.current = false; };
  }, [connectionKey, reload]);
  const save = async (confirm = false) => {
    if (!connectionKey || !current || busy || working.current || error || !provider || !model.trim()) return;
    if (confirm && (!confirmation || confirmation.provider !== provider || confirmation.model !== model.trim())) return;
    working.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const result = await window.hermesDesktop.setModelSettings(connectionKey, provider, model.trim(), confirm);
      if (!alive.current) return;
      if ('confirmation_required' in result) { setConfirmation(result); return; }
      setCurrent(result); setProvider(result.provider); setModel(result.model); setConfirmation(null);
      setNotice('Default model saved.');
    } catch { if (alive.current) setError('Could not confirm the change. Reload settings before trying again.'); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  };
  const edited = () => { setConfirmation(null); setNotice(''); };
  const selected = current?.providers.find(item => item.id === provider);
  const listId = useId();
  return <div className="settings-section settings-model">
    {!connectionKey ? <p>Model settings are available after pairing completes.</p> : <>
      {busy && !current && <p role="status">Loading model settings…</p>}
      {current && <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <label className="settings-field">Provider<select aria-label="Provider" value={provider} disabled={busy} onChange={event => {
          const value = event.target.value; setProvider(value); setModel(value === current.provider ? current.model : ''); edited();
        }}>
          {!current.providers.some(item => item.id === provider) && <option value={provider}>{provider}</option>}
          {current.providers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label className="settings-field">Model<input aria-label="Model" list={listId} value={model} maxLength={256} disabled={busy} autoComplete="off" spellCheck={false} placeholder="Choose or enter a model name" onChange={event => { setModel(event.target.value); edited(); }} /></label>
        <datalist id={listId}>{selected?.models.map(id => <option key={id} value={id} />)}</datalist>
        <p className="settings-description">Choose a suggested model or enter its name.</p>
        {confirmation ? <div className="settings-warning" role="status"><p>{confirmation.warning}</p><div className="settings-actions"><button type="button" disabled={busy || !!error} onClick={() => void save(true)}>Confirm model selection</button><button type="button" className="secondary" disabled={busy} onClick={() => setConfirmation(null)}>Cancel model selection</button></div></div> :
          <button type="submit" disabled={busy || !!error || !provider || !model.trim() || (provider === current.provider && model.trim() === current.model)}>{busy ? 'Saving model…' : 'Save model'}</button>}
      </form>}
      {error && <><p role="alert">{error}</p><button type="button" className="secondary" disabled={busy} onClick={() => setReload(value => value + 1)}>Reload model settings</button></>}
      {notice && <p role="status" className="settings-success">{notice}</p>}
    </>}
  </div>;
}
