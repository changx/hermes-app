import { useEffect, useRef, useState, type FormEvent } from "react";
import type { DesktopAttachment, DesktopSnapshot } from "../shared/desktop-api";

export const NewSessionDialog = ({ snapshot, initialChannelId, close, prepared }: {
  snapshot: DesktopSnapshot; initialChannelId?: string; close: () => void;
  prepared: (threadId: string, attachments: readonly DesktopAttachment[]) => void;
}) => {
  const [channelId, setChannelId] = useState(initialChannelId ?? snapshot.selectedChannelId ?? snapshot.channels[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [files, setFiles] = useState<readonly File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const thread = useRef<string | null>(null);
  const clientThreadId = useRef(`th_${crypto.randomUUID().replaceAll("-", "")}`);
  const working = useRef(false);
  const dialog = useRef<HTMLFormElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const cancel = () => { if (!working.current) close(); };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLInputElement>('input[name="title"]')?.focus();
    return () => previous?.focus();
  }, []);
  const choose = (items: readonly File[]) => {
    const next = [...files, ...items];
    if (next.length > 8 || next.some(file => file.size < 1 || file.size > 10 * 1024 * 1024)) {
      setError("Choose up to eight files, each between 1 byte and 10 MiB."); return;
    }
    setFiles(next); setError("");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (working.current || !title.trim() || !snapshot.channels.some(channel => channel.id === channelId)) return;
    working.current = true; setBusy(true); setAttempted(true); setError("");
    try {
      if (!thread.current) {
        thread.current = await window.hermesDesktop.createThread({ channelId, title: title.trim(), clientThreadId: clientThreadId.current });
        setCreated(true);
      }
      const attachments = files.length ? await window.hermesDesktop.uploadDroppedFiles(files, thread.current) : [];
      prepared(thread.current, attachments);
      close();
    } catch {
      setError(thread.current ? "Your session was created, but the files could not be uploaded. Keep this form open to try again, or continue without files." : "The session could not be created. Your title and files are still here.");
    } finally { working.current = false; setBusy(false); }
  };
  return <div className="modal-backdrop" role="presentation" onMouseDown={cancel}>
    <form ref={dialog} className="editor-dialog new-session-dialog" role="dialog" aria-modal="true" aria-label="New session" aria-busy={busy} onSubmit={submit} onMouseDown={event => event.stopPropagation()}
      onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!working.current) choose([...event.dataTransfer.files]); }}
      onKeyDown={event => {
        if (event.key === "Escape") { event.stopPropagation(); cancel(); }
        if (event.key === "Tab") {
          if (working.current) { event.preventDefault(); return; }
          const items = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)') ?? [])].filter(item => !item.hidden);
          const first = items[0], last = items.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <h2>New session</h2>
      <label>Channel<select aria-label="Channel" value={channelId} disabled={busy || attempted} onChange={event => setChannelId(event.target.value)}>{snapshot.channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>
      <label>Title<input name="title" aria-label="Title" required maxLength={200} value={title} disabled={busy || attempted} onChange={event => setTitle(event.target.value)} /></label>
      <input ref={picker} type="file" hidden multiple onChange={event => { choose([...event.target.files ?? []]); event.target.value = ""; }} />
      <button className="session-attach" type="button" disabled={busy} onClick={() => picker.current?.click()}>＋ Attach files</button>
      {files.length > 0 && <ul className="session-files">{files.map((file, index) => <li key={index}><span>{file.name}</span><button type="button" disabled={busy} aria-label={`Remove ${file.name}`} onClick={() => setFiles(old => old.filter((_, i) => i !== index))}>×</button></li>)}</ul>}
      <p className="session-hint">Files will be uploaded into the new session's message draft. Nothing is sent until you press Send.</p>
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="secondary" disabled={busy} onClick={cancel}>{created ? "Continue without files" : "Cancel"}</button><button type="submit" disabled={busy || !title.trim() || !snapshot.channels.some(channel => channel.id === channelId)}>{busy ? "Preparing…" : created ? "Upload files" : "Create session"}</button></div>
    </form>
  </div>;
};
