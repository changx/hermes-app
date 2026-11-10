import { useCallback, useEffect, useRef, useState } from 'react';
import type { NewVaultItem, VaultItem, VaultItemChange } from '@hermes-app/client';
import { VAULT_IMPORT_DELETE_HINT, VAULT_IMPORT_SOURCES, vaultImportSummary } from '../../../../packages/client/src/vaultPresentation';

const host = (origin: string | null) => (origin ?? '').replace(/^https?:\/\//, '');
const EMPTY_LOGIN = { site: '', identifier: '', password: '', otp: '', label: '' };
const EMPTY_EDIT = { site: '', identifier: '', password: '', otp: '', label: '', clearOtp: false };
const EMPTY_ADDRESS = { label: '', address_line1: '', address_line2: '', city: '', state: '', postal_code: '', country: '' };

/**
 * Passwords & Logins saved on one connection's Hermes (docs/vault.md). Lists metadata only;
 * secret values go to the server once when added and are never shown again.
 */
export function VaultSettings({ connectionKey }: { connectionKey?: string }) {
  const [items, setItems] = useState<readonly VaultItem[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<'login' | 'address' | 'import' | null>(null);
  const [manage, setManage] = useState(false);
  const [editing, setEditing] = useState<VaultItem | null>(null);
  const [edit, setEdit] = useState(EMPTY_EDIT);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [login, setLogin] = useState(EMPTY_LOGIN);
  const [address, setAddress] = useState(EMPTY_ADDRESS);
  const alive = useRef(true);
  const load = useCallback(async () => {
    if (!connectionKey) return;
    setError('');
    try { const value = await window.hermesDesktop.getVaultItems(connectionKey); if (alive.current) { setItems(value.items); setManage(value.manage); } }
    catch (failure) { if (alive.current) setError(failure instanceof Error && /not available/.test(failure.message) ? failure.message.replace(/^.*?(Passwords)/, '$1') : 'Could not load saved logins. Check the connection and try again.'); }
  }, [connectionKey]);
  useEffect(() => { alive.current = true; setItems(null); void load(); return () => { alive.current = false; }; }, [load]);
  if (!connectionKey) return <p className="settings-description">Available after pairing.</p>;

  const act = async (fn: () => Promise<unknown>, done: string, failure: string) => {
    if (busy) return false;
    setBusy(true); setError(''); setNotice('');
    try { await fn(); if (!alive.current) return false; setNotice(done); await load(); return true; }
    catch { if (alive.current) setError(failure); return false; }
    finally { if (alive.current) setBusy(false); }
  };
  const saveLogin = async () => {
    const site = login.site.trim();
    const item: NewVaultItem = { kind: 'login', label: login.label.trim() || host(site) || site, origin: site,
      secret: { identifier: login.identifier.trim(), password: login.password, ...(login.otp.trim() ? { otp_secret: login.otp.trim() } : {}) } };
    if (await act(() => window.hermesDesktop.addVaultItem(connectionKey, item), 'Login saved.',
      'Could not save this login. Check the website and the authenticator key, then try again.')) { setLogin(EMPTY_LOGIN); setAdding(null); }
  };
  const saveAddress = async () => {
    const secret = Object.fromEntries(Object.entries(address).filter(([key, value]) => key !== 'label' && value.trim()).map(([key, value]) => [key, value.trim()]));
    const item = { kind: 'address', label: address.label.trim() || 'Address', secret } as NewVaultItem;
    if (await act(() => window.hermesDesktop.addVaultItem(connectionKey, item), 'Address saved.',
      'Could not save this address. Fill in address, city, postal code and country, then try again.')) { setAddress(EMPTY_ADDRESS); setAdding(null); }
  };
  const remove = (item: VaultItem) => void act(() => window.hermesDesktop.removeVaultItem(connectionKey, item.id), 'Removed.',
    'Could not confirm the removal. Reload the list before trying again.').then(() => setConfirming(null));
  const startEdit = (item: VaultItem) => { setNotice(''); setError(''); setAdding(null); setConfirming(null); setEditing(item);
    setEdit({ ...EMPTY_EDIT, site: host(item.origin), identifier: item.identifier ?? '', label: item.label }); };
  const saveEdit = async () => {
    if (!editing) return;
    const change: VaultItemChange = { label: edit.label.trim(), origin: edit.site.trim(), identifier: edit.identifier.trim(),
      ...(edit.password ? { password: edit.password } : {}), ...(edit.otp.trim() ? { otp_secret: edit.otp.trim() } : edit.clearOtp ? { clear_otp: true } : {}) };
    if (await act(() => window.hermesDesktop.updateVaultItem(connectionKey, editing.id, change), 'Saved.',
      'Could not save the change. Check the website and the authenticator key, then try again.')) { setEditing(null); setEdit(EMPTY_EDIT); }
  };
  const runImport = async () => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await window.hermesDesktop.importVaultCsv(connectionKey);
      if (!alive.current || !result) return;
      setAdding(null); setNotice(`${vaultImportSummary(result)} ${VAULT_IMPORT_DELETE_HINT}`); await load();
    } catch (failure) {
      if (alive.current) setError(failure instanceof Error && /larger than 4 MB/.test(failure.message) ? 'This file is larger than 4 MB. Export only your passwords, then try again.'
        : 'Could not import this file. Pick the CSV file that your password app exported.');
    } finally { if (alive.current) setBusy(false); }
  };

  const logins = items?.filter(i => i.kind === 'login') ?? [];
  const addresses = items?.filter(i => i.kind === 'address') ?? [];
  const row = (item: VaultItem, detail: string) => <li key={item.id} className="vault-item">
    <div className="vault-item-info"><strong>{item.label}</strong>{detail && <span className="settings-description">{detail}</span>}
      {item.has_otp && <span className="vault-badge">2FA codes automatic</span>}</div>
    {confirming === item.id ? <div className="settings-actions"><button type="button" disabled={busy} onClick={() => remove(item)}>{busy ? 'Removing…' : `Remove ${item.label}`}</button>
      <button type="button" className="secondary" disabled={busy} onClick={() => setConfirming(null)}>Keep</button></div>
      : <div className="vault-item-actions">
        {manage && item.kind === 'login' && <button type="button" className="secondary" aria-label={`Edit ${item.label}`} disabled={busy || editing?.id === item.id} onClick={() => startEdit(item)}>Edit</button>}
        <button type="button" className="secondary" aria-label={`Remove ${item.label}`} disabled={busy} onClick={() => { setConfirming(item.id); setNotice(''); }}>Remove</button></div>}
  </li>;
  const input = (label: string, value: string, onChange: (value: string) => void, extra: Record<string, unknown> = {}) =>
    <label className="settings-field">{label}<input aria-label={label} value={value} disabled={busy} spellCheck={false} onChange={event => onChange(event.target.value)} {...extra} /></label>;

  return <div className="vault-settings">
    <p className="settings-description">Hermes signs in and fills forms for you in its own browser, only on the exact website saved. The Agent never sees your passwords. Removing an item does not change your account on the website.</p>
    {items === null && !error && <p role="status" className="settings-description">Loading…</p>}
    {items !== null && <>
      <h6>Logins</h6>
      {logins.length ? <ul className="vault-list" aria-label="Saved logins">{logins.map(item => row(item, [item.identifier, host(item.origin)].filter(Boolean).join(' · ')))}</ul> : <p className="settings-description">No saved logins.</p>}
      <h6>Addresses</h6>
      {addresses.length ? <ul className="vault-list" aria-label="Saved addresses">{addresses.map(item => row(item, ''))}</ul> : <p className="settings-description">No saved addresses.</p>}
    </>}
    {editing && <form aria-label={`Edit ${editing.label}`} onSubmit={event => { event.preventDefault(); void saveEdit(); }}>
      <h6>Edit {editing.label}</h6>
      {input('Website', edit.site, v => setEdit(o => ({ ...o, site: v })), { maxLength: 300, required: true, autoFocus: true, autoComplete: 'off' })}
      {input('Email or username', edit.identifier, v => setEdit(o => ({ ...o, identifier: v })), { maxLength: 320, required: true, autoComplete: 'off' })}
      {input('New password (optional)', edit.password, v => setEdit(o => ({ ...o, password: v })), { type: 'password', maxLength: 1024, autoComplete: 'new-password' })}
      {input(editing.has_otp ? 'New authenticator key (optional)' : 'Authenticator key (optional)', edit.otp, v => setEdit(o => ({ ...o, otp: v, clearOtp: false })), { type: 'password', maxLength: 512, autoComplete: 'off' })}
      {editing.has_otp && !edit.otp && <label className="vault-checkbox"><input type="checkbox" checked={edit.clearOtp} disabled={busy}
        onChange={event => setEdit(o => ({ ...o, clearOtp: event.target.checked }))} />Remove the authenticator key</label>}
      {input('Name', edit.label, v => setEdit(o => ({ ...o, label: v })), { maxLength: 120 })}
      <p className="settings-description">Leave the password empty to keep the saved one. The authenticator key works the same way.</p>
      <div className="settings-actions"><button type="submit" disabled={busy || !edit.site.trim() || !edit.identifier.trim()}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => { setEditing(null); setEdit(EMPTY_EDIT); }}>Cancel</button></div>
    </form>}
    {adding === 'import' ? <div className="vault-import" role="group" aria-label="Import passwords">
      <h6>Import passwords</h6>
      <p className="settings-description">{VAULT_IMPORT_SOURCES} Logins already saved for the same website and account are updated.</p>
      <p className="settings-description">{VAULT_IMPORT_DELETE_HINT}</p>
      <div className="settings-actions"><button type="button" disabled={busy} onClick={() => void runImport()}>{busy ? 'Importing…' : 'Choose file…'}</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => setAdding(null)}>Cancel</button></div>
    </div> : adding === 'login' ? <form onSubmit={event => { event.preventDefault(); void saveLogin(); }}>
      <h6>Add login</h6>
      {input('Website', login.site, v => setLogin(o => ({ ...o, site: v })), { placeholder: 'github.com', maxLength: 300, required: true, autoFocus: true, autoComplete: 'off' })}
      {input('Email or username', login.identifier, v => setLogin(o => ({ ...o, identifier: v })), { maxLength: 320, required: true, autoComplete: 'off' })}
      {input('Password', login.password, v => setLogin(o => ({ ...o, password: v })), { type: 'password', maxLength: 1024, required: true, autoComplete: 'new-password' })}
      {input('Authenticator key (optional)', login.otp, v => setLogin(o => ({ ...o, otp: v })), { type: 'password', maxLength: 512, autoComplete: 'off' })}
      <p className="settings-description">The authenticator key is the setup key or otpauth:// link a website shows when you turn on two-factor sign-in. With it, Hermes enters 2FA codes without asking you.</p>
      {input('Name (optional)', login.label, v => setLogin(o => ({ ...o, label: v })), { maxLength: 120 })}
      <div className="settings-actions"><button type="submit" disabled={busy || !login.site.trim() || !login.identifier.trim() || !login.password}>{busy ? 'Saving…' : 'Save login'}</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => { setLogin(EMPTY_LOGIN); setAdding(null); }}>Cancel</button></div>
    </form> : adding === 'address' ? <form onSubmit={event => { event.preventDefault(); void saveAddress(); }}>
      <h6>Add address</h6>
      {input('Name', address.label, v => setAddress(o => ({ ...o, label: v })), { placeholder: 'Home', maxLength: 120, autoFocus: true })}
      {input('Address', address.address_line1, v => setAddress(o => ({ ...o, address_line1: v })), { maxLength: 200, required: true })}
      {input('Apartment, suite (optional)', address.address_line2, v => setAddress(o => ({ ...o, address_line2: v })), { maxLength: 200 })}
      {input('City', address.city, v => setAddress(o => ({ ...o, city: v })), { maxLength: 200, required: true })}
      {input('State (optional)', address.state, v => setAddress(o => ({ ...o, state: v })), { maxLength: 200 })}
      {input('Postal code', address.postal_code, v => setAddress(o => ({ ...o, postal_code: v })), { maxLength: 200, required: true })}
      {input('Country', address.country, v => setAddress(o => ({ ...o, country: v })), { maxLength: 200, required: true })}
      <div className="settings-actions"><button type="submit" disabled={busy || !address.address_line1.trim() || !address.city.trim() || !address.postal_code.trim() || !address.country.trim()}>{busy ? 'Saving…' : 'Save address'}</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => { setAddress(EMPTY_ADDRESS); setAdding(null); }}>Cancel</button></div>
    </form> : items !== null && <div className="settings-actions">
      <button type="button" disabled={busy} onClick={() => { setNotice(''); setEditing(null); setAdding('login'); }}>Add login</button>
      <button type="button" className="secondary" disabled={busy} onClick={() => { setNotice(''); setEditing(null); setAdding('address'); }}>Add address</button>
      {manage && <button type="button" className="secondary" disabled={busy} onClick={() => { setNotice(''); setEditing(null); setAdding('import'); }}>Import passwords…</button>}
    </div>}
    {notice && <p role="status" className="settings-description">{notice}</p>}
    {error && <><p role="alert">{error}</p>{items === null && <button type="button" className="secondary" onClick={() => void load()}>Reload</button>}</>}
  </div>;
}
