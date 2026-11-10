import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Text, TextInput } from './FontSize';
import { SettingsBlock, SettingsPage, SettingsSection } from './SettingsUI';
import { VAULT_IMPORT_MAX_BYTES, type NewVaultItem, type VaultImportResult, type VaultItem, type VaultItemChange } from '../../../packages/client/src/index';
import { VAULT_IMPORT_DELETE_HINT, VAULT_IMPORT_SOURCES, vaultImportSummary } from '../../../packages/client/src/vaultPresentation';

export type VaultApi = {
  vaultItems(signal?: AbortSignal): Promise<VaultItem[]>;
  addVaultItem(item: NewVaultItem): Promise<VaultItem>;
  removeVaultItem(id: string): Promise<boolean>;
  /** Servers with vault_manage. */
  supportsVaultManage?: boolean;
  updateVaultItem?(id: string, change: VaultItemChange): Promise<VaultItem>;
  importVaultCsv?(csv: string): Promise<VaultImportResult>;
};

/** One picked CSV export as text, or null when cancelled. The app's cached copy is deleted after reading. */
async function pickCsvText(): Promise<string | null> {
  const picked = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: false, copyToCacheDirectory: true });
  if (picked.canceled || !picked.assets?.length) return null;
  const asset = picked.assets[0];
  const file = new File(asset.uri);
  try {
    if ((asset.size ?? 0) > VAULT_IMPORT_MAX_BYTES) throw new RangeError('too large');
    return await file.text();
  } finally { try { file.delete(); } catch { /* the cache is cleared by the system too */ } }
}

