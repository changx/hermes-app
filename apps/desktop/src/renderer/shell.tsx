import { AttachmentView } from "./attachment-view";
import { AttachmentThumbnail } from './attachment-thumbnail';
import { SettingsButton } from './settings';
import { ProjectDialog } from './project-dialog';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from "react";
import { LocalDraftMap } from "../../../../packages/client/src/localDraftMap";
import { useDesktopSnapshot } from "./desktop-store";
import { MessageContent } from "./message-content";
import { workGroups, workIsExpanded, type WorkChoice, type WorkGroup } from "../../../../packages/client/src/workPresentation";
import { chatClock, chatDateSeparators, hasWaitingRequest, needsWorkPlaceholder, processingWarning } from "../../../../packages/client/src/chatPresentation";
import { compactToolCaption, toolPresentation } from "../../../../packages/client/src/toolPresentation";
import { SessionPicker } from './session-picker';
import { NativeWorkspace } from './native-workspace';
import { NewSessionPage } from './new-session-page';
import { LabelPills, LabelsEditor } from './session-labels';
import type { DesktopAttachment, DesktopMessage, DesktopSnapshot } from "../shared/desktop-api";

// Stroke icons for the floating Session toolbar. Decorative: each button carries its accessible name.
const TOOL_ICONS = {
  link: 'M8.5 11.5l3-3M7 9.5l-1.6 1.6a2.6 2.6 0 003.7 3.7L10.7 13M13 10.5l1.6-1.6a2.6 2.6 0 00-3.7-3.7L9.3 6.8',
  label: 'M3.5 4.5v4.6l7.4 7.4 5.6-5.6-7.4-7.4H4.5zM7 7h.01',
  rename: 'M4 16h3l8.5-8.5-3-3L4 13zM11 6l3 3',
  archive: 'M3.5 4.5h13v3h-13zM4.5 7.5v8h11v-8M8 10.5h4',
  settings: 'M10 7.2a2.8 2.8 0 100 5.6 2.8 2.8 0 000-5.6zM10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4',
} as const;
const ToolIcon = ({ name }: { name: keyof typeof TOOL_ICONS }) => <svg viewBox="0 0 20 20" aria-hidden="true"><path d={TOOL_ICONS[name]} /></svg>;

const drafts = new LocalDraftMap<string>(value => !!value.trim());
const draftAttachments = new LocalDraftMap<readonly DesktopAttachment[]>(value => value.length > 0);
const EmptyState = ({ children }: { children: string }) => <p className="empty-state">{children}</p>;
const safely = (task: Promise<unknown>) => void task.catch(() => {});

/**
 * Composer Enter rule. Single-line text: Enter sends. Multiline text: Enter adds a
 * line and Cmd/Ctrl+Enter sends. Shift+Enter always adds a line.
 */
export const composerEnterAction = (value: string, keys: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): "send" | "newline" => {
  if (keys.shiftKey || keys.altKey) return "newline";
  if (keys.metaKey || keys.ctrlKey) return "send";
  return value.includes("\n") ? "newline" : "send";
};

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

