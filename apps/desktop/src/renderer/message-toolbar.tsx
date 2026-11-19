import { useEffect, useRef, useState } from "react";
import type { DesktopMessage, DesktopMessageSource } from "../shared/desktop-api";
import { SIDE_FAILURE_TEXT } from "../../../../packages/client/src/sideChats";

// Stroke icons in the Session toolbar style (20-unit box). Decorative: buttons carry names.
export const MESSAGE_ICONS = {
  branch: 'M6 3.5v13M6 7.5c0 3 8 2 8 6.5M6 16.5a1.6 1.6 0 100-3.2 1.6 1.6 0 000 3.2zM14 17.5a1.6 1.6 0 100-3.2 1.6 1.6 0 000 3.2zM6 5.1a1.6 1.6 0 100-3.2 1.6 1.6 0 000 3.2z',
  copy: 'M7 7h9v9H7zM4 13V4h9',
  references: 'M8.5 11.5l3-3M7 9.5l-1.6 1.6a2.6 2.6 0 003.7 3.7L10.7 13M13 10.5l1.6-1.6a2.6 2.6 0 00-3.7-3.7L9.3 6.8',
  export: 'M10 3v10M6.5 6.5L10 3l3.5 3.5M4 12.5v4h12v-4',
  retry: 'M15.5 10a5.5 5.5 0 11-1.6-3.9M15.5 3.5v3h-3',
  side: 'M4 4.5h8.5v6H8l-2.5 2v-2H4zM12.5 7.5h3.5v6h-1.5v2l-2.5-2H9.5v-1.5',
  toMain: 'M15.5 5v4.5a2 2 0 01-2 2H5M8 8.5l-3 3 3 3',
} as const;
export const MessageIcon = ({ name }: { name: keyof typeof MESSAGE_ICONS }) => <svg viewBox="0 0 20 20" aria-hidden="true"><path d={MESSAGE_ICONS[name]} /></svg>;

/** Copy icon beside a user message's time. Copies the original message text. */
export const UserMessageCopy = ({ text }: { text: string }) => {
  const [note, setNote] = useState("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const onCopy = () => { void window.hermesDesktop.copyText(text).then(() => { if (mounted.current) setNote("Copied"); }, () => { if (mounted.current) setNote("Could not copy."); }); };
  useEffect(() => { if (!note) return; const timer = setTimeout(() => setNote(""), 1400); return () => clearTimeout(timer); }, [note]);
  return <>{note && <span className="user-message-copy-note" role="status">{note}</span>}<button type="button" className="user-message-copy" aria-label="Copy message" title="Copy" onClick={onCopy}><MessageIcon name="copy" /></button></>;
};

const sourceLabel = (url: string) => { try { const u = new URL(url); return u.hostname.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname); } catch { return url; } };
const branchError = { busy: 'Wait until the current reply finishes, then try again.', unavailable: 'This reply cannot start a branch.', failed: 'Could not create the branch. Try again.' } as const;

/**
 * Side chat button (docs/side-chat.md). While the Session runs, the server waits until it is idle,
 * then the side chat opens in the right column; the button shows that it waits.
 */
