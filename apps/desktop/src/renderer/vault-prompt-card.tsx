import { useState } from 'react';
import type { DesktopVaultAnswer, DesktopVaultPrompt } from '../shared/desktop-api';

const host = (origin: string) => origin.replace(/^https?:\/\//, '');

/**
 * In-chat vault prompt (docs/vault.md): Hermes waits for a login to save or a one-time code.
 * Values stay in this card until sent once to the main process, then are cleared. A value the
 * server rejects (a bad authenticator key) keeps the values and shows a message.
 */
export function VaultPromptCard({ prompt }: { prompt: DesktopVaultPrompt }) {
  const [identifier, setIdentifier] = useState(prompt.identifier ?? '');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [showOtp, setShowOtp] = useState(false);
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const send = async (answer: DesktopVaultAnswer) => {
    if (sending) return;
    setSending(true); setInvalid(false);
    let result: string = 'failed';
    try { result = await window.hermesDesktop.answerVaultPrompt(prompt.id, answer) ?? 'failed'; }
    catch { /* the main process shows the notice */ }
    finally {
      if (result === 'invalid') setInvalid(true);
      else { setIdentifier(''); setPassword(''); setOtp(''); setCode(''); }
      setSending(false);
    }
  };
  if (prompt.kind === 'save_login') {
    const matches = prompt.update ? [] : prompt.matches ?? [];
    const title = prompt.update ? `Update your ${prompt.site} login` : `Save your ${prompt.site} login?`;
    return <form className="interaction-card vault-prompt" aria-label={prompt.update ? `Update your ${prompt.site} login` : `Save your ${prompt.site} login`}
      onSubmit={event => { event.preventDefault(); if (identifier.trim() && password) void send({ decision: 'submit', identifier: identifier.trim(), password, ...(otp.trim() ? { otp_secret: otp.trim() } : {}) }); }}>
      <strong>{title}</strong>
      <p>{prompt.update ? 'The saved password did not work. Enter the current one; it replaces the saved login.'
        : 'Hermes signs in for you. The password is saved encrypted on your Hermes and the Agent never sees it.'}</p>
      {matches.length > 0 && <ul className="vault-prompt-matches" aria-label="Saved logins for this site">
        {matches.map(match => <li key={match.id}><span>{[match.identifier, host(match.origin)].filter(Boolean).join(' · ')}</span>
          <button type="button" disabled={sending} aria-label={`Use saved login ${match.identifier} for ${host(match.origin)}`}
            onClick={() => void send({ decision: 'use', item_id: match.id })}>Use</button></li>)}
      </ul>}
      {matches.length > 0 && <p>Or enter another login:</p>}
      <div className="vault-prompt-fields">
        <input aria-label="Email or username" placeholder="Email or username" autoComplete="username" spellCheck={false} maxLength={320}
          value={identifier} disabled={sending} onChange={event => setIdentifier(event.target.value)} />
        <input aria-label="Password" placeholder="Password" type="password" autoComplete="current-password" maxLength={1024}
          value={password} disabled={sending} onChange={event => setPassword(event.target.value)} />
        {showOtp && <input aria-label="Authenticator key (optional)" placeholder="Authenticator key (optional)" type="password" autoComplete="off" maxLength={512}
          aria-invalid={invalid} value={otp} disabled={sending} onChange={event => { setOtp(event.target.value); setInvalid(false); }} />}
      </div>
      {!showOtp && <button type="button" className="vault-prompt-link" disabled={sending} onClick={() => setShowOtp(true)}>Add authenticator key</button>}
      {invalid && <p role="alert">This authenticator key cannot be used. Paste the setup key or otpauth:// link the website showed, or leave it empty.</p>}
      <div><button type="submit" disabled={sending || !identifier.trim() || !password}>{prompt.update ? 'Update & sign in' : 'Save & sign in'}</button>
        <button type="button" className="secondary" disabled={sending} onClick={() => void send({ decision: 'decline' })}>Don't save</button></div>
    </form>;
  }
  const clean = code.replace(/[\s-]/g, '');
  const valid = /^[0-9A-Za-z]{3,12}$/.test(clean);
  return <form className="interaction-card vault-prompt" aria-label={`Verification code for ${prompt.site}`}
    onSubmit={event => { event.preventDefault(); if (valid) void send({ decision: 'submit', code: clean }); }}>
    <strong>Verification code for {prompt.site}</strong>
    <p>{prompt.hint ? `${prompt.hint} ` : ''}Hermes enters the code on the page. The Agent never sees it.</p>
    <div className="vault-prompt-fields">
      <input aria-label="Verification code" placeholder="Code" autoComplete="one-time-code" inputMode="numeric" spellCheck={false} maxLength={16}
        value={code} disabled={sending} onChange={event => setCode(event.target.value)} />
    </div>
    <div><button type="submit" disabled={sending || !valid}>Enter code</button>
      <button type="button" className="secondary" disabled={sending} onClick={() => void send({ decision: 'decline' })}>Cancel</button></div>
  </form>;
}