type Editor = "rename-thread" | "palette" | null;
type ProjectEditor = { channelId?: string } | null;
const EditorDialog = ({ kind, snapshot, close }: { kind: Exclude<Editor, null>; snapshot: DesktopSnapshot; close: () => void }) => {
  const [name, setName] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (kind === "rename-thread" && snapshot.selectedThreadId) safely(window.hermesDesktop.renameThread(snapshot.selectedThreadId, name).then(close));
  };
  if (kind === "palette") return <SessionPicker snapshot={snapshot} close={close} />;
  const title = "Rename topic";
  return <div className="modal-backdrop" role="presentation" onMouseDown={close}><form className="editor-dialog" role="dialog" aria-modal="true" aria-label={title} onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
    <h2>{title}</h2><label>Title<input autoFocus required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} /></label>
    <div className="dialog-actions"><button type="button" className="secondary" onClick={close}>Cancel</button><button type="submit">Save</button></div>
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
  const timeLabel = hasTime && timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const warning = processingWarning(message.receiptState, message.processing);
  return <article hidden={hidden} data-result-ref={message.refSeq} className={`message message-${message.role}${continuation ? " message-continuation" : ""}${toolsOnly ? " message-tools-only" : ""}${finalReply ? " message-final" : ""}${message.optimistic ? " optimistic" : ""}`}>
    {message.role !== "assistant" && message.role !== "user" && !continuation && hasTime && <p className="message-role"><time className="message-time" dateTime={timestamp.toISOString()}>{timeLabel}</time></p>}
    <MessageContent text={message.text} />
    <div className="tool-records">{message.toolCalls.map((tool) => {
      const presentation = toolPresentation(tool.name);
      return <section className="tool-record" key={tool.id} aria-label={tool.label}>
        <div className="tool-line"><span className="tool-icon" aria-hidden="true">{tool.icon ?? presentation.icon}</span><span className="tool-label" title={`${tool.label}${!presentation.command && tool.detail ? ` · ${tool.detail}` : ""}`}>{compactToolCaption(tool.name ?? '', tool.label, tool.detail, tool.caption)}</span></div>
        {presentation.command && tool.detail ? <pre className="tool-command">{tool.detail}</pre> : null}
      </section>;
    })}</div>
    {message.attachments.map((attachment) => <AttachmentView key={attachment.id} attachment={attachment} />)}
    {message.feedback && <div className="receipt">{message.feedback}</div>}
    {warning || message.receiptState === "queued" && message.receiptId ? <div className="receipt message-warning">{warning}{message.clientMessageId && warning ? <button type="button" onClick={() => safely(window.hermesDesktop.retryMessage(message.clientMessageId!))}>Retry safely</button> : null}{message.receiptId && message.receiptState === "queued" ? <button type="button" onClick={() => safely(window.hermesDesktop.cancelQueued(message.receiptId!))}>Cancel</button> : null}</div> : null}
    {message.role === "user" && <div className="user-message-time"><time className="message-time" dateTime={hasTime ? timestamp.toISOString() : undefined} title={hasTime ? timestamp.toLocaleString() : "Time unavailable"}>{chatClock(message.createdAt)}</time></div>}
  </article>;
});

