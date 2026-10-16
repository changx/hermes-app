import { useEffect, useRef, useState } from 'react';
import type { AgentModelSettings, ThreadModelChoice } from '@hermes-app/client';
import { threadModelKey, threadModelLabel, threadModelRequest } from '@hermes-app/client/threadModel';
import type { DesktopAttachment, DesktopSnapshot } from '../shared/desktop-api';
import { ATTACHMENT_SIZE_RULE } from '../shared/attachment-input';
import { AttachmentThumbnail } from './attachment-thumbnail';
import { fileSizeLimit, namePastedFiles } from './pasted-files';

/** New chat tab. With `automationEditor` it is New automation: the first message starts the settings
 * conversation in which the agent drafts and creates the automation; only projects whose server supports it are listed. */
export function NewSessionPage({ snapshot }: { snapshot: DesktopSnapshot }) {
  const automation = snapshot.automationEditor === true;
  const projects = automation ? snapshot.channels.filter(c => c.supportsAutomationEditors) : snapshot.channels;
  const preferred = [snapshot.initialChannelId, snapshot.selectedChannelId].find(id => id && projects.some(c => c.id === id));
  const [project, setProject] = useState(preferred ?? projects[0]?.id ?? '');
  const [message, setMessage] = useState(''), [files, setFiles] = useState<readonly File[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [attempted, setAttempted] = useState(false);
  const thread = useRef<string | undefined>(undefined), uploads = useRef<readonly DesktopAttachment[]>([]), saved = useRef(false);
  const threadId = useRef(`th_${crypto.randomUUID().replaceAll('-', '')}`), messageId = useRef(`desktop:${crypto.randomUUID()}`);
  const working = useRef(false), picker = useRef<HTMLInputElement>(null);
  // Model for this session only, listed from the chosen project's own connection.
  const channel = snapshot.channels.find(c => c.id === project);
  const modelKey = channel?.supportsThreadModel && channel.connectionKey ? channel.connectionKey : undefined;
  const [models, setModels] = useState<AgentModelSettings | null>(null), [modelsFailed, setModelsFailed] = useState(false);
  const [modelChoice, setModelChoice] = useState<ThreadModelChoice | null>(null), [modelReload, setModelReload] = useState(0);
  const [confirmation, setConfirmation] = useState(''), [modelLocked, setModelLocked] = useState(false);
  const request = useRef<{ model?: ThreadModelChoice; confirm: boolean } | undefined>(undefined);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // Another project (possibly on another connection) has its own list: reload and use Default.
  useEffect(() => {
    setModels(null); setModelsFailed(false); setModelChoice(null);
    if (!modelKey) return;
    let live = true;
    void window.hermesDesktop.getModelSettings(modelKey).then(value => { if (live) setModels(value); }, () => { if (live) setModelsFailed(true); });
    return () => { live = false; };
  }, [modelKey, project, modelReload]);
  const choose = (items: readonly File[]) => {
    if (working.current || uploads.current.length || saved.current) return;
    const next = [...files, ...items];
    if (next.length > 8 || next.some(file => file.size < 1 || file.size > fileSizeLimit(file))) { setError(ATTACHMENT_SIZE_RULE); return; }
    setFiles(next); setError('');
  };
  const submit = async (confirmModel = false) => {
    if (working.current || (!message.trim() && !files.length) || !projects.some(c => c.id === project)) return;
    working.current = true; setBusy(true); setError(''); setAttempted(true); setModelLocked(true); setConfirmation('');
    try {
      if (!thread.current && !files.length && message.trim() && !(modelKey && threadModelRequest(models, modelChoice))) {
        // Text only, default model: nothing to confirm. The first message is saved in the outbox,
        // this tab becomes the session at once, and the server creates it in the background.
        thread.current = await window.hermesDesktop.startThread({ channelId: project, title: automation ? 'New automation' : 'New topic',
          clientThreadId: threadId.current, text: message, clientMessageId: messageId.current });
        saved.current = true;
        await window.hermesDesktop.completeNewTab();
        return;
      }
      if (!thread.current) {
        const title = automation ? 'New automation' : 'New topic';
        // The model is fixed with the session ID; a retry sends the same request.
        if (!request.current) request.current = { model: modelKey ? threadModelRequest(models, modelChoice) : undefined, confirm: false };
        if (confirmModel) request.current = { ...request.current, confirm: true };
        const { model, confirm } = request.current;
        const result = await window.hermesDesktop.createThread({ channelId: project, title, clientThreadId: threadId.current, ...(model ? { model, confirmModel: confirm } : {}) });
        if (typeof result !== 'string') {
          // Nothing was created, so the same session ID stays valid for the next request.
          request.current = undefined;
          if (!mounted.current) return;
          if ('confirmation_required' in result) setConfirmation(result.warning);
          else { setModelLocked(false); setError('This model is not available. Choose another model and send again.'); }
          return;
        }
        thread.current = result;
      }
      if (files.length && !uploads.current.length) uploads.current = await window.hermesDesktop.uploadDroppedFiles(files, thread.current);
      if (!saved.current) {
        const owner = await window.hermesDesktop.getSnapshot();
        if (owner.draftIdentity) await window.hermesDesktop.saveLocalDraft(owner.draftIdentity, thread.current, { text: message, attachments: uploads.current });
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
  const pickModel = (value: string) => {
    const [provider, model] = value.split('\u0000');
    setModelChoice(value !== 'default' && provider && model ? { provider, model } : null);
  };
  if (automation && !projects.length) return <main className="new-chat-page" aria-label="New automation"><div className="new-chat-form">
    <h1>New automation</h1><p>Creating automations needs a newer Hermes server. Ask the agent in any conversation instead.</p></div></main>;
  return <main className="new-chat-page" aria-label={automation ? 'New automation' : 'New chat'} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); choose([...event.dataTransfer.files]); }}>
    <form className="new-chat-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <h1>{automation ? 'New automation' : 'New chat'}</h1>
      {automation && <p className="new-chat-hint">Describe what should run and when. The agent drafts it with you, tries it once, and creates it after you confirm. Results go to the project you choose.</p>}
      <label className="new-chat-project">Project<select aria-label="Project" value={project} disabled={busy || attempted} onChange={event => setProject(event.target.value)}>{projects.map(c => <option key={c.id} value={c.id}>{c.name}{(snapshot.connections?.length ?? 0) > 1 ? ` — ${c.connectionName}` : ''}</option>)}</select></label>
      {modelKey && (modelsFailed
        ? <p className="new-chat-project new-chat-model">Model<span>{threadModelLabel(null, null)}</span><button type="button" onClick={() => setModelReload(n => n + 1)}>Load models</button></p>
        : <label className="new-chat-project new-chat-model">Model<select aria-label="Model" title="Applies to this conversation only" value={threadModelKey(modelChoice)}
          disabled={busy || modelLocked || !models} onChange={event => pickModel(event.target.value)}>
          <option value="default">{threadModelLabel(models, null)}</option>
          {models?.providers.map(p => {
            const rows = p.models.filter(m => !(p.id === models.provider && m === models.model));
            return rows.length ? <optgroup key={p.id} label={p.name}>{rows.map(m => <option key={m} value={threadModelKey({ provider: p.id, model: m })}>{m}</option>)}</optgroup> : null;
          })}
        </select></label>)}
      {confirmation && <div className="new-chat-confirm" role="alertdialog" aria-label="Confirm model">
        <p>{confirmation}</p>
        <div><button type="button" onClick={() => { setConfirmation(''); setModelLocked(false); }}>Cancel</button>
          <button type="button" onClick={() => { void submit(true); }}>Use this model</button></div>
      </div>}
      <textarea autoFocus aria-label="First message" placeholder={automation ? 'What should run, and when?' : 'What would you like to work on?'} rows={12} maxLength={100_000} value={message} disabled={busy || attempted} onChange={event => setMessage(event.target.value)} onPaste={event => { const items = [...event.clipboardData.files]; if (items.length) { event.preventDefault(); choose(namePastedFiles(items, files.map(({ name }) => name))); } }} onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} />
      <input ref={picker} type="file" hidden multiple onChange={event => { choose([...event.target.files ?? []]); event.target.value = ''; }} />
      {!!files.length && <ul className="session-files">{files.map((file, index) => <li key={index}><AttachmentThumbnail file={file} /><span className="session-file-name">{file.name}</span><button type="button" disabled={busy || attempted} aria-label={`Remove ${file.name}`} onClick={() => setFiles(old => old.filter((_, i) => i !== index))}>×</button><button type="button" aria-label={`Preview ${file.name}`} disabled={busy || attempted} onClick={() => { setError(''); void window.hermesDesktop.previewLocalFile(file).catch(() => setError('The file could not be previewed.')); }}>Preview</button></li>)}</ul>}
      {error && <p role="alert">{error}</p>}
      <div className="new-chat-actions"><button type="button" className="session-attach" disabled={busy || attempted || files.length >= 8} onClick={() => picker.current?.click()}>＋ Attach files</button><span>⌘Enter to send</span><button className="new-chat-send" type="submit" disabled={busy || !!confirmation || (!message.trim() && !files.length) || !project}>{busy ? 'Preparing…' : saved.current ? 'Open conversation' : 'Send'}</button></div>
    </form>
  </main>;
}
