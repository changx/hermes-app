import { AttachmentView } from "./attachment-view";
import { FontSettingsButton } from './font-settings';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from "react";
import { LocalDraftMap } from "../../../../packages/client/src/localDraftMap";
import { useDesktopSnapshot } from "./desktop-store";
import { MessageContent } from "./message-content";
import { workGroups, workIsExpanded, type WorkChoice, type WorkGroup } from "../../../../packages/client/src/workPresentation";
import { compactToolCaption, toolPresentation } from "../../../../packages/client/src/toolPresentation";
import { SessionPicker } from './session-picker';
import { NativeWorkspace } from './native-workspace';
import { NewSessionPage } from './new-session-page';
import { LabelPills, LabelsEditor } from './session-labels';
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

type Editor = "new-channel" | "edit-channel" | "rename-thread" | "palette" | null;
const EditorDialog = ({ kind, snapshot, close }: { kind: Exclude<Editor, null | "new-thread">; snapshot: DesktopSnapshot; close: () => void }) => {
  const channel = snapshot.channels.find(({ id }) => id === snapshot.selectedChannelId);
  const [name, setName] = useState(kind === "edit-channel" ? channel?.name ?? "" : "");
  const [description, setDescription] = useState(kind === "edit-channel" ? channel?.description ?? "" : "");

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
  if (kind === "palette") return <SessionPicker snapshot={snapshot} close={close} />;
  const channelEditor = kind === "new-channel" || kind === "edit-channel";
  const title = kind === "new-channel" ? "New channel" : kind === "edit-channel" ? "Edit channel" : "Rename topic";
  return <div className="modal-backdrop" role="presentation" onMouseDown={close}><form className="editor-dialog" role="dialog" aria-modal="true" aria-label={title} onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
    <h2>{title}</h2>{detailError ? <p role="alert">{detailError}</p> : null}<label>{channelEditor ? "Name" : "Title"}<input autoFocus required disabled={!detailsReady} maxLength={channelEditor ? 120 : 200} value={name} onChange={(event) => setName(event.target.value)} /></label>
    {channelEditor ? <label>Description<textarea disabled={!detailsReady} maxLength={4000} value={description} onChange={(event) => setDescription(event.target.value)} /></label> : null}
    <div className="dialog-actions"><button type="button" className="secondary" onClick={close}>Cancel</button><button type="submit" disabled={!detailsReady}>Save</button></div>
  </form></div>;
};

