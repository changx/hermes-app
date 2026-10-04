import { AttachmentView } from "./attachment-view";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from "react";
import { LocalDraftMap } from "../../../../packages/client/src/localDraftMap";
import { useDesktopSnapshot } from "./desktop-store";
import { MessageContent } from "./message-content";
import { workGroups, workIsExpanded, type WorkChoice, type WorkGroup } from "../../../../packages/client/src/workPresentation";
import { compactToolCaption, toolPresentation } from "../../../../packages/client/src/toolPresentation";
import { orderedThreads } from "./thread-navigation";
import { NavigationPanel } from "./navigation-panel";
import { NewSessionDialog } from "./new-session-dialog";
import type { DesktopAttachment, DesktopMessage, DesktopSnapshot } from "../shared/desktop-api";

const drafts = new LocalDraftMap<string>(value => !!value.trim());
const draftAttachments = new LocalDraftMap<readonly DesktopAttachment[]>(value => value.length > 0);
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
const EditorDialog = ({ kind, snapshot, close }: { kind: Exclude<Editor, null | "new-thread">; snapshot: DesktopSnapshot; close: () => void }) => {
  const channel = snapshot.channels.find(({ id }) => id === snapshot.selectedChannelId);
  const [name, setName] = useState(kind === "edit-channel" ? channel?.name ?? "" : "");
  const [description, setDescription] = useState(kind === "edit-channel" ? channel?.description ?? "" : "");
  const [query, setQuery] = useState("");
  const [detailsReady, setDetailsReady] = useState(kind !== "edit-channel");
  const [detailError, setDetailError] = useState("");
  useEffect(() => {
    if (kind !== "edit-channel" || !channel) return;
    let active = true;
    void window.hermesDesktop.getChannelInfo(channel.id).then(value => { if (active) { setName(value.name); setDescription(value.description ?? ""); setDetailsReady(true); } }, () => { if (active) setDetailError("Channel details could not be loaded. Close this form and open it again."); });
    return () => { active = false; };
  }, [kind, channel?.id]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!detailsReady) return;
    let task: Promise<void>;
    if (kind === "new-channel") task = window.hermesDesktop.createChannel({ name, description });
    else if (kind === "edit-channel" && channel) task = window.hermesDesktop.updateChannel(channel.id, { name, description });
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
  const title = kind === "new-channel" ? "New channel" : kind === "edit-channel" ? "Edit channel" : "Rename topic";
  return <div className="modal-backdrop" role="presentation" onMouseDown={close}><form className="editor-dialog" role="dialog" aria-modal="true" aria-label={title} onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
    <h2>{title}</h2>{detailError ? <p role="alert">{detailError}</p> : null}<label>{channelEditor ? "Name" : "Title"}<input autoFocus required disabled={!detailsReady} maxLength={channelEditor ? 120 : 200} value={name} onChange={(event) => setName(event.target.value)} /></label>
    {channelEditor ? <label>Description<textarea disabled={!detailsReady} maxLength={4000} value={description} onChange={(event) => setDescription(event.target.value)} /></label> : null}
    <div className="dialog-actions"><button type="button" className="secondary" onClick={close}>Cancel</button><button type="submit" disabled={!detailsReady}>Save</button></div>
  </form></div>;
};

