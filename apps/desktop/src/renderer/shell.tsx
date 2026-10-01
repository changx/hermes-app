import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useDesktopSnapshot } from "./desktop-store";
import { MessageContent } from "./message-content";
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
    const rows = snapshot.threads.filter(({ title }) => title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    return <div className="modal-backdrop" role="presentation" onMouseDown={close}><section className="editor-dialog palette" role="dialog" aria-modal="true" aria-label="Switch thread" onMouseDown={(event) => event.stopPropagation()}>
      <input autoFocus aria-label="Find a thread" placeholder="Switch to a thread…" value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="palette-results">{rows.map((thread) => <button key={thread.id} type="button" onClick={() => { safely(window.hermesDesktop.selectThread(thread.id)); close(); }}>{thread.title}</button>)}</div>
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
  useEffect(() => {
    const mark = () => {
      if (!following || document.visibilityState !== "visible") return;
      for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
        const ref = snapshot.messages[index].refSeq;
        if (ref) { safely(window.hermesDesktop.markVisible(ref)); break; }
      }
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [following, snapshot.messages, snapshot.selectedThreadId]);
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
      {snapshot.messages.length ? snapshot.messages.map((message) => <article className={`message message-${message.role}${message.optimistic ? " optimistic" : ""}`} key={message.id}>
        <p className="message-role">{message.role === "assistant" ? "Hermes" : message.role === "user" ? "You" : "Notice"}</p>
        <MessageContent text={message.text} />
        {message.toolCalls.map((tool) => <details className="tool-record" key={tool.id}><summary>{tool.label}</summary>{tool.detail ? <pre>{tool.detail}</pre> : null}</details>)}
        {message.attachments.map((attachment) => <div className="attachment-row" key={attachment.id}><span>{attachment.name}</span><span>{attachment.size ? `${Math.ceil(attachment.size / 1024)} KB` : attachment.state}</span>{attachment.state === "available" ? <><button type="button" onClick={() => safely(window.hermesDesktop.downloadAttachment(attachment.id, "open"))}>Open</button><button type="button" onClick={() => safely(window.hermesDesktop.downloadAttachment(attachment.id, "save"))}>Save</button></> : null}</div>)}
        {message.receiptState ? <div className={`receipt receipt-${message.receiptState}`}>{message.processing === "running" ? "Running" : message.receiptState}{message.feedback ? ` · ${message.feedback}` : ""}{message.clientMessageId && ["failed", "interrupted", "unknown"].includes(message.receiptState) ? <button type="button" onClick={() => safely(window.hermesDesktop.retryMessage(message.clientMessageId!))}>Retry safely</button> : null}{message.receiptId && message.receiptState === "queued" ? <button type="button" onClick={() => safely(window.hermesDesktop.cancelQueued(message.receiptId!))}>Cancel</button> : null}</div> : null}
      </article>) : <div className="conversation-empty"><div className="empty-mark" aria-hidden="true">H</div><h3>No messages yet</h3><p>This conversation is ready when you are.</p></div>}
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
  const channel = snapshot.channels.find(({ id }) => id === snapshot.selectedChannelId);
  useEffect(() => {
    const shortcut = (event: globalThis.KeyboardEvent) => {
      if (!event.metaKey) return;
      if (event.key.toLocaleLowerCase() === "k") { event.preventDefault(); setEditor("palette"); }
      if (event.key.toLocaleLowerCase() === "n" && snapshot.selectedChannelId) { event.preventDefault(); setEditor("new-thread"); }
    };
    window.addEventListener("keydown", shortcut); return () => window.removeEventListener("keydown", shortcut);
  }, [snapshot.selectedChannelId]);
  if (snapshot.phase === "restoring") return <main className="loading-screen" role="status">Opening Hermes…</main>;
  if (snapshot.phase === "unpaired" || snapshot.phase === "pairing") return <main className="connection-screen"><PairingPanel busy={snapshot.phase === "pairing"} /><aside className="connection-notice" aria-live="polite">{snapshot.errorMessage ?? snapshot.statusMessage}</aside></main>;
  const forget = () => { if (window.confirm("Forget this connection and remove its local drafts and queued messages?")) { drafts.clear(); draftAttachments.clear(); safely(window.hermesDesktop.forgetConnection()); } };
  const deleteChannel = () => { if (channel && window.confirm(`Delete “${channel.name}”? This cannot be undone.`)) safely(window.hermesDesktop.deleteChannel(channel.id)); };
  const archive = () => { if (snapshot.selectedThreadId && window.confirm("Archive this topic?")) safely(window.hermesDesktop.archiveThread(snapshot.selectedThreadId)); };
  return <main className="desktop-shell" aria-label="Hermes desktop">
    <nav className="pane channels-pane" aria-labelledby="channels-heading"><header className="pane-header"><div><p className="eyebrow">Hermes</p><h1 id="channels-heading">Channels</h1></div><button type="button" aria-label="Create a channel" onClick={() => setEditor("new-channel")}>+</button></header>
      <div className="item-list">{snapshot.channels.length ? snapshot.channels.map((item) => <button type="button" className={item.id === snapshot.selectedChannelId ? "list-item selected" : "list-item"} key={item.id} onClick={() => safely(window.hermesDesktop.selectChannel(item.id))}><strong>{item.name}</strong></button>) : <EmptyState>{snapshot.connectionState === "online" ? "No channels yet." : "Channels will appear when Hermes connects."}</EmptyState>}</div>
      <footer className="sidebar-footer"><button type="button" className="text-button" onClick={forget}>Forget connection</button></footer></nav>
    <nav className="pane threads-pane" aria-labelledby="threads-heading"><header className="pane-header"><div><h2 id="threads-heading">Threads</h2>{channel?.description ? <p className="channel-description" title={channel.description}>{channel.description}</p> : null}</div><div className="header-actions">{channel ? <button type="button" aria-label="Edit channel" onClick={() => setEditor("edit-channel")}>⋯</button> : null}<button type="button" aria-label="Create a topic" onClick={() => setEditor("new-thread")} disabled={!channel}>+</button></div></header>
      {channel ? <div className="resource-actions"><button type="button" onClick={deleteChannel}>Delete channel</button></div> : null}
      <div className="item-list">{snapshot.selectedChannelId ? snapshot.threads.length ? snapshot.threads.map((thread) => <button type="button" className={thread.id === snapshot.selectedThreadId ? "list-item thread-item selected" : "list-item thread-item"} key={thread.id} onClick={() => safely(window.hermesDesktop.selectThread(thread.id))}><strong>{thread.title}</strong><span>{thread.running ? "Running" : thread.unreadCount ? `${thread.unreadCount} unread` : ""}</span></button>) : <EmptyState>No threads in this channel.</EmptyState> : <EmptyState>Choose a channel to see its threads.</EmptyState>}</div></nav>
    <section className="pane conversation-pane" aria-labelledby="conversation-heading"><header className="conversation-header"><div><p className="eyebrow">Conversation</p><h2 id="conversation-heading">{snapshot.selectedThreadTitle ?? "Choose a thread"}</h2></div><div className="conversation-actions">{snapshot.selectedThreadId ? <><button type="button" onClick={() => setEditor("rename-thread")}>Rename</button><button type="button" onClick={archive}>Archive</button></> : null}</div></header>
      {snapshot.errorMessage ? <div className="error-banner" role="alert">{snapshot.errorMessage}</div> : null}
      {snapshot.selectedThreadId ? <Timeline snapshot={snapshot} /> : <div className="conversation-empty"><div className="empty-mark" aria-hidden="true">H</div><h3>Your conversations will appear here</h3><p>Choose a thread to read its messages.</p></div>}
      {snapshot.interactions.map((item) => <section className="interaction-card" key={item.id}><strong>{item.kind === "approval" ? "Approval requested" : "Hermes needs clarification"}</strong><p>{item.prompt}</p><div>{item.choices.map((choice) => <button type="button" key={choice} onClick={() => safely(window.hermesDesktop.answerInteraction(item.id, choice))}>{choice}</button>)}</div></section>)}
      <Composer snapshot={snapshot} />
    </section>
    {editor ? <EditorDialog key={`${editor}:${snapshot.selectedChannelId}:${snapshot.selectedThreadId}`} kind={editor} snapshot={snapshot} close={() => setEditor(null)} /> : null}
  </main>;
};

export const DesktopShell = () => <DesktopShellView snapshot={useDesktopSnapshot()} />;
