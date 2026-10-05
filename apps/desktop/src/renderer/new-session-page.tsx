import { useRef, useState } from 'react';
import type { DesktopAttachment, DesktopSnapshot } from '../shared/desktop-api';

export function NewSessionPage({ snapshot }: { snapshot: DesktopSnapshot }) {
  const [project, setProject] = useState(snapshot.initialChannelId ?? snapshot.selectedChannelId ?? snapshot.channels[0]?.id ?? '');
  const [message, setMessage] = useState(''), [files, setFiles] = useState<readonly File[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [attempted, setAttempted] = useState(false);
  const thread = useRef<string | undefined>(undefined), uploads = useRef<readonly DesktopAttachment[]>([]), saved = useRef(false);
  const threadId = useRef(`th_${crypto.randomUUID().replaceAll('-', '')}`), messageId = useRef(`desktop:${crypto.randomUUID()}`);
  const working = useRef(false), picker = useRef<HTMLInputElement>(null);
  const choose = (items: readonly File[]) => {
    if (working.current || uploads.current.length || saved.current) return;
    const next = [...files, ...items];
    if (next.length > 8 || next.some(file => file.size < 1 || file.size > 10 * 1024 * 1024)) { setError('Choose up to eight files, each between 1 byte and 10 MiB.'); return; }
    setFiles(next); setError('');
  };
  const submit = async () => {
    if (working.current || (!message.trim() && !files.length) || !snapshot.channels.some(c => c.id === project)) return;
    working.current = true; setBusy(true); setError(''); setAttempted(true);
    try {
      if (!thread.current) {
        const title = 'New topic';
        thread.current = await window.hermesDesktop.createThread({ channelId: project, title, clientThreadId: threadId.current });
      }
      if (files.length && !uploads.current.length) uploads.current = await window.hermesDesktop.uploadDroppedFiles(files, thread.current);
      if (!saved.current) {
        if (snapshot.draftIdentity) await window.hermesDesktop.saveLocalDraft(snapshot.draftIdentity, thread.current, { text: message, attachments: uploads.current });
        await window.hermesDesktop.sendMessage({ text: message, attachmentIds: uploads.current.map(a => a.id), clientMessageId: messageId.current });
        saved.current = true;
      }
      await window.hermesDesktop.completeNewTab();
    } catch {
      setError(saved.current ? 'Your message was saved. Try again to open this conversation.' : thread.current
        ? 'Your session was created, but the message could not be prepared. Your text and files are still here. Try again.'
        : 'Your session could not be created. Your text and files are still here. Try again.');
    } finally { working.current = false; setBusy(false); }
  };
  return <main className="new-chat-page" aria-label="New chat" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); choose([...event.dataTransfer.files]); }}>
    <form className="new-chat-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <h1>New chat</h1>
      <label className="new-chat-project">Project<select aria-label="Project" value={project} disabled={busy || attempted} onChange={event => setProject(event.target.value)}>{snapshot.channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <textarea autoFocus aria-label="First message" placeholder="What would you like to work on?" rows={12} maxLength={100_000} value={message} disabled={busy || attempted} onChange={event => setMessage(event.target.value)} onPaste={event => { const items = [...event.clipboardData.files]; if (items.length) { event.preventDefault(); choose(items); } }} onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} />
      <input ref={picker} type="file" hidden multiple onChange={event => { choose([...event.target.files ?? []]); event.target.value = ''; }} />
      {!!files.length && <ul className="session-files">{files.map((file, index) => <li key={index}><span>{file.name}</span><button type="button" disabled={busy || attempted} aria-label={`Remove ${file.name}`} onClick={() => setFiles(old => old.filter((_, i) => i !== index))}>×</button><button type="button" aria-label={`Preview ${file.name}`} disabled={busy || attempted} onClick={() => { setError(''); void window.hermesDesktop.previewLocalFile(file).catch(() => setError('The file could not be previewed.')); }}>Preview</button></li>)}</ul>}
      {error && <p role="alert">{error}</p>}
      <div className="new-chat-actions"><button type="button" className="session-attach" disabled={busy || attempted || files.length >= 8} onClick={() => picker.current?.click()}>＋ Attach files</button><span>⌘Enter to send</span><button className="new-chat-send" type="submit" disabled={busy || (!message.trim() && !files.length) || !project}>{busy ? 'Preparing…' : saved.current ? 'Open conversation' : 'Send'}</button></div>
    </form>
  </main>;
}