const MessageRow = memo(({ message, continuation, hidden = false }: { message: DesktopMessage; continuation: boolean; hidden?: boolean }) => {
  const finalReply = message.role === "assistant" && message.displayKind === "final";
  const toolsOnly = message.role === "assistant" && !message.text.trim() && message.toolCalls.length > 0;
  const timestamp = message.createdAt !== undefined ? new Date(message.createdAt * 1000) : undefined;
  const hasTime = timestamp && Number.isFinite(timestamp.getTime());
  const two = (value: number) => String(value).padStart(2, "0");
  const timeLabel = hasTime && (message.role === "user"
    ? `${timestamp.getFullYear()}-${two(timestamp.getMonth() + 1)}-${two(timestamp.getDate())} ${two(timestamp.getHours())}:${two(timestamp.getMinutes())}`
    : timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  return <article hidden={hidden} data-result-ref={message.refSeq} className={`message message-${message.role}${continuation ? " message-continuation" : ""}${toolsOnly ? " message-tools-only" : ""}${finalReply ? " message-final" : ""}${message.optimistic ? " optimistic" : ""}`}>
    {message.role !== "assistant" && !continuation && hasTime && <p className="message-role"><time className="message-time" dateTime={timestamp.toISOString()}>{timeLabel}</time></p>}
    <MessageContent text={message.text} />
    <div className="tool-records">{message.toolCalls.map((tool) => {
      const presentation = toolPresentation(tool.name);
      return <section className="tool-record" key={tool.id} aria-label={tool.label}>
        <div className="tool-line"><span className="tool-icon" aria-hidden="true">{tool.icon ?? presentation.icon}</span><span className="tool-label" title={`${tool.label}${!presentation.command && tool.detail ? ` · ${tool.detail}` : ""}`}>{compactToolCaption(tool.name ?? '', tool.label, tool.detail, tool.caption)}</span></div>
        {presentation.command && tool.detail ? <pre className="tool-command">{tool.detail}</pre> : null}
      </section>;
    })}</div>
    {message.attachments.map((attachment) => <AttachmentView key={attachment.id} attachment={attachment} />)}
    {message.receiptState ? <div className={`receipt receipt-${message.receiptState}`}>{message.processing === "running" ? "Running" : message.receiptState}{message.feedback ? ` · ${message.feedback}` : ""}{message.clientMessageId && ["failed", "interrupted", "unknown"].includes(message.receiptState) ? <button type="button" onClick={() => safely(window.hermesDesktop.retryMessage(message.clientMessageId!))}>Retry safely</button> : null}{message.receiptId && message.receiptState === "queued" ? <button type="button" onClick={() => safely(window.hermesDesktop.cancelQueued(message.receiptId!))}>Cancel</button> : null}</div> : null}
  </article>;
});

const Timeline = memo(({ snapshot, active = true }: { snapshot: DesktopSnapshot; active?: boolean }) => {
  const [workChoices, setWorkChoices] = useState<Record<string, WorkChoice>>({});
  const groups = workGroups(snapshot.messages.map(message => ({ key: message.id, role: message.role, kind: message.displayKind, seconds: message.createdAt })), !!snapshot.threads.find(thread => thread.id === snapshot.selectedThreadId)?.running);
  const choiceKey = (group: WorkGroup) => `${snapshot.selectedThreadId}:${group.key}`;
  const list = useRef<HTMLDivElement>(null);
  const previous = useRef({ threadId: "", first: "", height: 0, count: 0 });
  const [following, setFollowing] = useState(true);
  const [newCount, setNewCount] = useState(0);
  const first = snapshot.messages[0]?.id ?? "";
  const result = snapshot.threads.find(t => t.id === snapshot.selectedThreadId);
  useEffect(() => {
    const root = list.current, id = snapshot.selectedThreadId;
    if (!active || !root || !id || !result?.completedUnread || !result.resultVersion || !result.resultRef || snapshot.loadingMessages) return;
    const target = root.querySelector(`[data-result-ref="${result.resultRef}"]`);
    if (!target) return;
    const acknowledge = () => {
      if (document.visibilityState !== "visible" || !document.hasFocus()) return;
      const box = target.getBoundingClientRect(), viewport = root.getBoundingClientRect();
      if (box.bottom > viewport.top && box.top < viewport.bottom) void window.hermesDesktop.markResultRead(id, result.resultVersion!, result.resultRef!).catch(() => {});
    };
    const observer = new IntersectionObserver(acknowledge, { root });
    observer.observe(target); window.addEventListener("focus", acknowledge); document.addEventListener("visibilitychange", acknowledge);
    return () => { observer.disconnect(); window.removeEventListener("focus", acknowledge); document.removeEventListener("visibilitychange", acknowledge); };
  }, [active, result?.completedUnread, result?.resultVersion, result?.resultRef, snapshot.messages, snapshot.selectedThreadId, snapshot.loadingMessages, snapshot.connectionState]);
  useLayoutEffect(() => {
    const node = list.current;
    if (!active || !node) return;
    const old = previous.current;
    if (old.threadId !== snapshot.selectedThreadId) node.scrollTop = node.scrollHeight;
    else if (old.first && first !== old.first && old.count > 0) node.scrollTop += node.scrollHeight - old.height;
    else if (following) node.scrollTop = node.scrollHeight;
    else if (snapshot.messages.length > old.count) setNewCount((value) => value + snapshot.messages.length - old.count);
    previous.current = { threadId: snapshot.selectedThreadId ?? "", first, height: node.scrollHeight, count: snapshot.messages.length };
  }, [active, first, following, snapshot.messages, snapshot.selectedThreadId]);
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
        const group = groups.get(message.id);
        const expanded = group ? workIsExpanded(group, workChoices[choiceKey(group)]) : true;
        return <div className="timeline-entry" key={message.id}>
          {group?.key === message.id && <div className="work-heading"><button type="button" className="work-toggle" aria-expanded={expanded} onClick={() => setWorkChoices(old => ({ ...old, [choiceKey(group)]: { completion: group.completion, expanded: !expanded } }))}>{group.label}<span className="work-chevron" aria-hidden="true">{expanded ? '\ue001' : '\ue002'}</span></button></div>}
          <MessageRow message={message} continuation={continuation} hidden={!expanded} />
        </div>;
      }) : snapshot.loadingMessages && !snapshot.errorMessage ? <div className="conversation-empty" role="status" aria-busy="true"><h3>Loading messages…</h3></div> : <div className="conversation-empty"><div className="empty-mark" aria-hidden="true">H</div><h3>No messages yet</h3><p>This conversation is ready when you are.</p></div>}
    </div>
    {!following && newCount > 0 ? <button className="new-messages" type="button" onClick={latest}>{newCount} new {newCount === 1 ? "message" : "messages"} · Back to latest</button> : null}
  </div>;
}, (before,after) => before.active === after.active && before.snapshot.threads === after.snapshot.threads && before.snapshot.messages === after.snapshot.messages && before.snapshot.selectedThreadId === after.snapshot.selectedThreadId && before.snapshot.canLoadOlder === after.snapshot.canLoadOlder && before.snapshot.connectionState === after.snapshot.connectionState && before.snapshot.loadingMessages === after.snapshot.loadingMessages && before.snapshot.errorMessage === after.snapshot.errorMessage);

