import { useState } from 'react';
import type { DesktopVaultAnswer, DesktopVaultPrompt } from '../shared/desktop-api';

/**
 * In-chat vault prompt (docs/vault.md): Hermes waits for a login to save or a one-time code.
 * Values stay in this card until sent once to the main process, then are cleared.
 */
export function VaultPromptCard({ prompt }: { prompt: DesktopVaultPrompt }) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const send = async (answer: DesktopVaultAnswer) => {
    if (sending) return;
    setSending(true);
    try { await window.hermesDesktop.answerVaultPrompt(prompt.id, answer); }
    catch { /* the main process shows the notice */ }
    finally { setIdentifier(''); setPassword(''); setCode(''); setSending(false); }
  };
  if (prompt.kind === 'save_login') {
    return <form className="interaction-card vault-prompt" aria-label={`Save your ${prompt.site} login`}
      onSubmit={event => { event.preventDefault(); if (identifier.trim() && password) void send({ decision: 'submit', identifier: identifier.trim(), password }); }}>
      <strong>Save your {prompt.site} login?</strong>
      <p>Hermes signs in for you. The password is saved encrypted on your Hermes and the Agent never sees it.</p>
      <div className="vault-prompt-fields">
        <input aria-label="Email or username" placeholder="Email or username" autoComplete="username" spellCheck={false} maxLength={320}
          value={identifier} disabled={sending} onChange={event => setIdentifier(event.target.value)} />
        <input aria-label="Password" placeholder="Password" type="password" autoComplete="current-password" maxLength={1024}
          value={password} disabled={sending} onChange={event => setPassword(event.target.value)} />
      </div>
      <div><button type="submit" disabled={sending || !identifier.trim() || !password}>Save &amp; sign in</button>
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