const MessageRow = memo(({ message, continuation, hidden = false }: { message: DesktopMessage; continuation: boolean; hidden?: boolean }) => {
  const revealed = useRef(false);
  if (!hidden) revealed.current = true;
  // A never-opened process does not parse Markdown or initialize attachments.
  // After first reveal, folding preserves its mounted content and interaction state.
  if (!revealed.current) return null;
  const finalReply = message.role === "assistant" && message.displayKind === "final";
  const toolsOnly = message.role === "assistant" && !message.text.trim() && message.toolCalls.length > 0;
  const timestamp = message.createdAt !== undefined ? new Date(message.createdAt * 1000) : undefined;
  const hasTime = timestamp && Number.isFinite(timestamp.getTime());
  const two = (value: number) => String(value).padStart(2, "0");
  const timeLabel = hasTime && (message.role === "user"
    ? `${timestamp.getFullYear() === new Date().getFullYear() ? "" : `${timestamp.getFullYear()}-`}${two(timestamp.getMonth() + 1)}-${two(timestamp.getDate())} ${two(timestamp.getHours())}:${two(timestamp.getMinutes())}`
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
      {snapshot.canLoadOlder || snapshot.loadingHistory ? <div className="history-loading-slot">
        {snapshot.loadingHistory ? <div className="history-loading-status" role="status" aria-live="polite" aria-busy="true"><span className="conversation-loading-spinner" aria-hidden="true" />Loading messages…</div> : <button className="load-older" type="button" onClick={() => safely(window.hermesDesktop.loadOlder())}>Load all earlier messages</button>}
      </div> : null}
      {snapshot.loadingMessages && !snapshot.errorMessage ? <div className="conversation-empty" role="status" aria-live="polite" aria-busy="true"><span className="conversation-loading-spinner" aria-hidden="true" /><h3>Loading messages…</h3></div> : snapshot.messages.length ? snapshot.messages.map((message, index) => {
        const previous = snapshot.messages[index - 1];
        const continuation = message.role === "assistant" && previous?.role === "assistant" && !message.displayKind && !previous.displayKind;
        const group = groups.get(message.id);
        const expanded = group ? workIsExpanded(group, workChoices[choiceKey(group)]) : true;
        return <div className="timeline-entry" key={message.id}>
          {group?.key === message.id && <div className="work-heading"><button type="button" className="work-toggle" aria-expanded={expanded} onClick={() => setWorkChoices(old => ({ ...old, [choiceKey(group)]: { completion: group.completion, expanded: !expanded } }))}>{group.label}<span className="work-chevron" aria-hidden="true">{expanded ? '\ue001' : '\ue002'}</span></button></div>}
          <MessageRow message={message} continuation={continuation} hidden={!expanded} />
        </div>;
      }) : !snapshot.errorMessage ? <div className="conversation-empty"><div className="empty-mark" aria-hidden="true">H</div><h3>No messages yet</h3><p>This conversation is ready when you are.</p></div> : null}
    </div>
    {!following && newCount > 0 ? <button className="new-messages" type="button" onClick={latest}>{newCount} new {newCount === 1 ? "message" : "messages"} · Back to latest</button> : null}
  </div>;
}, (before,after) => before.active === after.active && before.snapshot.threads === after.snapshot.threads && before.snapshot.messages === after.snapshot.messages && before.snapshot.selectedThreadId === after.snapshot.selectedThreadId && before.snapshot.canLoadOlder === after.snapshot.canLoadOlder && before.snapshot.connectionState === after.snapshot.connectionState && before.snapshot.loadingMessages === after.snapshot.loadingMessages && before.snapshot.loadingHistory === after.snapshot.loadingHistory && before.snapshot.errorMessage === after.snapshot.errorMessage);

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

export const DesktopShellView = ({ snapshot, viewRole = typeof window !== 'undefined' ? window.hermesDesktop?.getRuntimeInfo?.()?.viewRole ?? 'tab' : 'tab' }: { snapshot: DesktopSnapshot; viewRole?: 'workspace' | 'tab' }) => {
  const [draftReady, setDraftReady] = useState<string | undefined>();
  const [draftError, setDraftError] = useState('');
  const [draftRetry, setDraftRetry] = useState(0);
  useEffect(() => {
    const identity = snapshot.draftIdentity;
    if (!identity) return;
    let active = true;
    let stopText: (() => void) | undefined, stopAttachments: (() => void) | undefined;
    setDraftReady(undefined);
    setDraftError('');
    void window.hermesDesktop.loadLocalDrafts(identity).then(saved => {
      if (!active) return;
      drafts.clear(); draftAttachments.clear();
      for (const [id, draft] of Object.entries(saved)) { drafts.set(id, draft.text); draftAttachments.set(id, draft.attachments); }
      const persist = (id?: string) => {
        if (!id) return; // Forget is cleared durably by the main process.
        void window.hermesDesktop.saveLocalDraft(identity, id, { text: drafts.get(id) ?? '', attachments: draftAttachments.get(id) ?? [] }).catch(() => {
          if (active) setDraftError('Your draft could not be saved on this device. Keep the app open and copy your text before closing it.');
        });
      };
      stopText = drafts.observeMutations(persist); stopAttachments = draftAttachments.observeMutations(persist);
      setDraftReady(identity);
    }, () => { if (active) setDraftError("Your local drafts could not be loaded. Don't clear this app's data. Try again."); });
    return () => { active = false; stopText?.(); stopAttachments?.(); };
  }, [snapshot.draftIdentity, draftRetry]);
  const textVersion = useSyncExternalStore(drafts.subscribe, drafts.getSnapshot, drafts.getSnapshot);
  const attachmentVersion = useSyncExternalStore(draftAttachments.subscribe, draftAttachments.getSnapshot, draftAttachments.getSnapshot);
  const draftThreads = useMemo(() => new Set([...drafts.keys(), ...draftAttachments.keys()].filter(id => drafts.hasDraft(id) || draftAttachments.hasDraft(id))), [textVersion, attachmentVersion]);
  const [editor, setEditor] = useState<Editor>(null);
  const [labelTarget, setLabelTarget] = useState<{ thread: DesktopSnapshot['threads'][number]; connectionKey: string | undefined } | null>(null);
  const openLabels = useCallback((thread: DesktopSnapshot['threads'][number]) => setLabelTarget({ thread, connectionKey: snapshot.connectionKey }), [snapshot.connectionKey]);
  useEffect(() => { setLabelTarget(null); }, [snapshot.connectionKey]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const channel = snapshot.channels.find(({ id }) => id === snapshot.selectedChannelId);
  useEffect(() => {
    const shortcut = (event: globalThis.KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (document.querySelector?.('dialog.font-settings[open]')) return;

      if (event.key === "Escape") { setEditor(null); return; }
      if (!event.metaKey) return;

      if (event.key.toLocaleLowerCase() === "k") { event.preventDefault(); setEditor("palette"); }
      if (event.key.toLocaleLowerCase() === "n" && snapshot.channels.length) { event.preventDefault(); safely(window.hermesDesktop.newTab(snapshot.selectedChannelId)); }
    };
    window.addEventListener("keydown", shortcut); return () => window.removeEventListener("keydown", shortcut);
  }, [snapshot.selectedChannelId, snapshot.channels.length, editor]);
  if (snapshot.phase === "restoring") return <main className="loading-screen" role="status" aria-live="polite" aria-busy="true">Loading your conversations…</main>;
  if (snapshot.phase === "unpaired" || snapshot.phase === "pairing") return <main className="connection-screen"><PairingPanel busy={snapshot.phase === "pairing"} /><aside className="connection-notice" aria-live="polite">{snapshot.errorMessage ?? snapshot.statusMessage}</aside><FontSettingsButton className="text-button" /></main>;
  if (snapshot.draftIdentity && draftReady !== snapshot.draftIdentity) return <main className="loading-screen"><p role={draftError ? 'alert' : 'status'}>{draftError || 'Loading your local drafts…'}</p>{draftError && <button onClick={() => setDraftRetry(value => value + 1)}>Try again</button>}</main>;
  const forget = () => { if (window.confirm("Forget this connection and remove its local drafts and queued messages?")) { drafts.clear(); draftAttachments.clear(); safely(window.hermesDesktop.forgetConnection()); } };
  const deleteChannel = () => { if (channel && window.confirm(`Delete “${channel.name}”? This cannot be undone.`)) safely(window.hermesDesktop.deleteChannel(channel.id)); };
  const archive = () => { if (snapshot.selectedThreadId && window.confirm("Archive this topic?")) safely(window.hermesDesktop.archiveThread(snapshot.selectedThreadId)); };
  const overlays = <>{labelTarget && labelTarget.connectionKey === snapshot.connectionKey && <LabelsEditor key={`${labelTarget.connectionKey}:${labelTarget.thread.id}`} thread={labelTarget.thread} snapshot={snapshot} close={() => setLabelTarget(null)} />}{editor && <EditorDialog key={`${editor}:${snapshot.selectedChannelId}:${snapshot.selectedThreadId}`} kind={editor} snapshot={snapshot} close={() => setEditor(null)} />}</>;
  if (viewRole === 'workspace') return <NativeWorkspace snapshot={snapshot} draftThreads={new Set(snapshot.draftThreadIds ?? [])} onEditLabels={openLabels} onCreateProject={() => setEditor('new-channel')} onProjectOptions={id => { safely(window.hermesDesktop.selectChannel(id).then(() => setEditor('edit-channel'))); }} onSettings={() => setSettingsOpen(true)} overlayOpen={!!editor || !!labelTarget || settingsOpen}>
    {overlays}
    {settingsOpen && <div className="modal-backdrop" onMouseDown={() => setSettingsOpen(false)}><section className="editor-dialog" role="dialog" aria-modal="true" aria-label="Settings" onMouseDown={event => event.stopPropagation()}><h2>Settings</h2><FontSettingsButton className="text-button" /><button type="button" onClick={() => setEditor('palette')}>Find a session</button><button type="button" onClick={forget}>Forget connection</button>{channel && <button type="button" onClick={deleteChannel}>Delete current project</button>}<button type="button" onClick={() => setSettingsOpen(false)}>Close</button></section></div>}
  </NativeWorkspace>;
  if (snapshot.tabKind === 'new') return <NewSessionPage key={snapshot.tabId} snapshot={snapshot} />;
  return <main className="session-tab-page" aria-label="Hermes session">
    <header className="conversation-header"><div><p className="eyebrow">{channel?.name ?? 'Conversation'}</p><h2>{snapshot.selectedThreadTitle ?? 'Conversation'}</h2>{snapshot.supportsSessionLabels && <LabelPills markers={snapshot.threads.find(t => t.id === snapshot.selectedThreadId)?.markers} />}</div><div className="conversation-actions"><button type="button" onClick={() => safely(window.hermesDesktop.copySessionLink())}>Copy link</button>{snapshot.supportsSessionLabels && <button type="button" onClick={() => { const thread = snapshot.threads.find(t => t.id === snapshot.selectedThreadId); if (thread) openLabels(thread); }}>Edit labels</button>}<button type="button" onClick={() => setEditor('rename-thread')}>Rename</button><button type="button" onClick={archive}>Archive</button><FontSettingsButton className="text-button" /></div></header>
    {snapshot.errorMessage && <div className="error-banner" role="alert">{snapshot.errorMessage}</div>}{draftError && <div className="error-banner" role="alert">{draftError}</div>}
    <Timeline snapshot={snapshot} active={snapshot.tabActive === true} />
    {snapshot.interactions.map(item => <section className="interaction-card" key={item.id}><strong>{item.kind === 'approval' ? 'Approval requested' : 'Hermes needs clarification'}</strong><p>{item.prompt}</p><div>{item.choices.map(choice => <button type="button" key={choice} onClick={() => safely(window.hermesDesktop.answerInteraction(item.id, choice))}>{choice}</button>)}</div></section>)}
    <Composer snapshot={snapshot} />{overlays}
  </main>;
};

export const DesktopShell = () => <DesktopShellView snapshot={useDesktopSnapshot()} />;