const Composer = ({ snapshot }: { snapshot: DesktopSnapshot }) => {
  const threadId = snapshot.selectedThreadId;
  const [text, setText] = useState(threadId ? drafts.get(threadId) ?? "" : "");
  const [attachments, setAttachments] = useState<readonly DesktopAttachment[]>(threadId ? draftAttachments.get(threadId) ?? [] : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const working = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useLayoutEffect(() => {
    if (!input.current) return;
    input.current.style.height = "0px";
    input.current.style.height = `${Math.min(120, Math.max(42, input.current.scrollHeight))}px`;
  }, [text]);
  const update = (value: string) => { setText(value); if (threadId) drafts.set(threadId, value); };
  const finish = () => { working.current = false; if (mounted.current) setBusy(false); };
  const submit = async () => {
    if (!threadId || working.current || (!text.trim() && !attachments.length)) return;
    working.current = true; setBusy(true); setError("");
    try {
      await window.hermesDesktop.sendMessage({ text, attachmentIds: attachments.map(({ id }) => id) });
      drafts.delete(threadId); draftAttachments.delete(threadId);
      if (mounted.current) { setText(""); setAttachments([]); }
    } catch { if (mounted.current) setError("Your message could not be saved. Your draft is still here."); }
    finally { finish(); }
  };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); safely(submit()); }
  };
  const rememberAttachments = (items: readonly DesktopAttachment[]) => {
    const next = [...attachments, ...items];
    // Keep selected uploads, never silently truncate files already uploaded.
    if (next.length > 8) {
      items.forEach(item => safely(window.hermesDesktop.deleteUnattachedAttachment(item.id)));
      if (mounted.current) setError("A message can include up to eight files."); return;
    }
    if (mounted.current) setAttachments(next);
    if (threadId) draftAttachments.set(threadId, next);
  };
  const attach = async (files?: readonly File[]) => {
    if (!threadId || working.current) return;
    working.current = true; setBusy(true); setError("");
    try { rememberAttachments(files ? await window.hermesDesktop.uploadDroppedFiles(files, threadId) : await window.hermesDesktop.pickAndUploadAttachments(threadId)); }
    catch { if (mounted.current) setError("The files could not be uploaded. Check their size and try again."); }
    finally { finish(); }
  };
  const remove = (attachment: DesktopAttachment) => {
    const next = attachments.filter(({ id }) => id !== attachment.id); setAttachments(next); if (threadId) draftAttachments.set(threadId, next); safely(window.hermesDesktop.deleteUnattachedAttachment(attachment.id));
  };
  const running = snapshot.threads.find(({ id }) => id === threadId)?.running ?? false;
  const online = snapshot.connectionState === "online";
  const active = online && snapshot.interactions.length === 0;
  return <footer className="composer" aria-label="Message composer" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (event.dataTransfer.files.length) safely(attach([...event.dataTransfer.files])); }}>
    {error && <p role="alert">{error}</p>}
    {attachments.length ? <div className="composer-attachments">{attachments.map(item => <span key={item.id}>{item.name}<button type="button" disabled={busy} aria-label={`Remove ${item.name}`} onClick={() => remove(item)}>×</button></span>)}</div> : null}
    {running ? <div className="running-row">
      <div className="agent-running" role="status" aria-live="polite">
        {active ? <span className="running-dots" aria-hidden="true"><span /><span /><span /></span> : null}
        <span>{!online ? "Reconnecting…" : active ? "Agent is running" : "Waiting for your response"}</span>
      </div>
      <button type="button" className="stop-button" aria-label="Stop agent" title="Stop agent" disabled={!online} onClick={() => safely(window.hermesDesktop.stopThread())}>■</button>
    </div> : null}
    <div className="composer-row"><button type="button" className="attach-button" onClick={() => safely(attach())} disabled={!threadId || busy || attachments.length >= 8} aria-label="Attach files" title="Attach files">＋</button><textarea ref={input} rows={1} aria-label="Message" placeholder={threadId ? "Message Hermes" : "Choose a thread to write a message"} disabled={!threadId || busy} value={text} onChange={event => update(event.target.value)} onKeyDown={keyDown} /><button type="button" className="send-button" aria-label="Send message" title="Send message" onClick={() => safely(submit())} disabled={!threadId || busy || (!text.trim() && !attachments.length)}>↑</button></div>
  </footer>;
};