const Timeline = memo(({ snapshot, active = true, sendVersion = 0 }: { snapshot: DesktopSnapshot; active?: boolean; sendVersion?: number }) => {
  const [workChoices, setWorkChoices] = useState<Record<string, WorkChoice>>({});
  const workMessages = snapshot.messages.map(message => ({ key: message.id, role: message.role, kind: message.displayKind, seconds: message.createdAt,
    waiting: message.role === 'user' && ['queued', 'running'].includes(message.receiptState ?? '') && (message.processing == null || message.processing === 'running') }));
  const lastUser = [...snapshot.messages].reverse().find(message => message.role === 'user');
  const callbackEnded = lastUser?.processing != null && lastUser.processing !== 'running';
  const running = !snapshot.interactions.length && ((!callbackEnded && !!snapshot.threads.find(thread => thread.id === snapshot.selectedThreadId)?.running) || hasWaitingRequest(workMessages));
  const groups = workGroups(workMessages, running);
  const dates = chatDateSeparators(workMessages);
  const awaitingWork = !snapshot.loadingMessages && !snapshot.interactions.length && needsWorkPlaceholder(workMessages, groups, running);
  const choiceKey = (group: WorkGroup) => `${snapshot.selectedThreadId}:${group.key}`;
  const list = useRef<HTMLDivElement>(null);
  const contents = useRef<HTMLDivElement>(null);
  const previous = useRef({ threadId: "", first: "", height: 0, count: 0 });
  const [following, setFollowing] = useState(true);
  const followingRef = useRef(true);
  const geometry = useRef({ height: 0, viewport: 0 });
  const previousSend = useRef(sendVersion);
  const [newCount, setNewCount] = useState(0);
  const first = snapshot.messages[0]?.id ?? "";
  const result = snapshot.threads.find(t => t.id === snapshot.selectedThreadId);
  useLayoutEffect(() => {
    if (previousSend.current === sendVersion) return;
    previousSend.current = sendVersion;
    followingRef.current = true; setFollowing(true); setNewCount(0);
    if (active && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [sendVersion, active]);
  useEffect(() => {
    const node = list.current, body = contents.current;
    if (!active || !node || !body) return;
    const reconcile = () => {
      // Rich content can finish layout without changing the message snapshot.
      if (followingRef.current) node.scrollTop = node.scrollHeight;
      geometry.current = { height: node.scrollHeight, viewport: node.clientHeight };
    };
    const observer = new ResizeObserver(reconcile);
    observer.observe(body); observer.observe(node); reconcile();
    return () => observer.disconnect();
  }, [active]);
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
    else if (followingRef.current) node.scrollTop = node.scrollHeight;
    else if (snapshot.messages.length > old.count) setNewCount((value) => value + snapshot.messages.length - old.count);
    previous.current = { threadId: snapshot.selectedThreadId ?? "", first, height: node.scrollHeight, count: snapshot.messages.length };
    geometry.current = { height: node.scrollHeight, viewport: node.clientHeight };
  }, [active, first, following, snapshot.messages, snapshot.selectedThreadId, awaitingWork]);
  const scroll = () => {
    const node = list.current;
    if (!node) return;
    const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
    // A size correction is not a reader gesture. Keep follow until its resize
    // observer has reconciled the new content/viewport extent.
    if (followingRef.current && (geometry.current.height !== node.scrollHeight || geometry.current.viewport !== node.clientHeight)) return;
    followingRef.current = atBottom;
    setFollowing(atBottom);
    if (atBottom) setNewCount(0);
  };
  const latest = () => { followingRef.current = true; const node = list.current; if (node) node.scrollTop = node.scrollHeight; setFollowing(true); setNewCount(0); };
  return <div className="timeline-wrap">
    <div className="message-list" aria-live="polite" ref={list} onScroll={scroll}>
      <div className="timeline-content" ref={contents}>
      {snapshot.canLoadOlder || snapshot.loadingHistory ? <div className="history-loading-slot">
        {snapshot.loadingHistory ? <div className="history-loading-status" role="status" aria-live="polite" aria-busy="true"><span className="conversation-loading-spinner" aria-hidden="true" />Loading messages…</div> : <button className="load-older" type="button" onClick={() => safely(window.hermesDesktop.loadOlder())}>Load all earlier messages</button>}
      </div> : null}
      {snapshot.loadingMessages && !snapshot.errorMessage ? <div className="conversation-empty" role="status" aria-live="polite" aria-busy="true"><span className="conversation-loading-spinner" aria-hidden="true" /><h3>Loading messages…</h3></div> : snapshot.messages.length ? snapshot.messages.map((message, index) => {
        const previous = snapshot.messages[index - 1];
        const continuation = message.role === "assistant" && previous?.role === "assistant" && !message.displayKind && !previous.displayKind;
        const group = groups.get(message.id);
        const expanded = group ? workIsExpanded(group, workChoices[choiceKey(group)]) : true;
        return <div className="timeline-entry" key={message.id}>
          {dates.has(message.id) && <div className="chat-date-separator">{dates.get(message.id)}</div>}
          {group?.key === message.id && <div className="work-heading"><button type="button" className="work-toggle" aria-expanded={expanded} onClick={() => setWorkChoices(old => ({ ...old, [choiceKey(group)]: { completion: group.completion, expanded: !expanded } }))}>{group.label}<span className="work-chevron" aria-hidden="true">{expanded ? '\ue001' : '\ue002'}</span></button></div>}
          <MessageRow message={message} continuation={continuation} hidden={!expanded} />
        </div>;
      }) : !snapshot.errorMessage ? <div className="conversation-empty"><div className="empty-mark" aria-hidden="true">H</div><h3>No messages yet</h3><p>This conversation is ready when you are.</p></div> : null}
      {awaitingWork && <div className="work-heading awaiting-agent-work" role="status"><span className="work-toggle">Working<span className="work-chevron" aria-hidden="true">{'\ue001'}</span></span></div>}
      </div>
    </div>
    {!following && newCount > 0 ? <button className="new-messages" type="button" onClick={latest}>{newCount} new {newCount === 1 ? "message" : "messages"} · Back to latest</button> : null}
  </div>;
}, (before,after) => before.active === after.active && before.sendVersion === after.sendVersion && before.snapshot.threads === after.snapshot.threads && before.snapshot.messages === after.snapshot.messages && before.snapshot.selectedThreadId === after.snapshot.selectedThreadId && before.snapshot.canLoadOlder === after.snapshot.canLoadOlder && before.snapshot.connectionState === after.snapshot.connectionState && before.snapshot.loadingMessages === after.snapshot.loadingMessages && before.snapshot.loadingHistory === after.snapshot.loadingHistory && before.snapshot.errorMessage === after.snapshot.errorMessage);

// Textarea height inside the composer card: one line plus top padding, growing to about eight lines.
const COMPOSER_INPUT_MIN = 48;
const COMPOSER_INPUT_MAX = 216;

