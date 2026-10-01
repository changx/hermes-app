import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useDesktopSnapshot } from "./desktop-store";
import { MessageContent } from "./message-content";
import { compactFileDetail, toolDisplayLabel, toolPresentation } from "../../../../packages/client/src/toolPresentation";
import { orderedThreads } from "./thread-navigation";
import { NavigationPanel } from "./navigation-panel";
import type { DesktopAttachment, DesktopSnapshot } from "../shared/desktop-api";

const drafts = new Map<string, string>();
const draftAttachments = new Map<string, readonly DesktopAttachment[]>();
const EmptyState = ({ children }: { children: string }) => <p className="empty-state">{children}</p>;
const safely = (task: Promise<unknown>) => void task.catch(() => {});

const PairingPanel = ({ busy }: { busy: boolean }) => {
  const [baseUrl, setBaseUrl] = useState("");
  const [code, setCode] = useState("");
  const [deviceName, setDeviceName] = useState("Hermes on Mac");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    safely(window.hermesDesktop.pair({ baseUrl, code, deviceName }));
  };
  return <div className="pairing-wrap"><form className="pairing-card" onSubmit={submit}>
    <div className="empty-mark" aria-hidden="true">H</div><h2>Connect to Hermes</h2>
    <p>Enter the one-time code provided by your administrator. Your device credential stays in macOS secure storage.</p>
    <label>Server<input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} disabled={busy} inputMode="url" autoCapitalize="none" spellCheck={false} placeholder="Your HTTPS server address" /></label>
    <label>Pairing code<input value={code} onChange={(event) => setCode(event.target.value)} disabled={busy} autoCapitalize="characters" autoComplete="one-time-code" placeholder="XXXX-XXXX-XXXX-XXXX" /></label>
    <label>Device name<input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} disabled={busy} maxLength={64} /></label>
    <div className="pairing-actions"><button type="submit" disabled={busy}>Connect</button>{busy ? <button type="button" className="secondary" onClick={() => safely(window.hermesDesktop.cancelPairing())}>Cancel</button> : null}</div>
  </form></div>;
};