export const DesktopShellView = ({ snapshot }: { snapshot: DesktopSnapshot }) => {
  const textVersion = useSyncExternalStore(drafts.subscribe, drafts.getSnapshot, drafts.getSnapshot);
  const attachmentVersion = useSyncExternalStore(draftAttachments.subscribe, draftAttachments.getSnapshot, draftAttachments.getSnapshot);
  const draftThreads = useMemo(() => new Set([...drafts.keys(), ...draftAttachments.keys()].filter(id => drafts.hasDraft(id) || draftAttachments.hasDraft(id))), [textVersion, attachmentVersion]);
  const [editor, setEditor] = useState<Editor>(null);
  const [newSessionChannel, setNewSessionChannel] = useState<string>();
  const [preparedDrafts, setPreparedDrafts] = useState<Record<string, number>>({});
  const openNewSession = useCallback((channelId?: string) => { setNewSessionChannel(channelId); setEditor("new-thread"); }, []);
  const [panelOpen, setPanelOpen] = useState(true);
  const channel = snapshot.channels.find(({ id }) => id === snapshot.selectedChannelId);
  useEffect(() => {
    const shortcut = (event: globalThis.KeyboardEvent) => {
      if (editor === "new-thread") return;
      if (event.key === "Escape") { setEditor(null); return; }
      if (!event.metaKey) return;
      if (event.key.toLocaleLowerCase() === "b") { event.preventDefault(); setPanelOpen((open) => !open); }
      if (event.key.toLocaleLowerCase() === "k") { event.preventDefault(); setEditor("palette"); }
      if (event.key.toLocaleLowerCase() === "n" && snapshot.channels.length) { event.preventDefault(); openNewSession(snapshot.selectedChannelId); }
    };
    window.addEventListener("keydown", shortcut); return () => window.removeEventListener("keydown", shortcut);
  }, [snapshot.selectedChannelId, snapshot.channels.length, editor]);
  if (snapshot.phase === "restoring") return <main className="loading-screen" role="status" aria-live="polite" aria-busy="true">Loading your conversations…</main>;
  if (snapshot.phase === "unpaired" || snapshot.phase === "pairing") return <main className="connection-screen"><PairingPanel busy={snapshot.phase === "pairing"} /><aside className="connection-notice" aria-live="polite">{snapshot.errorMessage ?? snapshot.statusMessage}</aside></main>;
  const forget = () => { if (window.confirm("Forget this connection and remove its local drafts and queued messages?")) { drafts.clear(); draftAttachments.clear(); safely(window.hermesDesktop.forgetConnection()); } };
  const deleteChannel = () => { if (channel && window.confirm(`Delete “${channel.name}”? This cannot be undone.`)) safely(window.hermesDesktop.deleteChannel(channel.id)); };
  const archive = () => { if (snapshot.selectedThreadId && window.confirm("Archive this topic?")) safely(window.hermesDesktop.archiveThread(snapshot.selectedThreadId)); };
  return <main className={`desktop-shell${panelOpen ? "" : " panel-collapsed"}`} aria-label="Hermes desktop">
    <nav className="activity-bar" aria-label="Navigation tools">
      <button type="button" title="Toggle navigation (⌘B)" aria-label="Toggle navigation" aria-expanded={panelOpen} aria-controls="navigation-panel" onClick={() => setPanelOpen((open) => !open)}>☰</button>
      <button type="button" title="Switch thread (⌘K)" aria-label="Switch thread" onClick={() => setEditor("palette")}>⌕</button>
      <button type="button" title="New session (⌘N)" aria-label="Create a session" disabled={!snapshot.channels.length} onClick={() => openNewSession(snapshot.selectedChannelId)}>＋</button>
    </nav>
    <nav id="navigation-panel" className="pane navigation-panel" hidden={!panelOpen} aria-labelledby="navigation-heading">
      <header className="pane-header"><h1 id="navigation-heading">Channels</h1><button type="button" aria-label="Create a channel" onClick={() => setEditor("new-channel")}>+</button><button type="button" aria-label="Collapse navigation" onClick={() => setPanelOpen(false)}>‹</button></header>
      <NavigationPanel snapshot={snapshot} onNewSession={openNewSession} draftThreads={draftThreads} />
      <footer className="sidebar-footer">{channel ? <div className="resource-actions"><button type="button" onClick={() => setEditor("edit-channel")}>Edit channel</button><button type="button" onClick={deleteChannel}>Delete channel</button></div> : null}<button type="button" className="text-button" onClick={forget}>Forget connection</button></footer>
    </nav>
    <section className="pane conversation-pane" aria-labelledby="conversation-heading"><header className="conversation-header"><div><p className="eyebrow">{channel?.name ?? "Conversation"}</p><h2 id="conversation-heading"><button type="button" className="thread-switcher" title="Switch thread (⌘K)" onClick={() => setEditor("palette")}>{snapshot.selectedThreadTitle ?? "Choose a thread"} ▾</button></h2></div><div className="conversation-actions">{snapshot.selectedThreadId ? <><button type="button" onClick={() => safely(window.hermesDesktop.copySessionLink())}>Copy session link</button><button type="button" onClick={() => setEditor("rename-thread")}>Rename</button><button type="button" onClick={archive}>Archive</button></> : null}</div></header>
      {snapshot.errorMessage ? <div className="error-banner" role="alert">{snapshot.errorMessage}</div> : null}
      {(snapshot.sessionPages ?? (snapshot.selectedThreadId ? [{ id: snapshot.selectedThreadId, messages: snapshot.messages, interactions: snapshot.interactions, loadingMessages: snapshot.loadingMessages, canLoadOlder: snapshot.canLoadOlder, selectedThreadTitle: snapshot.selectedThreadTitle }] : [])).map(page => {
        const active = page.id === snapshot.selectedThreadId;
        const pageSnapshot = { ...snapshot, ...page, selectedThreadId: page.id };
        return <div key={page.id} className="session-page" data-session-page={page.id} hidden={!active} style={{ display: active ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
          <Timeline snapshot={pageSnapshot} active={active} />
          {page.interactions.map(item => <section className="interaction-card" key={item.id}><strong>{item.kind === 'approval' ? 'Approval requested' : 'Hermes needs clarification'}</strong><p>{item.prompt}</p><div>{item.choices.map(choice => <button type="button" key={choice} onClick={() => safely(window.hermesDesktop.answerInteraction(item.id, choice))}>{choice}</button>)}</div></section>)}
          <Composer key={preparedDrafts[page.id] ?? 0} snapshot={pageSnapshot} />
        </div>;
      })}
      {!snapshot.selectedThreadId && (snapshot.loadingConversations && !snapshot.errorMessage ? <div className="conversation-empty" role="status" aria-live="polite" aria-busy="true"><div className="empty-mark" aria-hidden="true">H</div><h3>Loading your conversations…</h3><p>Please wait.</p></div> : <div className="conversation-empty"><div className="empty-mark" aria-hidden="true">H</div><h3>Your conversations will appear here</h3><p>Choose a thread to read its messages.</p></div>)}
      {!snapshot.selectedThreadId && <Composer snapshot={snapshot} />}
    </section>
    {editor === "new-thread" ? <NewSessionDialog snapshot={snapshot} initialChannelId={newSessionChannel} close={() => setEditor(null)} prepared={(threadId, attachments) => { draftAttachments.set(threadId, attachments); setPreparedDrafts(value => ({ ...value, [threadId]: (value[threadId] ?? 0) + 1 })); }} /> : editor ? <EditorDialog key={`${editor}:${snapshot.selectedChannelId}:${snapshot.selectedThreadId}`} kind={editor} snapshot={snapshot} close={() => setEditor(null)} /> : null}
  </main>;
};

export const DesktopShell = () => <DesktopShellView snapshot={useDesktopSnapshot()} />;