const Composer = ({ snapshot, onQueued }: { snapshot: DesktopSnapshot; onQueued(): void }) => {
  const threadId = snapshot.selectedThreadId;
  const [text, setText] = useState(threadId ? drafts.get(threadId) ?? "" : "");
  const [attachments, setAttachments] = useState<readonly DesktopAttachment[]>(threadId ? draftAttachments.get(threadId) ?? [] : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const working = useRef(false);
  const mounted = useRef(true);
  const restoreFocus = useRef(false);
  const tabActive = snapshot.tabActive === true;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // Entering a Session page puts the cursor in the composer. Hidden tabs never take focus.
  useEffect(() => { if (tabActive && threadId) input.current?.focus({ preventScroll: true }); }, [tabActive, threadId]);
  // The textarea is disabled while a send/upload runs, which drops focus. Restore it afterwards.
  useEffect(() => {
    if (busy || !restoreFocus.current) return;
    restoreFocus.current = false;
    if (tabActive) input.current?.focus({ preventScroll: true });
  }, [busy, tabActive]);
  useLayoutEffect(() => {
    if (!input.current) return;
    input.current.style.height = "0px";
    input.current.style.height = `${Math.min(COMPOSER_INPUT_MAX, Math.max(COMPOSER_INPUT_MIN, input.current.scrollHeight))}px`;
  }, [text]);
  const update = (value: string) => { setText(value); if (threadId) drafts.set(threadId, value); };
  const finish = () => { working.current = false; if (mounted.current) setBusy(false); };
  const submit = async () => {
    if (!threadId || working.current || (!text.trim() && !attachments.length)) return;
    restoreFocus.current = document.activeElement === input.current;
    working.current = true; setBusy(true); setError("");
    try {
      await window.hermesDesktop.sendMessage({ text, attachmentIds: attachments.map(({ id }) => id) });
      if (mounted.current) onQueued();
      drafts.delete(threadId); draftAttachments.delete(threadId);
      if (mounted.current) { setText(""); setAttachments([]); }
    } catch { if (mounted.current) setError("Your message could not be saved. Your draft is still here."); }
    finally { finish(); }
  };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing || event.keyCode === 229) return;
    const action = composerEnterAction(text, event);
    if (action === "send") { event.preventDefault(); safely(submit()); }
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
    if (files && (attachments.length + files.length > 8 || files.some(file => file.size < 1 || file.size > 10 * 1024 * 1024))) {
      setError('Choose up to eight files, each between 1 byte and 10 MiB.'); return;
    }
    restoreFocus.current = document.activeElement === input.current;
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
    {running ? <div className="running-row">
      <div className="agent-running" role="status" aria-live="polite">
        {active ? <span className="running-dots" aria-hidden="true"><span /><span /><span /></span> : null}
        <span>{!online ? "Reconnecting…" : active ? "Agent is running" : "Waiting for your response"}</span>
      </div>
      <button type="button" className="stop-button" aria-label="Stop agent" title="Stop agent" disabled={!online} onClick={() => safely(window.hermesDesktop.stopThread())}>■</button>
    </div> : null}
    {/* ChatGPT-style input card: attachments, borderless textarea, then a tool row with plus and a round send button. */}
    <div className="composer-box" onClick={event => { if (event.target === event.currentTarget || event.target === toolbar.current) input.current?.focus(); }}>
      {attachments.length ? <div className="composer-attachments">{attachments.map(item => <span className="composer-attachment" key={item.id}><AttachmentThumbnail attachment={item} />{item.name}<button type="button" disabled={busy} aria-label={`Remove ${item.name}`} onClick={() => remove(item)}>×</button><button type="button" aria-label={`Preview ${item.name}`} onClick={() => { setError(''); void window.hermesDesktop.previewAttachment(item.id).catch(() => { if (mounted.current) setError('The file could not be previewed.'); }); }}>Preview</button></span>)}</div> : null}
      <textarea ref={input} rows={1} aria-label="Message" placeholder={threadId ? "Message Hermes" : "Choose a thread to write a message"} disabled={!threadId || busy} value={text} onChange={event => update(event.target.value)} onKeyDown={keyDown} onPaste={event => { const files = [...event.clipboardData.files]; if (files.length) { event.preventDefault(); safely(attach(files)); } }} />
      <div className="composer-toolbar" ref={toolbar}>
        <button type="button" className="attach-button" onClick={() => safely(attach())} disabled={!threadId || busy || attachments.length >= 8} aria-label="Attach files" title="Attach files"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg></button>
        <button type="button" className="send-button" aria-label="Send message" title="Send message" onClick={() => safely(submit())} disabled={!threadId || busy || (!text.trim() && !attachments.length)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 16V4M5 9l5-5 5 5" /></svg></button>
      </div>
    </div>
  </footer>;
};

export const DesktopShellView = ({ snapshot, viewRole: requestedRole = typeof window !== 'undefined' ? window.hermesDesktop?.getRuntimeInfo?.()?.viewRole ?? 'tab' : 'tab' }: { snapshot: DesktopSnapshot; viewRole?: 'workspace' | 'tab' | 'settings' }) => {
  // The Settings window renders SettingsPage from index.tsx and never mounts this shell.
  const viewRole: 'workspace' | 'tab' = requestedRole === 'workspace' ? 'workspace' : 'tab';
  const [sendVersion, setSendVersion] = useState(0);
  const [draftReady, setDraftReady] = useState<string | undefined>();
  const [draftError, setDraftError] = useState('');
  const [draftRetry, setDraftRetry] = useState(0);
  const draftScope = viewRole === 'workspace' && snapshot.connections ? snapshot.connections.flatMap(row => row.connectionKey ? [row.connectionKey] : []).join('|') : snapshot.draftIdentity;
  useEffect(() => {
    const identity = snapshot.draftIdentity;
    if (!identity) return;
    let active = true;
    let stopText: (() => void) | undefined, stopAttachments: (() => void) | undefined;
    if (viewRole !== 'workspace') setDraftReady(undefined);
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
      if (viewRole !== 'workspace') { stopText = drafts.observeMutations(persist); stopAttachments = draftAttachments.observeMutations(persist); }
      setDraftReady(identity);
    }, () => { if (active) setDraftError("Your local drafts could not be loaded. Don't clear this app's data. Try again."); });
    return () => { active = false; stopText?.(); stopAttachments?.(); };
  }, [snapshot.draftIdentity, draftScope, draftRetry, viewRole]);
  const textVersion = useSyncExternalStore(drafts.subscribe, drafts.getSnapshot, drafts.getSnapshot);
  const attachmentVersion = useSyncExternalStore(draftAttachments.subscribe, draftAttachments.getSnapshot, draftAttachments.getSnapshot);
  const draftThreads = useMemo(() => new Set([...drafts.keys(), ...draftAttachments.keys()].filter(id => drafts.hasDraft(id) || draftAttachments.hasDraft(id))), [textVersion, attachmentVersion]);
  const [editor, setEditor] = useState<Editor>(null);
  const [projectEditor, setProjectEditor] = useState<ProjectEditor>(null);
  const [labelTarget, setLabelTarget] = useState<{ thread: DesktopSnapshot['threads'][number]; connectionKey: string | undefined } | null>(null);
  const openLabels = useCallback((thread: DesktopSnapshot['threads'][number]) => setLabelTarget({ thread, connectionKey: snapshot.channels.find(c => c.id === thread.channelId)?.connectionKey ?? snapshot.connectionKey }), [snapshot.channels, snapshot.connectionKey]);
  useEffect(() => { if (labelTarget && (snapshot.connections ? !snapshot.connections.some(row => row.connectionKey === labelTarget.connectionKey) : labelTarget.connectionKey !== snapshot.connectionKey)) setLabelTarget(null); }, [snapshot.connections, snapshot.connectionKey, labelTarget]);
  useEffect(() => {
    const shortcut = (event: globalThis.KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") { setEditor(null); setProjectEditor(null); return; }
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;

      if (event.key.toLocaleLowerCase() === "k") { event.preventDefault(); setEditor("palette"); }
      if (event.key.toLocaleLowerCase() === "n" && snapshot.channels.length) { event.preventDefault(); safely(window.hermesDesktop.newTab(snapshot.selectedChannelId)); }
    };
    window.addEventListener("keydown", shortcut); return () => window.removeEventListener("keydown", shortcut);
  }, [snapshot.selectedChannelId, snapshot.channels.length, editor]);
  if (snapshot.phase === "restoring") return <main className="loading-screen" role="status" aria-live="polite" aria-busy="true">Loading your conversations…</main>;
  if (snapshot.phase === "unpaired" || snapshot.phase === "pairing") return <main className="connection-screen"><PairingPanel busy={snapshot.phase === "pairing"} /><aside className="connection-notice" aria-live="polite">{snapshot.errorMessage ?? snapshot.statusMessage}</aside><SettingsButton className="text-button" /></main>;
  if (snapshot.draftIdentity && (viewRole === 'workspace' ? draftReady === undefined : draftReady !== snapshot.draftIdentity)) return <main className="loading-screen"><p role={draftError ? 'alert' : 'status'}>{draftError || 'Loading your local drafts…'}</p>{draftError && <button onClick={() => setDraftRetry(value => value + 1)}>Try again</button>}</main>;


  const archive = () => { if (snapshot.selectedThreadId && window.confirm("Archive this topic?")) safely(window.hermesDesktop.archiveThread(snapshot.selectedThreadId)); };
  const overlays = <>{labelTarget && (snapshot.connections ? snapshot.connections.some(row => row.connectionKey === labelTarget.connectionKey) : labelTarget.connectionKey === snapshot.connectionKey) && <LabelsEditor key={`${labelTarget.connectionKey}:${labelTarget.thread.id}`} thread={labelTarget.thread} snapshot={{ ...snapshot, connectionKey: labelTarget.connectionKey, connectionState: snapshot.connections?.find(row => row.connectionKey === labelTarget.connectionKey)?.state === 'online' ? 'online' : snapshot.connections ? 'blocked' : snapshot.connectionState }} close={() => setLabelTarget(null)} />}{projectEditor && <ProjectDialog key={projectEditor.channelId ?? 'new-project'} snapshot={snapshot} channelId={projectEditor.channelId} close={() => setProjectEditor(null)} />}{editor && <EditorDialog key={`${editor}:${snapshot.selectedChannelId}:${snapshot.selectedThreadId}`} kind={editor} snapshot={snapshot} close={() => setEditor(null)} />}</>;
  if (viewRole === 'workspace') return <NativeWorkspace snapshot={snapshot} draftThreads={new Set(snapshot.draftThreadIds ?? [])} onEditLabels={openLabels} onCreateProject={() => setProjectEditor({})} onProjectOptions={id => setProjectEditor({ channelId: id })} onSettings={() => safely(window.hermesDesktop.openSettings())} overlayOpen={!!editor || !!projectEditor || !!labelTarget}>
    {overlays}
  </NativeWorkspace>;
  if (snapshot.tabKind === 'new') return <NewSessionPage key={snapshot.tabId} snapshot={snapshot} />;
  return <main className="session-tab-page" aria-label="Hermes session">
    {snapshot.errorMessage && <div className="error-banner" role="alert">{snapshot.errorMessage}</div>}{draftError && <div className="error-banner" role="alert">{draftError}</div>}
    <div className="session-main">
      {/* No title bar: the tab already names the Session. Tools float at the top right over the timeline. */}
      <div className="session-toolbar" role="toolbar" aria-label="Session tools">
        {snapshot.supportsSessionLabels && <LabelPills markers={snapshot.threads.find(t => t.id === snapshot.selectedThreadId)?.markers} />}
        <div className="conversation-actions">
          <button type="button" aria-label="Copy link" title="Copy link" onClick={() => safely(window.hermesDesktop.copySessionLink())}><ToolIcon name="link" /></button>
          {snapshot.supportsSessionLabels && <button type="button" aria-label="Edit labels" title="Edit labels" onClick={() => { const thread = snapshot.threads.find(t => t.id === snapshot.selectedThreadId); if (thread) openLabels(thread); }}><ToolIcon name="label" /></button>}
          <button type="button" aria-label="Rename" title="Rename" onClick={() => setEditor('rename-thread')}><ToolIcon name="rename" /></button>
          <button type="button" aria-label="Archive" title="Archive" onClick={archive}><ToolIcon name="archive" /></button>
          <SettingsButton icon={<ToolIcon name="settings" />} />
        </div>
      </div>
      <Timeline snapshot={snapshot} active={snapshot.tabActive === true} sendVersion={sendVersion} />
    </div>
    {snapshot.interactions.map(item => <section className="interaction-card" key={item.id}><strong>{item.kind === 'approval' ? 'Approval requested' : 'Hermes needs clarification'}</strong><p>{item.prompt}</p><div>{item.choices.map(choice => <button type="button" key={choice} onClick={() => safely(window.hermesDesktop.answerInteraction(item.id, choice))}>{choice}</button>)}</div></section>)}
    <Composer snapshot={snapshot} onQueued={() => setSendVersion(value => value + 1)} />{overlays}
  </main>;
};

export const DesktopShell = () => <DesktopShellView snapshot={useDesktopSnapshot()} />;