export const SideChatButton = ({ refSeq, running }: { refSeq: number; running: boolean }) => {
  const [busy, setBusy] = useState(false), [note, setNote] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const onSide = async () => {
    setBusy(true); setNote(running ? 'Opens when the current reply finishes…' : '');
    try { const result = await window.hermesDesktop.sideFromMessage(refSeq); if (mounted.current) setNote(result.ok ? '' : SIDE_FAILURE_TEXT[result.reason]); }
    catch { if (mounted.current) setNote(SIDE_FAILURE_TEXT.failed); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <><button type="button" aria-label="Side chat" title="Side chat: discuss this message beside the session" disabled={busy} aria-busy={busy} onClick={() => void onSide()}><MessageIcon name="side" /></button>
    {note && <span className="message-toolbar-note" role="status">{note}</span>}</>;
};

/** Always-visible row under a final reply: Branch, Copy, References, Export, Retry. */
export const MessageToolbar = ({ message, canRetry, running, branch, sources, side = false, toMain = false }: { message: DesktopMessage; canRetry: boolean; running: boolean; branch: boolean; sources: boolean;
  /** Side chat button (main Sessions with `thread_side`). */ side?: boolean; /** Send to main (side chat panels). */ toMain?: boolean }) => {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [list, setList] = useState<{ open: boolean; items?: readonly DesktopMessageSource[]; loading?: boolean; failed?: boolean }>({ open: false });
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const refSeq = message.refSeq!;
  const say = (text: string) => { if (mounted.current) setNote(text); };
  const onBranch = async () => {
    setBusy(true); setNote("");
    try { const result = await window.hermesDesktop.branchFromMessage(refSeq); if (!result.ok) say(branchError[result.reason]); }
    catch { say(branchError.failed); }
    finally { if (mounted.current) setBusy(false); }
  };
  const onSources = async () => {
    if (list.open) { setList(old => ({ ...old, open: false })); return; }
    if (list.items) { setList(old => ({ ...old, open: true })); return; }
    setList({ open: true, loading: true });
    try { const items = await window.hermesDesktop.messageSources(refSeq); if (mounted.current) setList({ open: true, items }); }
    catch { if (mounted.current) setList({ open: true, failed: true }); }
  };
  const onCopy = () => { setNote(""); void window.hermesDesktop.copyText(message.text).then(() => say("Copied"), () => say("Could not copy.")); };
  const onExport = () => { setNote(""); void window.hermesDesktop.exportMessage(message.text).then(r => { if (!r.ok) say("Could not export this message."); else if (r.saved) say("Saved"); }, () => say("Could not export this message.")); };
  const onToMain = () => { setNote(""); void window.hermesDesktop.sendToMain(refSeq).catch(() => say("Could not copy this reply to the session.")); };
  const onRetry = () => { setNote(""); void window.hermesDesktop.retryLatest().catch(() => say("Could not retry. Try again.")); };
  return <div className="message-toolbar-wrap">
    <div className="message-toolbar" role="toolbar" aria-label="Message actions">
      {toMain && <button type="button" aria-label="Send to main" title="Put this reply into the session's message box" onClick={onToMain}><MessageIcon name="toMain" /></button>}
      {side && <SideChatButton refSeq={refSeq} running={running} />}
      {branch && <button type="button" aria-label="Branch" title="Branch into a new session" disabled={busy || running} aria-busy={busy} onClick={() => void onBranch()}><MessageIcon name="branch" /></button>}
      <button type="button" aria-label="Copy" title="Copy" onClick={onCopy}><MessageIcon name="copy" /></button>
      {sources && <button type="button" aria-label="References" title="References" aria-expanded={list.open} onClick={() => void onSources()}><MessageIcon name="references" /></button>}
      <button type="button" aria-label="Export" title="Export message" onClick={onExport}><MessageIcon name="export" /></button>
      {canRetry && <button type="button" aria-label="Retry" title="Retry" disabled={running} onClick={onRetry}><MessageIcon name="retry" /></button>}
      {note && <span className="message-toolbar-note" role="status">{note}</span>}
      {message.model && <span className="message-model" title={`Generated by ${message.model}`}>{message.model}</span>}
    </div>
    {list.open && <div className="message-sources" aria-live="polite">
      {list.loading ? <p>Loading references…</p> : list.failed ? <p>Could not load references. Try again later.</p>
        : !list.items?.length ? <p>No web pages were used for this reply.</p>
        : <ul>{list.items.map(item => <li key={item.url}><a href={item.url} target="_blank" rel="noreferrer" title={item.url}>{sourceLabel(item.url)}</a>{item.kind === 'cited' && <small>cited</small>}</li>)}</ul>}
    </div>}
  </div>;
};