type Editor = "new-channel" | "edit-channel" | "new-thread" | "rename-thread" | "palette" | null;
const EditorDialog = ({ kind, snapshot, close }: { kind: Exclude<Editor, null>; snapshot: DesktopSnapshot; close: () => void }) => {
  const channel = snapshot.channels.find(({ id }) => id === snapshot.selectedChannelId);
  const [name, setName] = useState(kind === "edit-channel" ? channel?.name ?? "" : "");
  const [description, setDescription] = useState(kind === "edit-channel" ? channel?.description ?? "" : "");
  const [query, setQuery] = useState("");
  const clientThreadId = useRef(`desktop-thread:${crypto.randomUUID()}`).current;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    let task: Promise<void>;
    if (kind === "new-channel") task = window.hermesDesktop.createChannel({ name, description });
    else if (kind === "edit-channel" && channel) task = window.hermesDesktop.updateChannel(channel.id, { name, description });
    else if (kind === "new-thread") task = window.hermesDesktop.createThread({ title: name, clientThreadId });
    else if (kind === "rename-thread" && snapshot.selectedThreadId) task = window.hermesDesktop.renameThread(snapshot.selectedThreadId, name);
    else return;
    safely(task.then(close));
  };
  if (kind === "palette") {
    const rows = orderedThreads(snapshot.threads).filter(({ title, channelId }) => `${title} ${snapshot.channels.find(({ id }) => id === channelId)?.name ?? ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, 24);
    return <div className="modal-backdrop" role="presentation" onMouseDown={close}><section className="editor-dialog palette" role="dialog" aria-modal="true" aria-label="Switch thread" onMouseDown={(event) => event.stopPropagation()}>
      <input autoFocus aria-label="Find a thread" placeholder="Switch to a thread…" value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="palette-results">{rows.map((thread) => <button key={thread.id} type="button" onClick={() => { safely(window.hermesDesktop.selectThread(thread.id)); close(); }}>{thread.title}<small>{snapshot.channels.find(({ id }) => id === thread.channelId)?.name}</small></button>)}</div>
    </section></div>;
  }
  const channelEditor = kind === "new-channel" || kind === "edit-channel";
  const title = kind === "new-channel" ? "New channel" : kind === "edit-channel" ? "Edit channel" : kind === "new-thread" ? "New topic" : "Rename topic";
  return <div className="modal-backdrop" role="presentation" onMouseDown={close}><form className="editor-dialog" role="dialog" aria-modal="true" aria-label={title} onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
    <h2>{title}</h2><label>{channelEditor ? "Name" : "Title"}<input autoFocus required maxLength={channelEditor ? 120 : 200} value={name} onChange={(event) => setName(event.target.value)} /></label>
    {channelEditor ? <label>Description<textarea maxLength={4000} value={description} onChange={(event) => setDescription(event.target.value)} /></label> : null}
    <div className="dialog-actions"><button type="button" className="secondary" onClick={close}>Cancel</button><button type="submit">Save</button></div>
  </form></div>;
};

const Timeline = ({ snapshot }: { snapshot: DesktopSnapshot }) => {
  const list = useRef<HTMLDivElement>(null);
  const previous = useRef({ threadId: "", first: "", height: 0, count: 0 });
  const [following, setFollowing] = useState(true);
  const [newCount, setNewCount] = useState(0);
  const first = snapshot.messages[0]?.id ?? "";
  useLayoutEffect(() => {
    const node = list.current;
    if (!node) return;
    const old = previous.current;
    if (old.threadId !== snapshot.selectedThreadId) node.scrollTop = node.scrollHeight;
    else if (old.first && first !== old.first && old.count > 0) node.scrollTop += node.scrollHeight - old.height;
    else if (following) node.scrollTop = node.scrollHeight;
    else if (snapshot.messages.length > old.count) setNewCount((value) => value + snapshot.messages.length - old.count);
    previous.current = { threadId: snapshot.selectedThreadId ?? "", first, height: node.scrollHeight, count: snapshot.messages.length };
  }, [first, following, snapshot.messages.length, snapshot.selectedThreadId]);
  const latestVisibleRef = snapshot.messages.reduce((latest, message) => Math.max(latest, message.refSeq ?? 0), 0);
  useEffect(() => {
    const mark = () => {
      if (!following || document.visibilityState !== "visible" || !latestVisibleRef) return;
      safely(window.hermesDesktop.markVisible(latestVisibleRef));
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [following, latestVisibleRef, snapshot.selectedThreadId, snapshot.connectionState]);
  const scroll = () => {
    const node = list.current;
    if (!node) return;
    const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
    setFollowing(atBottom);
    if (atBottom) setNewCount(0);
  };
  const latest = () => { const node = list.current; if (node) node.scrollTop = node.scrollHeight; setFollowing(true); setNewCount(0); };
  return <div className="timeline-wrap">
    <div className="message-list" aria-live="polite" ref={list} onScroll={scroll}>
      {snapshot.canLoadOlder ? <button className="load-older" type="button" onClick={() => safely(window.hermesDesktop.loadOlder())}>Load earlier messages</button> : null}
      {snapshot.messages.length ? snapshot.messages.map((message, index) => {
        const previous = snapshot.messages[index - 1];
        const continuation = message.role === "assistant" && previous?.role === "assistant" && !message.displayKind && !previous.displayKind;
        const finalReply = message.role === "assistant" && message.displayKind === "final";
        const toolsOnly = message.role === "assistant" && !message.text.trim() && message.toolCalls.length > 0;
        const timestamp = message.createdAt ? new Date(message.createdAt * 1000) : undefined;
        const hasTime = timestamp && Number.isFinite(timestamp.getTime());
        return <article className={`message message-${message.role}${continuation ? " message-continuation" : ""}${toolsOnly ? " message-tools-only" : ""}${finalReply ? " message-final" : ""}${message.optimistic ? " optimistic" : ""}`} key={message.id}>
        {!continuation && <p className="message-role">{message.role === "assistant" ? "Hermes" : message.role === "user" ? "You" : "Notice"}{hasTime ? <time className="message-time" dateTime={timestamp.toISOString()}>{timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time> : null}</p>}
        <MessageContent text={message.text} />
        <div className="tool-records">{message.toolCalls.map((tool) => {
          const presentation = toolPresentation(tool.name);
          return <section className="tool-record" key={tool.id} aria-label={tool.label}>
            <div className="tool-line"><span className="tool-icon" aria-hidden="true">{tool.icon ?? presentation.icon}</span><span className="tool-label" title={`${tool.label}${!presentation.command && tool.detail ? ` · ${tool.detail}` : ""}`}>{tool.caption ?? `${toolDisplayLabel(tool.name, tool.label)}${!presentation.command && tool.detail ? ` ${compactFileDetail(tool.name ?? '', tool.detail).replace(/\s+/g, " ")}` : ""}`}</span></div>
            {presentation.command && tool.detail ? <pre className="tool-command">{tool.detail}</pre> : null}
          </section>;
        })}</div>
        {message.attachments.map((attachment) => <div className="attachment-row" key={attachment.id}><span>{attachment.name}</span><span>{attachment.size ? `${Math.ceil(attachment.size / 1024)} KB` : attachment.state}</span>{attachment.state === "available" ? <><button type="button" onClick={() => safely(window.hermesDesktop.downloadAttachment(attachment.id, "open"))}>Open</button><button type="button" onClick={() => safely(window.hermesDesktop.downloadAttachment(attachment.id, "save"))}>Save</button></> : null}</div>)}
        {message.receiptState ? <div className={`receipt receipt-${message.receiptState}`}>{message.processing === "running" ? "Running" : message.receiptState}{message.feedback ? ` · ${message.feedback}` : ""}{message.clientMessageId && ["failed", "interrupted", "unknown"].includes(message.receiptState) ? <button type="button" onClick={() => safely(window.hermesDesktop.retryMessage(message.clientMessageId!))}>Retry safely</button> : null}{message.receiptId && message.receiptState === "queued" ? <button type="button" onClick={() => safely(window.hermesDesktop.cancelQueued(message.receiptId!))}>Cancel</button> : null}</div> : null}
      </article>; }) : <div className="conversation-empty"><div className="empty-mark" aria-hidden="true">H</div><h3>No messages yet</h3><p>This conversation is ready when you are.</p></div>}
    </div>
    {!following && newCount > 0 ? <button className="new-messages" type="button" onClick={latest}>{newCount} new {newCount === 1 ? "message" : "messages"} · Back to latest</button> : null}
  </div>;
};

const Composer = ({ snapshot }: { snapshot: DesktopSnapshot }) => {
  const threadId = snapshot.selectedThreadId;
  const [text, setText] = useState(threadId ? drafts.get(threadId) ?? "" : "");
  const [attachments, setAttachments] = useState<readonly DesktopAttachment[]>(threadId ? draftAttachments.get(threadId) ?? [] : []);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setText(threadId ? drafts.get(threadId) ?? "" : ""); setAttachments(threadId ? draftAttachments.get(threadId) ?? [] : []); }, [threadId]);
  const update = (value: string) => { setText(value); if (threadId) drafts.set(threadId, value); };
  const submit = async () => {
    if (!threadId || busy || (!text.trim() && !attachments.length)) return;
    setBusy(true);
    try {
      await window.hermesDesktop.sendMessage({ text, attachmentIds: attachments.map(({ id }) => id) });
      drafts.delete(threadId); draftAttachments.delete(threadId); setText(""); setAttachments([]);
    } catch { /* snapshot carries the safe error; retain draft */ }
    finally { setBusy(false); }
  };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); safely(submit()); }
  };
  const attach = async () => {
    setBusy(true);
    try { const items = await window.hermesDesktop.pickAndUploadAttachments(); rememberAttachments(items); }
    finally { setBusy(false); }
  };
  const rememberAttachments = (items: readonly DesktopAttachment[]) => {
    const next = [...attachments, ...items].slice(0, 8);
    setAttachments(next);
    if (threadId) draftAttachments.set(threadId, next);
  };
  const drop = async (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    if (!threadId || busy || !event.dataTransfer.files.length) return;
    setBusy(true);
    try { rememberAttachments(await window.hermesDesktop.uploadDroppedFiles([...event.dataTransfer.files])); }
    finally { setBusy(false); }
  };
  const remove = (attachment: DesktopAttachment) => {
    const next = attachments.filter(({ id }) => id !== attachment.id); setAttachments(next); if (threadId) draftAttachments.set(threadId, next); safely(window.hermesDesktop.deleteUnattachedAttachment(attachment.id));
  };
  const running = snapshot.threads.find(({ id }) => id === threadId)?.running ?? false;
  return <footer className="composer" aria-label="Message composer" onDragOver={(event) => event.preventDefault()} onDrop={(event) => safely(drop(event))}>
    {attachments.length ? <div className="composer-attachments">{attachments.map((item) => <span key={item.id}>{item.name}<button type="button" aria-label={`Remove ${item.name}`} onClick={() => remove(item)}>×</button></span>)}</div> : null}
    <div className="composer-row"><button type="button" className="attach-button" onClick={() => safely(attach())} disabled={!threadId || busy} aria-label="Attach files">＋</button><textarea aria-label="Message" placeholder={threadId ? "Message Hermes" : "Choose a thread to write a message"} disabled={!threadId || busy} value={text} onChange={(event) => update(event.target.value)} onKeyDown={keyDown} />{running ? <button type="button" className="stop-button" onClick={() => safely(window.hermesDesktop.stopThread())}>Stop</button> : null}<button type="button" onClick={() => safely(submit())} disabled={!threadId || busy || (!text.trim() && !attachments.length)}>Send</button></div>
  </footer>;
};

export const DesktopShellView = ({ snapshot }: { snapshot: DesktopSnapshot }) => {
  const [editor, setEditor] = useState<Editor>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const channel = snapshot.channels.find(({ id }) => id === snapshot.selectedChannelId);
  useEffect(() => {
    const shortcut = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { setEditor(null); return; }
      if (!event.metaKey) return;
      if (event.key.toLocaleLowerCase() === "b") { event.preventDefault(); setPanelOpen((open) => !open); }
      if (event.key.toLocaleLowerCase() === "k") { event.preventDefault(); setEditor("palette"); }
      if (event.key.toLocaleLowerCase() === "n" && snapshot.selectedChannelId) { event.preventDefault(); setEditor("new-thread"); }
    };
    window.addEventListener("keydown", shortcut); return () => window.removeEventListener("keydown", shortcut);
  }, [snapshot.selectedChannelId]);
  if (snapshot.phase === "restoring") return <main className="loading-screen" role="status" aria-live="polite" aria-busy="true">Loading your conversations…</main>;
  if (snapshot.phase === "unpaired" || snapshot.phase === "pairing") return <main className="connection-screen"><PairingPanel busy={snapshot.phase === "pairing"} /><aside className="connection-notice" aria-live="polite">{snapshot.errorMessage ?? snapshot.statusMessage}</aside></main>;
  const forget = () => { if (window.confirm("Forget this connection and remove its local drafts and queued messages?")) { drafts.clear(); draftAttachments.clear(); safely(window.hermesDesktop.forgetConnection()); } };
  const deleteChannel = () => { if (channel && window.confirm(`Delete “${channel.name}”? This cannot be undone.`)) safely(window.hermesDesktop.deleteChannel(channel.id)); };
  const archive = () => { if (snapshot.selectedThreadId && window.confirm("Archive this topic?")) safely(window.hermesDesktop.archiveThread(snapshot.selectedThreadId)); };
  return <main className={`desktop-shell${panelOpen ? "" : " panel-collapsed"}`} aria-label="Hermes desktop">
    <nav className="activity-bar" aria-label="Navigation tools">
      <button type="button" title="Toggle navigation (⌘B)" aria-label="Toggle navigation" aria-expanded={panelOpen} aria-controls="navigation-panel" onClick={() => setPanelOpen((open) => !open)}>☰</button>
      <button type="button" title="Switch thread (⌘K)" aria-label="Switch thread" onClick={() => setEditor("palette")}>⌕</button>
      <button type="button" title="New topic (⌘N)" aria-label="Create a topic" disabled={!channel} onClick={() => setEditor("new-thread")}>＋</button>
    </nav>
    <nav id="navigation-panel" className="pane navigation-panel" hidden={!panelOpen} aria-labelledby="navigation-heading">
      <header className="pane-header"><h1 id="navigation-heading">Conversations</h1><button type="button" aria-label="Create a channel" onClick={() => setEditor("new-channel")}>+</button><button type="button" aria-label="Collapse navigation" onClick={() => setPanelOpen(false)}>‹</button></header>
      <NavigationPanel snapshot={snapshot} />
      <footer className="sidebar-footer">{channel ? <div className="resource-actions"><button type="button" onClick={() => setEditor("edit-channel")}>Edit channel</button><button type="button" onClick={deleteChannel}>Delete channel</button></div> : null}<button type="button" className="text-button" onClick={forget}>Forget connection</button></footer>
    </nav>
    <section className="pane conversation-pane" aria-labelledby="conversation-heading"><header className="conversation-header"><div><p className="eyebrow">{channel?.name ?? "Conversation"}</p><h2 id="conversation-heading"><button type="button" className="thread-switcher" title="Switch thread (⌘K)" onClick={() => setEditor("palette")}>{snapshot.selectedThreadTitle ?? "Choose a thread"} ▾</button></h2></div><div className="conversation-actions">{snapshot.selectedThreadId ? <><button type="button" onClick={() => setEditor("rename-thread")}>Rename</button><button type="button" onClick={archive}>Archive</button></> : null}</div></header>
      {snapshot.errorMessage ? <div className="error-banner" role="alert">{snapshot.errorMessage}</div> : null}
      {snapshot.selectedThreadId ? <Timeline snapshot={snapshot} /> : snapshot.loadingConversations && !snapshot.errorMessage ? <div className="conversation-empty" role="status" aria-live="polite" aria-busy="true"><div className="empty-mark" aria-hidden="true">H</div><h3>Loading your conversations…</h3><p>Please wait.</p></div> : <div className="conversation-empty"><div className="empty-mark" aria-hidden="true">H</div><h3>Your conversations will appear here</h3><p>Choose a thread to read its messages.</p></div>}
      {snapshot.interactions.map((item) => <section className="interaction-card" key={item.id}><strong>{item.kind === "approval" ? "Approval requested" : "Hermes needs clarification"}</strong><p>{item.prompt}</p><div>{item.choices.map((choice) => <button type="button" key={choice} onClick={() => safely(window.hermesDesktop.answerInteraction(item.id, choice))}>{choice}</button>)}</div></section>)}
      <Composer snapshot={snapshot} />
    </section>
    {editor ? <EditorDialog key={`${editor}:${snapshot.selectedChannelId}:${snapshot.selectedThreadId}`} kind={editor} snapshot={snapshot} close={() => setEditor(null)} /> : null}
  </main>;
};

export const DesktopShell = () => <DesktopShellView snapshot={useDesktopSnapshot()} />;
