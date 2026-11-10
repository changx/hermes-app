import { AttachmentSequence, AttachmentView } from "./attachment-view";
import { AttachmentThumbnail } from './attachment-thumbnail';
import { SettingsButton } from './settings';
import { TooltipLayer } from './tooltip';
import { ErrorBanner } from './error-banner';
import { ProjectDialog } from './project-dialog';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from "react";
import { LocalDraftMap } from "../../../../packages/client/src/localDraftMap";
import { useDesktopSnapshot } from "./desktop-store";
import { MessageContent } from "./message-content";
import { ClickCopy } from "./click-copy";
import { MessageToolbar, UserMessageCopy } from "./message-toolbar";
import { workGroups, workIsExpanded, type WorkChoice, type WorkGroup } from "../../../../packages/client/src/workPresentation";
import { chatClock, chatDateSeparators, hasWaitingRequest, needsWorkPlaceholder, processingWarning } from "../../../../packages/client/src/chatPresentation";
import { compactToolCaption, toolPresentation } from "../../../../packages/client/src/toolPresentation";
import { SessionPicker, type SearchScope } from './session-picker';
import { pageSelection } from './find-bar';
import { SessionFilesPanel } from './session-files-panel';
import { emptySessionQuery, type SessionQuery } from '../../../../packages/client/src/sessionSearch';
import { NativeWorkspace } from './native-workspace';
import { NewSessionPage } from './new-session-page';
import { AutomationListPage, AutomationPage } from './automations';
import { LabelsEditor } from './session-labels';
import { hasTodo } from '../../../../packages/client/src/todo';
import { SessionStatusBar, type StatusAction } from './session-status-bar';
import { setSessionTodo } from './todo-toggle';
import { VaultPromptCard } from './vault-prompt-card';
import type { DesktopAttachment, DesktopMessage, DesktopSnapshot } from "../shared/desktop-api";
import { ATTACHMENT_SIZE_RULE } from "../shared/attachment-input";
import { fileSizeLimit, namePastedFiles } from './pasted-files';

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

/** The search dialog (with its starting query and scope) or the Session files panel. */
type Editor = { kind: "palette"; query?: SessionQuery; scope?: SearchScope } | { kind: "files" } | null;
type ProjectEditor = { channelId?: string } | null;
/** Renames any Session: the open one (toolbar) or a sidebar row (context menu). Starts with the current title selected. */
const RenameDialog = ({ thread, close }: { thread: DesktopSnapshot['threads'][number]; close: () => void }) => {
  const [name, setName] = useState(thread.title);
  const [busy, setBusy] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const title = name.trim();
    if (!title || busy) return;
    if (title === thread.title) { close(); return; }
    // A failure keeps the dialog open; the connection's error banner explains it.
    setBusy(true); void window.hermesDesktop.renameThread(thread.id, title).then(close, () => setBusy(false));
  };
  const title = "Rename session";
  return <div className="modal-backdrop" role="presentation" onMouseDown={close}><form className="editor-dialog" role="dialog" aria-modal="true" aria-label={title} onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
    <h2>{title}</h2><label>Title<input autoFocus required maxLength={200} value={name} onFocus={event => event.currentTarget.select()} onChange={(event) => setName(event.target.value)} /></label>
    <div className="dialog-actions"><button type="button" className="secondary" onClick={close}>Cancel</button><button type="submit" disabled={busy || !name.trim()}>Save</button></div>
  </form></div>;
};