const host = (origin: string | null) => (origin ?? '').replace(/^https?:\/\//, '');
const EMPTY_LOGIN = { site: '', identifier: '', password: '', otp: '', label: '' };
const EMPTY_EDIT = { site: '', identifier: '', password: '', otp: '', label: '', clearOtp: false };
const EMPTY_ADDRESS = { label: '', address_line1: '', address_line2: '', city: '', state: '', postal_code: '', country: '' };

/**
 * Settings > Passwords & Logins of one connection (docs/vault.md). Saved on that
 * Hermes for all devices. Lists metadata only; secrets are sent once when added.
 */
export function VaultSettings({ client, pickCsv = pickCsvText }: { client: VaultApi; pickCsv?: () => Promise<string | null> }) {
  const [items, setItems] = useState<VaultItem[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<'login' | 'address' | 'import' | null>(null);
  const [editing, setEditing] = useState<VaultItem | null>(null);
  const [login, setLogin] = useState(EMPTY_LOGIN);
  const [edit, setEdit] = useState(EMPTY_EDIT);
  const [address, setAddress] = useState(EMPTY_ADDRESS);
  const manage = client.supportsVaultManage === true && !!client.updateVaultItem && !!client.importVaultCsv;
  const alive = useRef(true);
  const load = useCallback(async () => {
    const controller = new AbortController();
    setError('');
    try { const value = await client.vaultItems(controller.signal); if (alive.current) setItems(value); }
    catch { if (alive.current) setError('Could not load saved logins. Check the connection and try again.'); }
    return () => controller.abort();
  }, [client]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);

  const save = async (item: NewVaultItem, done: () => void) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await client.addVaultItem(item);
      if (!alive.current) return;
      done(); setAdding(null); setNotice('Saved.'); await load();
    } catch {
      if (alive.current) setError(item.kind === 'login'
        ? 'Could not save this login. Check the website and the authenticator key, then try again.'
        : 'Could not save this address. Fill in address, city, postal code and country, then try again.');
    } finally { if (alive.current) setBusy(false); }
  };
  const remove = (item: VaultItem) => Alert.alert(`Remove ${item.label}?`,
    'Hermes can no longer sign in or fill this for you. Your account on the website is not changed.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        setBusy(true); setError(''); setNotice('');
        try { await client.removeVaultItem(item.id); if (alive.current) { setNotice('Removed.'); await load(); } }
        catch { if (alive.current) setError('Could not confirm the removal. Reload the list before trying again.'); }
        finally { if (alive.current) setBusy(false); }
      } },
    ]);
  const startEdit = (item: VaultItem) => {
    setNotice(''); setError(''); setAdding(null); setEditing(item);
    setEdit({ ...EMPTY_EDIT, site: host(item.origin), identifier: item.identifier ?? '', label: item.label });
  };
  const saveEdit = async () => {
    if (busy || !editing || !client.updateVaultItem) return;
    setBusy(true); setError(''); setNotice('');
    const change: VaultItemChange = { label: edit.label.trim(), origin: edit.site.trim(), identifier: edit.identifier.trim(),
      ...(edit.password ? { password: edit.password } : {}),
      ...(edit.otp.trim() ? { otp_secret: edit.otp.trim() } : edit.clearOtp ? { clear_otp: true } : {}) };
    try {
      await client.updateVaultItem(editing.id, change);
      if (!alive.current) return;
      setEditing(null); setEdit(EMPTY_EDIT); setNotice('Saved.'); await load();
    } catch {
      if (alive.current) setError('Could not save the change. Check the website and the authenticator key, then try again.');
    } finally { if (alive.current) setBusy(false); }
  };
  const runImport = async () => {
    if (busy || !client.importVaultCsv) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const text = await pickCsv();
      if (text === null || !alive.current) return;
      const result = await client.importVaultCsv(text);
      if (!alive.current) return;
      setAdding(null); setNotice(`${vaultImportSummary(result)} ${VAULT_IMPORT_DELETE_HINT}`); await load();
    } catch (failure) {
      if (alive.current) setError(failure instanceof RangeError || (failure instanceof Error && /too large|413/.test(failure.message))
        ? 'This file is larger than 4 MB. Export only your passwords, then try again.'
        : 'Could not import this file. Pick the CSV file that your password app exported.');
    } finally { if (alive.current) setBusy(false); }
  };

  const button = (label: string, onPress: () => void, disabled = busy, danger = false) =>
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.button, danger && styles.dangerButton, pressed && styles.pressed, disabled && styles.disabled]}>
      <Text style={[styles.buttonText, danger && styles.dangerText]}>{label}</Text>
    </Pressable>;
  const field = (label: string, value: string, onChange: (value: string) => void, extra: Partial<React.ComponentProps<typeof TextInput>> = {}) =>
    <TextInput accessibilityLabel={label} placeholder={label} value={value} onChangeText={onChange}
      autoCapitalize="none" autoCorrect={false} editable={!busy} style={styles.input} {...extra} />;
  const logins = items?.filter(i => i.kind === 'login') ?? [];
  const addresses = items?.filter(i => i.kind === 'address') ?? [];
  const loginReady = !!login.site.trim() && !!login.identifier.trim() && !!login.password;
  const addressReady = !!address.address_line1.trim() && !!address.city.trim() && !!address.postal_code.trim() && !!address.country.trim();

  return <SettingsPage>
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {!!notice && <Text accessibilityLiveRegion="polite" style={styles.hint}>{notice}</Text>}
    <SettingsSection title="Logins" footer="When Hermes reaches a sign-in page, it fills the password for that exact website. The Agent never sees your passwords.">
      {items === null && !error && <SettingsBlock first><Text accessibilityLiveRegion="polite" style={styles.hint}>Loading…</Text></SettingsBlock>}
      {items !== null && !logins.length && <SettingsBlock first><Text style={styles.hint}>No saved logins.</Text></SettingsBlock>}
      {logins.map((item, index) => <SettingsBlock key={item.id} first={index === 0}>
        <View style={styles.itemRow}>
          <View style={styles.itemText}>
            <Text numberOfLines={1} style={styles.itemTitle}>{item.label}</Text>
            <Text numberOfLines={1} style={styles.hint}>{[item.identifier, host(item.origin)].filter(Boolean).join(' · ')}</Text>
            {item.has_otp && <Text style={styles.badge}>2FA codes automatic</Text>}
          </View>
          {manage && button('Edit', () => startEdit(item), busy || editing?.id === item.id)}
          {button('Remove', () => remove(item), busy, true)}
        </View>
      </SettingsBlock>)}
    </SettingsSection>
    {editing && <SettingsSection title={`Edit ${editing.label}`} footer="Leave the password empty to keep the saved one. The authenticator key works the same way.">
      <SettingsBlock first>
        {field('Website', edit.site, v => setEdit(o => ({ ...o, site: v })), { keyboardType: 'url', textContentType: 'URL', maxLength: 300 })}
        {field('Email or username', edit.identifier, v => setEdit(o => ({ ...o, identifier: v })), { textContentType: 'username', autoComplete: 'username', maxLength: 320 })}
        {field('New password (optional)', edit.password, v => setEdit(o => ({ ...o, password: v })), { secureTextEntry: true, textContentType: 'password', autoComplete: 'current-password', maxLength: 1024 })}
        {field(editing.has_otp ? 'New authenticator key (optional)' : 'Authenticator key (optional)', edit.otp, v => setEdit(o => ({ ...o, otp: v, clearOtp: false })), { secureTextEntry: true, maxLength: 512 })}
        {editing.has_otp && !edit.otp && <View style={styles.switchRow}>
          <Text style={[styles.hint, styles.itemText]}>Remove the authenticator key</Text>
          <Switch accessibilityLabel="Remove the authenticator key" value={edit.clearOtp} disabled={busy}
            onValueChange={value => setEdit(o => ({ ...o, clearOtp: value }))} />
        </View>}
        {field('Name', edit.label, v => setEdit(o => ({ ...o, label: v })), { autoCapitalize: 'words', maxLength: 120 })}
        <View style={styles.actions}>
          {button('Cancel', () => { setEditing(null); setEdit(EMPTY_EDIT); })}
          {button(busy ? 'Saving…' : 'Save', () => { void saveEdit(); }, busy || !edit.site.trim() || !edit.identifier.trim())}
        </View>
      </SettingsBlock>
    </SettingsSection>}
    <SettingsSection title="Addresses" footer="Hermes fills an address when a form asks for it.">
      {items !== null && !addresses.length && <SettingsBlock first><Text style={styles.hint}>No saved addresses.</Text></SettingsBlock>}
      {addresses.map((item, index) => <SettingsBlock key={item.id} first={index === 0}>
        <View style={styles.itemRow}>
          <Text numberOfLines={1} style={[styles.itemTitle, styles.itemText]}>{item.label}</Text>
          {button('Remove', () => remove(item), busy, true)}
        </View>
      </SettingsBlock>)}
    </SettingsSection>
    {adding === 'login' ? <SettingsSection title="Add login" footer="The authenticator key is the setup key or otpauth:// link a website shows when you turn on two-factor sign-in. With it, Hermes enters 2FA codes without asking you.">
      <SettingsBlock first>
        {field('Website, for example github.com', login.site, v => setLogin(o => ({ ...o, site: v })), { keyboardType: 'url', textContentType: 'URL', maxLength: 300 })}
        {field('Email or username', login.identifier, v => setLogin(o => ({ ...o, identifier: v })), { textContentType: 'username', autoComplete: 'username', maxLength: 320 })}
        {field('Password', login.password, v => setLogin(o => ({ ...o, password: v })), { secureTextEntry: true, textContentType: 'password', autoComplete: 'current-password', maxLength: 1024 })}
        {field('Authenticator key (optional)', login.otp, v => setLogin(o => ({ ...o, otp: v })), { secureTextEntry: true, maxLength: 512 })}
        {field('Name (optional)', login.label, v => setLogin(o => ({ ...o, label: v })), { autoCapitalize: 'words', maxLength: 120 })}
        <View style={styles.actions}>
          {button('Cancel', () => { setLogin(EMPTY_LOGIN); setAdding(null); })}
          {button(busy ? 'Saving…' : 'Save login', () => { void save({ kind: 'login', label: login.label.trim() || host(login.site.trim()) || login.site.trim(), origin: login.site.trim(),
            secret: { identifier: login.identifier.trim(), password: login.password, ...(login.otp.trim() ? { otp_secret: login.otp.trim() } : {}) } }, () => setLogin(EMPTY_LOGIN)); }, busy || !loginReady)}
        </View>
      </SettingsBlock>
    </SettingsSection> : adding === 'address' ? <SettingsSection title="Add address">
      <SettingsBlock first>
        {field('Name, for example Home', address.label, v => setAddress(o => ({ ...o, label: v })), { autoCapitalize: 'words', maxLength: 120 })}
        {field('Address', address.address_line1, v => setAddress(o => ({ ...o, address_line1: v })), { autoCapitalize: 'words', textContentType: 'streetAddressLine1', maxLength: 200 })}
        {field('Apartment, suite (optional)', address.address_line2, v => setAddress(o => ({ ...o, address_line2: v })), { autoCapitalize: 'words', textContentType: 'streetAddressLine2', maxLength: 200 })}
        {field('City', address.city, v => setAddress(o => ({ ...o, city: v })), { autoCapitalize: 'words', textContentType: 'addressCity', maxLength: 200 })}
        {field('State (optional)', address.state, v => setAddress(o => ({ ...o, state: v })), { autoCapitalize: 'characters', textContentType: 'addressState', maxLength: 200 })}
        {field('Postal code', address.postal_code, v => setAddress(o => ({ ...o, postal_code: v })), { autoCapitalize: 'characters', textContentType: 'postalCode', maxLength: 200 })}
        {field('Country', address.country, v => setAddress(o => ({ ...o, country: v })), { autoCapitalize: 'words', textContentType: 'countryName', maxLength: 200 })}
        <View style={styles.actions}>
          {button('Cancel', () => { setAddress(EMPTY_ADDRESS); setAdding(null); })}
          {button(busy ? 'Saving…' : 'Save address', () => {
            const secret = Object.fromEntries(Object.entries(address).filter(([key, value]) => key !== 'label' && value.trim()).map(([key, value]) => [key, value.trim()]));
            void save({ kind: 'address', label: address.label.trim() || 'Address', secret: secret as never }, () => setAddress(EMPTY_ADDRESS));
          }, busy || !addressReady)}
        </View>
      </SettingsBlock>
    </SettingsSection> : adding === 'import' ? <SettingsSection title="Import passwords" footer={`Logins already saved for the same website and account are updated. ${VAULT_IMPORT_DELETE_HINT}`}>
      <SettingsBlock first>
        <Text style={styles.hint}>{VAULT_IMPORT_SOURCES}</Text>
        <View style={styles.actions}>
          {button('Cancel', () => setAdding(null))}
          {button(busy ? 'Importing…' : 'Choose file', () => { void runImport(); })}
        </View>
      </SettingsBlock>
    </SettingsSection> : <SettingsSection>
      <SettingsBlock first>
        <View style={styles.actions}>
          {button('Add login', () => { setNotice(''); setEditing(null); setAdding('login'); }, busy || items === null)}
          {button('Add address', () => { setNotice(''); setEditing(null); setAdding('address'); }, busy || items === null)}
          {manage && button('Import passwords', () => { setNotice(''); setEditing(null); setAdding('import'); }, busy || items === null)}
        </View>
      </SettingsBlock>
    </SettingsSection>}
    {!!error && items === null && button('Reload', () => { void load(); })}
  </SettingsPage>;
}

const styles = StyleSheet.create({
  error: { color: '#9d1b32', backgroundColor: '#fff0f2', padding: 10, borderRadius: 8 },
  hint: { fontSize: 13, lineHeight: 19, color: '#607187' },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemText: { flex: 1, minWidth: 0 },
  itemTitle: { fontSize: 16, color: '#172a40' },
  badge: { fontSize: 12, color: '#2b6b3f', marginTop: 2 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { fontSize: 16, minHeight: 44, padding: 12, borderWidth: 1, borderColor: '#cdd7e3', borderRadius: 9, color: '#172a40', backgroundColor: '#fff' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' },
  button: { minHeight: 40, paddingHorizontal: 14, borderRadius: 9, backgroundColor: '#e6edf7', alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 14, color: '#2b4e81', fontWeight: '600' },
  dangerButton: { backgroundColor: '#fff0f2' }, dangerText: { color: '#b42335' },
  pressed: { opacity: 0.8 }, disabled: { opacity: 0.5 },
});
