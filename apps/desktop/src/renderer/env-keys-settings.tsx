import { useCallback, useEffect, useRef, useState } from 'react';
import type { EnvKey, EnvKeySuggestion } from '@hermes-app/client';
import { ENV_KEY_MAX_VALUE, ENV_KEY_NAME } from '../../../../packages/client/src/envKeys';

/**
 * API keys of one connection's Hermes profile (docs/env-keys.md). The server hides the keys
 * that the administrator manages. Values go to the server once and are never shown again.
 */
export function EnvKeysSettings({ connectionKey }: { connectionKey?: string }) {
  const [keys, setKeys] = useState<readonly EnvKey[] | null>(null);
  const [suggestions, setSuggestions] = useState<readonly EnvKeySuggestion[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const alive = useRef(true);
  const load = useCallback(async () => {
    if (!connectionKey) return;
    setError('');
    try { const result = await window.hermesDesktop.getEnvKeys(connectionKey); if (alive.current) { setKeys(result.keys); setSuggestions(result.suggestions); } }
    catch (failure) { if (alive.current) setError(failure instanceof Error && /not available/.test(failure.message) ? 'API keys are not available on this Hermes yet. Update its Hermes App plugin.' : 'Could not load API keys. Check the connection and try again.'); }
  }, [connectionKey]);
  useEffect(() => { alive.current = true; setKeys(null); void load(); return () => { alive.current = false; }; }, [load]);
  if (!connectionKey) return <p className="settings-description">Available after pairing.</p>;

  const reset = () => { setEditing(null); setAdding(false); setName(''); setValue(''); };
  const act = async (fn: () => Promise<unknown>, done: string) => {
    if (busy) return false;
    setBusy(true); setError(''); setNotice('');
    try { await fn(); if (!alive.current) return false; setNotice(done); await load(); return true; }
    catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : 'Could not save this key. Check the connection and try again.'); return false; }
    finally { if (alive.current) setBusy(false); }
  };
  const save = async (target: string) => {
    if (await act(() => window.hermesDesktop.setEnvKey(connectionKey, target, value), `${target} saved. Hermes uses it from your next message.`)) reset();
  };
  const remove = (target: string) => void act(() => window.hermesDesktop.removeEnvKey(connectionKey, target), `${target} removed.`).then(() => setConfirming(null));
  const valueField = (label: string) => <label className="settings-field">{label}
    <input aria-label={label} type="password" value={value} disabled={busy} maxLength={ENV_KEY_MAX_VALUE} autoComplete="off" spellCheck={false} autoFocus={editing !== null}
      onChange={event => setValue(event.target.value.replace(/[\r\n]/g, ''))} /></label>;
  const known = keys?.some(key => key.name === name) === true;
  const validName = ENV_KEY_NAME.test(name);

  return <div className="vault-settings env-keys-settings">
    <p className="settings-description">Keys that Hermes uses on this Hermes, for example for search or for your own scripts. Keys that your administrator manages are not shown. Hermes uses a changed key from your next message.</p>
    {keys === null && !error && <p role="status" className="settings-description">Loading…</p>}
    {keys !== null && (keys.length ? <ul className="vault-list" aria-label="API keys">{keys.map(key => <li key={key.name} className="vault-item">
      <div className="vault-item-info"><strong>{key.name}</strong>
        <span className="settings-description">{[key.description, key.preview ? `Ends in ${key.preview.replace('…', '')}` : 'Set'].filter(Boolean).join(' · ')}</span>
        {key.sandbox && <span className="vault-badge">Commands can read it</span>}</div>
      {confirming === key.name ? <div className="settings-actions"><button type="button" disabled={busy} onClick={() => remove(key.name)}>{busy ? 'Removing…' : `Remove ${key.name}`}</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => setConfirming(null)}>Keep</button></div>
        : <div className="vault-item-actions">
          <button type="button" className="secondary" aria-label={`Change ${key.name}`} disabled={busy || editing === key.name} onClick={() => { reset(); setNotice(''); setEditing(key.name); }}>Change</button>
          <button type="button" className="secondary" aria-label={`Remove ${key.name}`} disabled={busy} onClick={() => { setConfirming(key.name); setNotice(''); }}>Remove</button></div>}
    </li>)}</ul> : <p className="settings-description">No API keys.</p>)}
    {editing && <form aria-label={`Change ${editing}`} onSubmit={event => { event.preventDefault(); void save(editing); }}>
      <h6>Change {editing}</h6>
      {valueField('New value')}
      <div className="settings-actions"><button type="submit" disabled={busy || !value.trim()}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="secondary" disabled={busy} onClick={reset}>Cancel</button></div>
    </form>}
    {adding ? <form aria-label="Add API key" onSubmit={event => { event.preventDefault(); void save(name); }}>
      <h6>Add API key</h6>
      <label className="settings-field">Name<input aria-label="Name" value={name} disabled={busy} maxLength={128} placeholder="MY_SERVICE_API_KEY" list="env-key-suggestions" autoFocus autoComplete="off" spellCheck={false}
        onChange={event => setName(event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))} /></label>
      <datalist id="env-key-suggestions">{suggestions.map(row => <option key={row.name} value={row.name}>{row.description}</option>)}</datalist>
      {suggestions.find(row => row.name === name)?.description && <p className="settings-description">{suggestions.find(row => row.name === name)?.description}</p>}
      {name && !validName && <p className="settings-description">Start with a letter or _. Use capital letters, digits and _.</p>}
      {known && <p className="settings-description">{name} is already set. Saving replaces its value.</p>}
      {valueField('Value')}
      <div className="settings-actions"><button type="submit" disabled={busy || !validName || !value.trim()}>{busy ? 'Saving…' : 'Save key'}</button>
        <button type="button" className="secondary" disabled={busy} onClick={reset}>Cancel</button></div>
    </form> : keys !== null && !editing && <div className="settings-actions">
      <button type="button" disabled={busy} onClick={() => { reset(); setNotice(''); setAdding(true); }}>Add API key</button>
    </div>}
    {notice && <p role="status" className="settings-description">{notice}</p>}
    {error && <><p role="alert">{error}</p>{keys === null && <button type="button" className="secondary" onClick={() => void load()}>Reload</button>}</>}
  </div>;
}