const MessageRow = memo(({ message, continuation, hidden = false, focused = false, toolbar = false, canRetry = false, running = false, branch = false, sources = false }: { message: DesktopMessage; continuation: boolean; hidden?: boolean; focused?: boolean; toolbar?: boolean; canRetry?: boolean; running?: boolean; branch?: boolean; sources?: boolean }) => {
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
  return <article hidden={hidden} data-result-ref={message.refSeq} className={`message message-${message.role}${continuation ? " message-continuation" : ""}${toolsOnly ? " message-tools-only" : ""}${finalReply ? " message-final" : ""}${message.optimistic ? " optimistic" : ""}${focused ? " message-focused" : ""}`}>
    {message.role !== "assistant" && message.role !== "user" && !continuation && hasTime && <p className="message-role"><time className="message-time" dateTime={timestamp.toISOString()}>{timeLabel}</time></p>}
    <MessageContent text={message.text} lines={message.displayKind === "direct"} />
    <div className="tool-records">{message.toolCalls.map((tool) => {
      const presentation = toolPresentation(tool.name);
      return <section className="tool-record" key={tool.id} aria-label={tool.label}>
        <div className="tool-line"><span className="tool-icon" aria-hidden="true">{tool.icon ?? presentation.icon}</span><span className="tool-label" title={`${tool.label}${!presentation.command && tool.detail ? ` · ${tool.detail}` : ""}`}>{compactToolCaption(tool.name ?? '', tool.label, tool.detail, tool.caption)}</span></div>
        {presentation.command && tool.detail ? <ClickCopy as="pre" className="tool-command" text={tool.detail}>{tool.detail}</ClickCopy> : null}
      </section>;
    })}</div>
    {message.attachments.map((attachment) => <AttachmentView key={attachment.id} attachment={attachment} />)}
    {finalReply && toolbar && message.refSeq !== undefined && <MessageToolbar message={message} canRetry={canRetry} running={running} branch={branch} sources={sources} />}
    {message.feedback && <div className="receipt">{message.feedback}</div>}
    {warning ? <div className="receipt message-warning">{warning}{message.clientMessageId ? <button type="button" onClick={() => safely(window.hermesDesktop.retryMessage(message.clientMessageId!))}>Retry safely</button> : null}</div> : null}
    {/* Cancel sits in the time line. Its space is always reserved (an invisible placeholder when not queued),
        so the bubble keeps the same width and height when Cancel appears or disappears, even for short text. */}
    {message.role === "user" && <div className="user-message-time">{message.receiptId && message.receiptState === "queued" ? <button type="button" className="user-message-cancel" aria-label="Cancel queued message" onClick={() => safely(window.hermesDesktop.cancelQueued(message.receiptId!))}>Cancel</button> : <span className="user-message-cancel user-message-cancel-slot" aria-hidden="true">Cancel</span>}{message.text && <UserMessageCopy text={message.text} />}<time className="message-time" dateTime={hasTime ? timestamp.toISOString() : undefined} title={hasTime ? timestamp.toLocaleString() : "Time unavailable"}>{chatClock(message.createdAt)}</time></div>}
  </article>;
});

const Timeline = memo(({ snapshot, active = true, sendVersion = 0 }: { snapshot: DesktopSnapshot; active?: boolean; sendVersion?: number }) => {
  const [workChoices, setWorkChoices] = useState<Record<string, WorkChoice>>({});
  const workMessages = snapshot.messages.map(message => ({ key: message.id, role: message.role, kind: message.displayKind, seconds: message.createdAt,
    waiting: message.role === 'user' && ['queued', 'running'].includes(message.receiptState ?? '') && (message.processing == null || message.processing === 'running') }));
  const lastUser = [...snapshot.messages].reverse().find(message => message.role === 'user');
  const callbackEnded = lastUser?.processing != null && lastUser.processing !== 'running';
  const waiting = snapshot.interactions.length + (snapshot.vaultPrompts?.length ?? 0);
  const running = !waiting && ((!callbackEnded && !!snapshot.threads.find(thread => thread.id === snapshot.selectedThreadId)?.running) || hasWaitingRequest(workMessages));
  const groups = workGroups(workMessages, running);
  // Retry re-runs only the latest turn (core /retry): the last final reply with no later input.
  const retryId = (() => { for (let i = snapshot.messages.length - 1; i >= 0; i--) { const m = snapshot.messages[i]; if (m.role === 'user') return undefined; if (m.role === 'assistant' && m.displayKind === 'final') return m.id; } return undefined; })();
  const busyTurn = running || waiting > 0;
  const dates = chatDateSeparators(workMessages);
  const awaitingWork = !snapshot.loadingMessages && !waiting && needsWorkPlaceholder(workMessages, groups, running);
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
  // A file search result opened this Session at one message: unfold its work group, then scroll it into view once.
  const focus = snapshot.focusMessage, shownFocus = useRef(0);
  const focusGroup = focus ? snapshot.messages.find(message => message.refSeq === focus.refSeq) : undefined;
  const focusGroupInfo = focusGroup ? groups.get(focusGroup.id) : undefined;
  useEffect(() => {
    if (!focus || !focusGroupInfo || shownFocus.current === focus.version || workIsExpanded(focusGroupInfo, workChoices[choiceKey(focusGroupInfo)])) return;
    setWorkChoices(old => ({ ...old, [choiceKey(focusGroupInfo)]: { completion: focusGroupInfo.completion, expanded: true } }));
  });
  const [focusedRef, setFocusedRef] = useState<number>();
  useLayoutEffect(() => {
    const root = list.current;
    if (!active || !root || !focus || shownFocus.current === focus.version || snapshot.loadingMessages || snapshot.loadingHistory) return;
    const target = root.querySelector<HTMLElement>(`[data-result-ref="${focus.refSeq}"]`);
    if (!target || target.hidden) return;
    shownFocus.current = focus.version;
    followingRef.current = false; setFollowing(false);
    target.scrollIntoView({ block: "center" });
    setFocusedRef(focus.refSeq);
  });
  useEffect(() => {
    if (focusedRef === undefined) return;
    const timer = setTimeout(() => setFocusedRef(undefined), 2400);
    return () => clearTimeout(timer);
  }, [focusedRef, focus?.version]);
  const scroll = () => {
    const node = list.current;
    if (!node) return;
    // Rejoin follow only at the real end (2px absorbs fractional scrollTop).
    // A wider band made the follow layout effect snap the remainder: a jump.
    const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight <= 2;
    // A size correction is not a reader gesture. Keep follow until its resize
    // observer has reconciled the new content/viewport extent.
    if (followingRef.current && (geometry.current.height !== node.scrollHeight || geometry.current.viewport !== node.clientHeight)) return;
    followingRef.current = atBottom;
    setFollowing(atBottom);
    if (atBottom) setNewCount(0);
  };
  const latest = () => { followingRef.current = true; const node = list.current; if (node) node.scrollTop = node.scrollHeight; setFollowing(true); setNewCount(0); };
  // Preview moves between all attachments of the open Session; read at click time so rows stay memoized.
  const messagesRef = useRef(snapshot.messages);
  messagesRef.current = snapshot.messages;
  const attachmentSequence = useCallback(() => messagesRef.current.flatMap(message => message.attachments.filter(item => item.state === "available").map(item => item.id)), []);
  return <AttachmentSequence.Provider value={attachmentSequence}><div className="timeline-wrap">
    <div className="message-list" aria-live="polite" ref={list} onScroll={scroll}>
      <div className="timeline-content" ref={contents}>
      {snapshot.canLoadOlder || snapshot.loadingHistory ? <div className="history-loading-slot">
        {snapshot.loadingHistory ? <div className="history-loading-status" role="status" aria-live="polite" aria-busy="true"><span className="conversation-loading-spinner" aria-hidden="true" />Loading messages…</div> : <button className="load-older" type="button" onClick={() => safely(window.hermesDesktop.loadOlder())}>Load all earlier messages</button>}
      </div> : null}
      {/* Loading never hides messages already shown (an unsent first message stays in place). */}
      {snapshot.loadingMessages && !snapshot.messages.length && !snapshot.errorMessage ? <div className="conversation-empty" role="status" aria-live="polite" aria-busy="true"><span className="conversation-loading-spinner" aria-hidden="true" /><h3>Loading messages…</h3></div> : snapshot.messages.length ? snapshot.messages.map((message, index) => {
        const previous = snapshot.messages[index - 1];
        const continuation = message.role === "assistant" && previous?.role === "assistant" && !message.displayKind && !previous.displayKind;
        const group = groups.get(message.id);
        const expanded = group ? workIsExpanded(group, workChoices[choiceKey(group)]) : true;
        return <div className="timeline-entry" key={message.id}>
          {dates.has(message.id) && <div className="chat-date-separator">{dates.get(message.id)}</div>}
          {group?.key === message.id && <div className="work-heading"><button type="button" className="work-toggle" aria-expanded={expanded} onClick={() => setWorkChoices(old => ({ ...old, [choiceKey(group)]: { completion: group.completion, expanded: !expanded } }))}>{group.label}<span className="work-chevron" aria-hidden="true">{expanded ? '\ue001' : '\ue002'}</span></button></div>}
          <MessageRow message={message} continuation={continuation} hidden={!expanded} focused={focusedRef !== undefined && message.refSeq === focusedRef} toolbar canRetry={message.id === retryId} running={busyTurn}
            branch={snapshot.supportsThreadBranch === true} sources={snapshot.supportsMessageSources === true} />
        </div>;
      }) : !snapshot.errorMessage ? <div className="conversation-empty"><div className="empty-mark" aria-hidden="true">H</div><h3>No messages yet</h3><p>This conversation is ready when you are.</p></div> : null}
      {awaitingWork && <div className="work-heading awaiting-agent-work" role="status"><span className="work-toggle">Working<span className="work-chevron" aria-hidden="true">{'\ue001'}</span></span></div>}
      </div>
    </div>
    {!following && newCount > 0 ? <button className="new-messages" type="button" onClick={latest}>{newCount} new {newCount === 1 ? "message" : "messages"} · Back to latest</button> : null}
  </div></AttachmentSequence.Provider>;
}, (before,after) => before.active === after.active && before.sendVersion === after.sendVersion && before.snapshot.threads === after.snapshot.threads && before.snapshot.messages === after.snapshot.messages && before.snapshot.selectedThreadId === after.snapshot.selectedThreadId && before.snapshot.canLoadOlder === after.snapshot.canLoadOlder && before.snapshot.connectionState === after.snapshot.connectionState && before.snapshot.loadingMessages === after.snapshot.loadingMessages && before.snapshot.loadingHistory === after.snapshot.loadingHistory && before.snapshot.errorMessage === after.snapshot.errorMessage
  && before.snapshot.interactions.length === after.snapshot.interactions.length && (before.snapshot.vaultPrompts?.length ?? 0) === (after.snapshot.vaultPrompts?.length ?? 0) && before.snapshot.focusMessage?.version === after.snapshot.focusMessage?.version && before.snapshot.supportsThreadBranch === after.snapshot.supportsThreadBranch && before.snapshot.supportsMessageSources === after.snapshot.supportsMessageSources);

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
  // The app window became active: the cursor goes back to the composer, unless a dialog on this page is open.
  useEffect(() => window.hermesDesktop.onFocusComposer?.(() => {
    const field = input.current;
    if (!tabActive || !field || document.querySelector('dialog[open]')) return;
    if (field.disabled) restoreFocus.current = true; else field.focus({ preventScroll: true });
  }), [tabActive]);
  // The textarea is disabled while a send/upload runs, which drops focus. Restore it afterwards.
  useEffect(() => {
    if (busy || !restoreFocus.current) return;
    restoreFocus.current = false;
    if (tabActive) input.current?.focus({ preventScroll: true });
  }, [busy, tabActive]);
  useLayoutEffect(() => {
    const field = input.current, box = field?.parentElement;
    if (!field || !box) return;
    // Measuring needs a collapsed textarea. Hold the card at its current height
    // meanwhile: a briefly taller timeline clamps its scrollTop, and the content
    // then sits lower behind the restored composer.
    box.style.minHeight = `${box.offsetHeight}px`;
    field.style.height = "0px";
    field.style.height = `${Math.min(COMPOSER_INPUT_MAX, Math.max(COMPOSER_INPUT_MIN, field.scrollHeight))}px`;
    box.style.minHeight = "";
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
    if (files && (attachments.length + files.length > 8 || files.some(file => file.size < 1 || file.size > fileSizeLimit(file)))) {
      setError(ATTACHMENT_SIZE_RULE); return;
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
  const active = online && snapshot.interactions.length === 0 && !snapshot.vaultPrompts?.length;
  return <footer className="composer" aria-label="Message composer" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (event.dataTransfer.files.length) safely(attach([...event.dataTransfer.files])); }}>
    {error && <p role="alert">{error}</p>}
    {running ? <div className="running-row">
      <div className="agent-running" role="status" aria-live="polite">
        {active ? <span className="running-dots" aria-hidden="true"><span /><span /><span /></span> : null}
        <span>{!online ? "Reconnecting…" : active ? "Agent is running" : "Waiting for your response"}</span>
      </div>
      <button type="button" className="stop-button" aria-label="Stop agent" disabled={!online} onClick={() => safely(window.hermesDesktop.stopThread())}><svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="2" width="8" height="8" rx="2" /></svg><span>Stop</span></button>
    </div> : null}
    {/* ChatGPT-style input card: attachments, borderless textarea, then a tool row with plus and a round send button. */}
    <div className="composer-box" onClick={event => { if (event.target === event.currentTarget || event.target === toolbar.current) input.current?.focus(); }}>
      {attachments.length ? <div className="composer-attachments">{attachments.map(item => <span className="composer-attachment" key={item.id}><AttachmentThumbnail attachment={item} />{item.name}<button type="button" disabled={busy} aria-label={`Remove ${item.name}`} onClick={() => remove(item)}>×</button><button type="button" aria-label={`Preview ${item.name}`} onClick={() => { setError(''); void window.hermesDesktop.previewAttachment(item.id).catch(() => { if (mounted.current) setError('The file could not be previewed.'); }); }}>Preview</button></span>)}</div> : null}
      <textarea ref={input} rows={1} aria-label="Message" placeholder={threadId ? "Message Hermes" : "Choose a thread to write a message"} disabled={!threadId || busy} value={text} onChange={event => update(event.target.value)} onKeyDown={keyDown} onPaste={event => { const files = [...event.clipboardData.files]; if (files.length) { event.preventDefault(); safely(attach(namePastedFiles(files, attachments.map(({ name }) => name)))); } }} />
      <div className="composer-toolbar" ref={toolbar}>
        <button type="button" className="attach-button" onClick={() => safely(attach())} disabled={!threadId || busy || attachments.length >= 8} aria-label="Attach files" title="Attach files"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg></button>
        <button type="button" className="send-button" aria-label="Send message" title="Send message" onClick={() => safely(submit())} disabled={!threadId || busy || (!text.trim() && !attachments.length)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 16V4M5 9l5-5 5 5" /></svg></button>
      </div>
    </div>
  </footer>;
};

export const DesktopShellView = ({ snapshot, viewRole: requestedRole = typeof window !== 'undefined' ? window.hermesDesktop?.getRuntimeInfo?.()?.viewRole ?? 'tab' : 'tab' }: { snapshot: DesktopSnapshot; viewRole?: 'workspace' | 'tab' | 'settings' | 'browser' | 'remote-screen' }) => {
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
  const openSearch = useCallback(() => setEditor({ kind: "palette" }), []);
  const [renameTarget, setRenameTarget] = useState<DesktopSnapshot['threads'][number] | null>(null);
  const [todoBusy, setTodoBusy] = useState(false), [todoError, setTodoError] = useState('');
  useEffect(() => setTodoError(''), [snapshot.selectedThreadId]);
  const [projectEditor, setProjectEditor] = useState<ProjectEditor>(null);
  const [labelTarget, setLabelTarget] = useState<{ thread: DesktopSnapshot['threads'][number]; connectionKey: string | undefined } | null>(null);
  const openLabels = useCallback((thread: DesktopSnapshot['threads'][number]) => setLabelTarget({ thread, connectionKey: snapshot.channels.find(c => c.id === thread.channelId)?.connectionKey ?? snapshot.connectionKey }), [snapshot.channels, snapshot.connectionKey]);
  useEffect(() => { if (labelTarget && (snapshot.connections ? !snapshot.connections.some(row => row.connectionKey === labelTarget.connectionKey) : labelTarget.connectionKey !== snapshot.connectionKey)) setLabelTarget(null); }, [snapshot.connections, snapshot.connectionKey, labelTarget]);
  useEffect(() => {
    const shortcut = (event: globalThis.KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") { setEditor(null); setProjectEditor(null); setRenameTarget(null); return; }
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;

      // Session pages never open their own search: the main process sends Cmd+K to the main window (desktop:open-search).
      if (viewRole === 'workspace' && event.key.toLocaleLowerCase() === "k" && !event.shiftKey) { event.preventDefault(); setEditor({ kind: "palette" }); }
      if (viewRole === 'workspace' && event.key.toLocaleLowerCase() === "f" && event.shiftKey) { event.preventDefault(); setEditor({ kind: "palette", scope: "files" }); }
      // Shift+Cmd+E searches the web for the selected text, in this page's browser panel.
      if (event.key.toLocaleLowerCase() === "e" && event.shiftKey) { const text = pageSelection().trim(); const search = window.hermesDesktop.searchWeb; if (text && search) { event.preventDefault(); safely(search(text.slice(0, 4000))); } return; }
      if (event.key.toLocaleLowerCase() === "n" && snapshot.channels.length) { event.preventDefault(); safely(window.hermesDesktop.newTab(snapshot.selectedChannelId)); }
    };
    window.addEventListener("keydown", shortcut); return () => window.removeEventListener("keydown", shortcut);
  }, [snapshot.selectedChannelId, snapshot.channels.length, editor, viewRole]);
  // Cmd+K from any page opens the search in the main window, over the whole window.
  useEffect(() => viewRole === 'workspace' ? window.hermesDesktop.onOpenSearch?.((scope, text) => setEditor({ kind: "palette", scope, query: text ? { ...emptySessionQuery(), text } : undefined })) : undefined, [viewRole]);
  // A Session page's label click opens the search in the main window with that label.
  useEffect(() => viewRole === 'workspace' ? window.hermesDesktop.onSearchLabel?.(label => setEditor({ kind: "palette", query: { ...emptySessionQuery(), labels: [label] } })) : undefined, [viewRole]);
  // Shift+Cmd+L arrives from the main process for the active Session page only. It acts like a click on the flag button.
  const todoShortcut = useRef<() => void>(undefined);
  useEffect(() => window.hermesDesktop.onToggleTodo?.(() => { if (!document.querySelector('dialog[open]')) todoShortcut.current?.(); }), []);
  if (snapshot.phase === "restoring") return <main className="loading-screen" role="status" aria-live="polite" aria-busy="true">Loading your conversations…</main>;
  if (snapshot.phase === "unpaired" || snapshot.phase === "pairing") return <main className="connection-screen"><PairingPanel busy={snapshot.phase === "pairing"} /><aside className="connection-notice" aria-live="polite">{snapshot.errorMessage ?? snapshot.statusMessage}</aside><SettingsButton className="text-button" /></main>;
  // An Automation tab holds no drafts; it lists conversations and opens them in their own tabs.
  if (viewRole === 'tab' && snapshot.tabKind === 'automation') return <AutomationPage key={snapshot.tabId} snapshot={snapshot} />;
  if (viewRole === 'tab' && snapshot.tabKind === 'automations') return <AutomationListPage key={snapshot.tabId} snapshot={snapshot} />;
  if (snapshot.draftIdentity && (viewRole === 'workspace' ? draftReady === undefined : draftReady !== snapshot.draftIdentity)) return <main className="loading-screen"><p role={draftError ? 'alert' : 'status'}>{draftError || 'Loading your local drafts…'}</p>{draftError && <button onClick={() => setDraftRetry(value => value + 1)}>Try again</button>}</main>;


  const currentThread = snapshot.threads.find(t => t.id === snapshot.selectedThreadId);
  const todo = hasTodo(currentThread?.markers);
  const toggleTodo = () => {
    if (!currentThread || todoBusy) return;
    setTodoBusy(true); setTodoError('');
    void setSessionTodo(currentThread, !todo, snapshot.connectionKey ?? '').catch((error: Error) => setTodoError(error.message)).finally(() => setTodoBusy(false));
  };
  const todoEnabled = snapshot.supportsSessionLabels && snapshot.tabActive === true && snapshot.connectionState === 'online';
  todoShortcut.current = todoEnabled ? toggleTodo : undefined;
  const todoTooltip = `${todo ? 'Remove todo' : 'Mark as todo'} (${globalThis.window?.hermesDesktop?.getRuntimeInfo?.().platform === 'darwin' ? '⇧⌘L' : 'Ctrl+Shift+L'})`;
  const archive = () => { if (snapshot.selectedThreadId && window.confirm("Archive this topic?")) safely(window.hermesDesktop.archiveThread(snapshot.selectedThreadId)); };
  const exportConversation = () => void window.hermesDesktop.exportConversation().then(r => { if (!r.ok) window.alert("Could not export this conversation. Check the connection and try again."); }, () => window.alert("Could not export this conversation. Check the connection and try again."));
  // The status bar tools. Rename and labels need the Session row.
  const sessionAction = (action: StatusAction) => {
    if (action === 'copy-link') safely(window.hermesDesktop.copySessionLink());
    else if (action === 'export') exportConversation();
    else if (action === 'archive') archive();
    else if (action === 'files') setEditor({ kind: "files" });
    else if (currentThread) { if (action === 'rename') setRenameTarget(currentThread); else openLabels(currentThread); }
  };
  const overlays = <>{labelTarget && (snapshot.connections ? snapshot.connections.some(row => row.connectionKey === labelTarget.connectionKey) : labelTarget.connectionKey === snapshot.connectionKey) && <LabelsEditor key={`${labelTarget.connectionKey}:${labelTarget.thread.id}`} thread={labelTarget.thread} snapshot={{ ...snapshot, connectionKey: labelTarget.connectionKey, connectionState: snapshot.connections?.find(row => row.connectionKey === labelTarget.connectionKey)?.state === 'online' ? 'online' : snapshot.connections ? 'blocked' : snapshot.connectionState }} close={() => setLabelTarget(null)} />}{projectEditor && <ProjectDialog key={projectEditor.channelId ?? 'new-project'} snapshot={snapshot} channelId={projectEditor.channelId} close={() => setProjectEditor(null)} />}{editor?.kind === 'palette' && <SessionPicker snapshot={snapshot} initialQuery={editor.query} initialScope={editor.scope} close={() => setEditor(null)} />}{editor?.kind === 'files' && <SessionFilesPanel close={() => setEditor(null)} />}{renameTarget && <RenameDialog key={renameTarget.id} thread={renameTarget} close={() => setRenameTarget(null)} />}</>;
  if (viewRole === 'workspace') return <NativeWorkspace snapshot={snapshot} draftThreads={new Set(snapshot.draftThreadIds ?? [])} onEditLabels={openLabels} onRename={setRenameTarget} onCreateProject={() => setProjectEditor({})} onSearch={openSearch} onProjectOptions={id => setProjectEditor({ channelId: id })} onSettings={() => safely(window.hermesDesktop.openSettings())} overlayOpen={!!editor || !!projectEditor || !!labelTarget || !!renameTarget}>
    {overlays}
  </NativeWorkspace>;
  if (snapshot.tabKind === 'new') return <NewSessionPage key={snapshot.tabId} snapshot={snapshot} />;
  return <main className="session-tab-page" aria-label="Hermes session">
    <ErrorBanner snapshot={snapshot} />{draftError && <div className="error-banner" role="alert">{draftError}</div>}{todoError && <div className="error-banner" role="alert">{todoError}</div>}
    <div className="session-main">
      {/* No title bar or top toolbar: the tab names the Session; the status bar under the composer holds its place, tools and labels. */}
      <Timeline snapshot={snapshot} active={snapshot.tabActive === true} sendVersion={sendVersion} />
    </div>
    {snapshot.interactions.map(item => <section className="interaction-card" key={item.id}><strong>{item.kind === 'approval' ? 'Approval requested' : 'Hermes needs clarification'}</strong><p>{item.prompt}</p><div>{item.choices.map(choice => <button type="button" key={choice} onClick={() => safely(window.hermesDesktop.answerInteraction(item.id, choice))}>{choice}</button>)}</div></section>)}
    {snapshot.vaultPrompts?.map(prompt => <VaultPromptCard key={prompt.id} prompt={prompt} />)}
    <Composer snapshot={snapshot} onQueued={() => setSendVersion(value => value + 1)} />
    <SessionStatusBar snapshot={snapshot} thread={currentThread} todo={todo} todoBusy={todoBusy} todoTooltip={todoTooltip} onToggleTodo={toggleTodo} onAction={sessionAction} />
    {overlays}<TooltipLayer />
  </main>;
};

export const DesktopShell = () => <DesktopShellView snapshot={useDesktopSnapshot()} />;
