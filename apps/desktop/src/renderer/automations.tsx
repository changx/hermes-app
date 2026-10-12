import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { DesktopAutomation, DesktopAutomationControl, DesktopAutomationList, DesktopAutomationPage, DesktopSnapshot, DesktopThread } from '../shared/desktop-api';
import type { AutomationThread } from '../../../../packages/client/src/automations';
import { automationStatus, automationTiming, scheduleLabel } from '../../../../packages/client/src/automationText';
import { unreadCountDescription, unreadCountLabel } from '../../../../packages/client/src/projectDirectory';
import { Icon } from './icons';

const COLLAPSED_KEY = 'hermes.sidebar.automations-collapsed';
const loadCollapsed = () => { try { return window.localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; } };
/** Directory changes (new results, reads) refresh counts after this pause; one refresh per burst. */
export const AUTOMATION_REFRESH_DELAY = 1500;
const REFRESH_INTERVAL = 60_000;
/** The sidebar shows this many jobs; Show all opens the Automations tab with every job. */
export const SIDEBAR_AUTOMATIONS = 8;
const START_WATCH_MS = 120_000, START_POLL_MS = 4_000;

const statusClass = (job: DesktopAutomation) => job.running ? ' automation-running' : job.failed && job.state !== 'completed' ? ' automation-failed' : '';
/** Only states that need attention appear on the sidebar row; the tooltip has the full status. */
const rowStatus = (job: DesktopAutomation) => job.running || job.failed && job.state !== 'completed' || !job.enabled && job.state !== 'completed' ? automationStatus(job) : undefined;
const hasMore = (list: DesktopAutomationList) => Object.keys(list.cursors ?? {}).length > 0;
const sortJobs = (rows: DesktopAutomation[]) => rows.sort((a, b) => Number(b.running) - Number(a.running)
  || (b.lastRunAt ?? '').localeCompare(a.lastRunAt ?? '') || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

function AutomationRow({ job, selected, multiple }: { job: DesktopAutomation; selected: boolean; multiple: boolean }) {
  const status = rowStatus(job);
  const hint = [automationStatus(job), scheduleLabel(job.schedule), automationTiming(job), multiple ? job.connectionName : undefined].filter(Boolean).join(' · ');
  return <button type="button" className={`tree-thread automation-row${selected ? ' selected' : ''}`} title={hint} aria-current={selected ? 'page' : undefined}
    aria-label={[job.name, automationStatus(job), multiple ? job.connectionName : undefined, unreadCountDescription(job.unreadCount)].filter(Boolean).join(', ')}
    onClick={() => void window.hermesDesktop.openAutomation(job.id, job.name).catch(() => {})}>
    <span className="thread-row-main">
      <span className="thread-title">{job.name}</span>
      {multiple && job.connectionName ? <span className="thread-connection-name">{job.connectionName}</span> : null}
      {status ? <span className={`automation-row-status${statusClass(job)}`}>{status}</span> : null}
      {job.unreadCount > 0 ? <span className="project-unread-count" aria-hidden="true">{unreadCountLabel(job.unreadCount)}</span> : null}
    </span>
  </button>;
}

/**
 * Sidebar Automations, above Recents: the first jobs of every connection that
 * offers them, and Show all for the rest. Hidden while no connection does. A
 * row opens the job's tab; + opens New automation.
 */
export const AutomationsSection = memo(({ connectionStates, threads, activeAutomationId, multiple }: {
  /** Changes when a connection comes online or goes away. */ connectionStates: string;
  /** Directory identity: a change means new results or reads may have changed the counts. */ threads: readonly DesktopThread[];
  activeAutomationId?: string; multiple: boolean;
}) => {
  const [list, setList] = useState<DesktopAutomationList | null>(null);
  const [error, setError] = useState(false);
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const version = ++generation.current;
    try { const next = await window.hermesDesktop.listAutomations(); if (version === generation.current) { setList(next); setError(false); } }
    catch { if (version === generation.current) setError(true); }
  }, []);
  useEffect(() => { void load(); }, [connectionStates, load]);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const timer = window.setTimeout(() => void load(), AUTOMATION_REFRESH_DELAY);
    return () => window.clearTimeout(timer);
  }, [threads, load]);
  useEffect(() => {
    const timer = window.setInterval(() => void load(), REFRESH_INTERVAL);
    const focus = () => void load();
    window.addEventListener('focus', focus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [load]);
  if (!list?.supported && !list?.automations.length) return null;
  const toggle = () => setCollapsed(old => { const next = !old; try { window.localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0'); } catch { /* Device preference only. */ } return next; });
  const failed = error ? ['Could not load automations. Hermes tries again shortly.']
    : list.failed.map(name => multiple ? `Could not load automations from ${name}.` : 'Could not load automations. Hermes tries again shortly.');
  const shown = list.automations.slice(0, SIDEBAR_AUTOMATIONS);
  const more = list.automations.length > SIDEBAR_AUTOMATIONS || hasMore(list);
  return <section className="sidebar-automations" aria-labelledby="sidebar-automations-title">
    <div className="sidebar-section-header">
      <h2 className="sidebar-section-title"><button type="button" className="sidebar-section-toggle" id="sidebar-automations-title" aria-expanded={!collapsed} aria-controls="sidebar-automations-list" onClick={toggle}>
        <span>Automations</span><Icon name={collapsed ? 'chevronRight' : 'chevronDown'} className="sidebar-section-chevron" /></button></h2>
      {list.canCreate && <button type="button" className="sidebar-section-action" aria-label="New automation" title="New automation"
        onClick={() => void window.hermesDesktop.newTab(undefined, true).catch(() => {})}>+</button>}
    </div>
    {!collapsed && <div className="item-list recent-list automation-list" id="sidebar-automations-list">
      {shown.map(job => <AutomationRow key={job.id} job={job} selected={job.id === activeAutomationId} multiple={multiple} />)}
      {more && <button type="button" className="tree-thread automation-show-all" onClick={() => void window.hermesDesktop.openAutomationList().catch(() => {})}>
        <span className="thread-row-main"><span className="thread-title">Show all</span></span></button>}
      {!list.automations.length && !failed.length && <p className="tree-empty">No automations yet</p>}
      {failed.map(text => <p key={text} className="tree-empty">{text}</p>)}
    </div>}
  </section>;
});

/** The Automations tab: every job of every connection, loaded page by page. */
export function AutomationListPage({ snapshot }: { snapshot: DesktopSnapshot }) {
  const [rows, setRows] = useState<DesktopAutomation[] | null>(null);
  const [cursors, setCursors] = useState<Readonly<Record<string, string>>>({});
  const [canCreate, setCanCreate] = useState(false), [failed, setFailed] = useState<readonly string[]>([]);
  const [error, setError] = useState(''), [more, setMore] = useState(false);
  const generation = useRef(0), end = useRef<HTMLDivElement>(null);
  const active = snapshot.tabActive === true, multiple = (snapshot.connections?.length ?? 0) > 1;
  const load = useCallback(async () => {
    const version = ++generation.current;
    try {
      const list = await window.hermesDesktop.listAutomations();
      if (version !== generation.current) return;
      setRows([...list.automations]); setCursors(list.cursors ?? {}); setCanCreate(list.canCreate === true); setFailed(list.failed); setError('');
    } catch { if (version === generation.current) setError('Could not load automations. Check the connection and try again.'); }
  }, []);
  useEffect(() => { if (active) void load(); }, [active, load]);
  const loadMore = useCallback(async () => {
    if (more || !Object.keys(cursors).length) return;
    const version = generation.current;
    setMore(true);
    try {
      const list = await window.hermesDesktop.listAutomations(cursors);
      if (version !== generation.current) return;
      setRows(old => { const byId = new Map((old ?? []).map(job => [job.id, job])); for (const job of list.automations) byId.set(job.id, job); return sortJobs([...byId.values()]); });
      setCursors(list.cursors ?? {});
    } catch { setError('Could not load more automations. Try again.'); }
    finally { setMore(false); }
  }, [cursors, more]);
  // Load the next page when the end of the list scrolls into view.
  useEffect(() => {
    const node = end.current;
    if (!node || !Object.keys(cursors).length) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) void loadMore(); });
    observer.observe(node);
    return () => observer.disconnect();
  }, [cursors, loadMore]);
  return <main className="automation-page" aria-label="Automations">
    <div className="automation-column">
      <header className="automation-header automation-list-header">
        <h1>Automations</h1>
        {canCreate && <button type="button" className="automation-action automation-primary" onClick={() => void window.hermesDesktop.newTab(undefined, true).catch(() => setError('Could not open New automation. Try again.'))}>New automation</button>}
      </header>
      {!!error && <p role="alert" className="automation-error">{error}</p>}
      {rows === null && !error && <div className="conversation-empty" role="status" aria-busy="true"><span className="conversation-loading-spinner" aria-hidden="true" /><h3>Loading…</h3></div>}
      <div className="automation-threads">
        {rows?.map(job => <button key={job.id} type="button" className="automation-thread" onClick={() => void window.hermesDesktop.openAutomation(job.id, job.name).catch(() => {})}
          aria-label={[job.name, automationStatus(job), multiple ? job.connectionName : undefined, unreadCountDescription(job.unreadCount)].filter(Boolean).join(', ')}>
          <span className="automation-thread-text">
            <span className="automation-thread-title">{job.name}</span>
            <span className="automation-thread-details">{[automationStatus(job), scheduleLabel(job.schedule), automationTiming(job), multiple ? job.connectionName : undefined].filter(Boolean).join(' · ')}</span>
          </span>
          {job.unreadCount > 0 && <span className="project-unread-count" aria-hidden="true">{unreadCountLabel(job.unreadCount)}</span>}
        </button>)}
        {rows && !rows.length && !failed.length && <p className="automation-empty">No automations yet.</p>}
        {failed.map(name => <p key={name} className="automation-empty">{multiple ? `Could not load automations from ${name}.` : 'Could not load automations.'}</p>)}
        <div ref={end} aria-hidden="true" />
        {Object.keys(cursors).length > 0 && <button type="button" className="automation-link automation-more" disabled={more} onClick={() => void loadMore()}>{more ? 'Loading…' : 'Show more'}</button>}
      </div>
    </div>
  </main>;
}

/** An Automation tab: what the job does, where it delivers, its controls, and the conversations it produced. */
export function AutomationPage({ snapshot }: { snapshot: DesktopSnapshot }) {
  const [page, setPage] = useState<DesktopAutomationPage | null>(null);
  const [threads, setThreads] = useState<readonly AutomationThread[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState(''), [more, setMore] = useState(false), [showPrompt, setShowPrompt] = useState(false);
  const [acting, setActing] = useState<string | null>(null), [schedule, setSchedule] = useState<string | null>(null);
  // After Run: the job before the run, until the job reports it (or two minutes pass).
  const [starting, setStarting] = useState<{ before: DesktopAutomation; since: number } | null>(null);
  const generation = useRef(0);
  const active = snapshot.tabActive === true;
  const load = useCallback(async () => {
    const version = ++generation.current;
    try {
      const result = await window.hermesDesktop.getAutomation();
      if (version !== generation.current) return;
      setPage(result); setError('');
      if (result.state === 'ok') {
        setThreads(result.threads); setNext(result.nextBefore);
        setStarting(old => old && (result.automation.running || (result.automation.lastRunAt ?? '') !== (old.before.lastRunAt ?? '')
          || Date.now() - old.since > START_WATCH_MS) ? null : old);
      }
    } catch { if (version === generation.current) setError('Could not load this automation. Check the connection and try again.'); }
  }, []);
  // Reload when the tab comes to the front: reading a conversation clears its unread mark.
  useEffect(() => { if (active) void load(); }, [active, load]);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!active) return;
    const timer = window.setTimeout(() => void load(), AUTOMATION_REFRESH_DELAY);
    return () => window.clearTimeout(timer);
  }, [snapshot.threads, active, load]);
  // Run takes effect at the next scheduler tick (up to a minute): check until the run shows.
  useEffect(() => {
    if (!starting || !active) return;
    const timer = window.setInterval(() => void load(), START_POLL_MS);
    return () => window.clearInterval(timer);
  }, [starting, active, load]);
  const loadMore = async () => {
    if (next === null || more) return;
    setMore(true);
    try {
      const result = await window.hermesDesktop.getAutomation(next);
      if (result.state === 'ok') { setThreads(old => [...old, ...result.threads.filter(t => !old.some(o => o.id === t.id))]); setNext(result.nextBefore); }
    } catch { setError('Could not load more conversations. Try again.'); }
    finally { setMore(false); }
  };
  const control = async (name: DesktopAutomationControl, failure: string, value?: string): Promise<boolean> => {
    if (acting || page?.state !== 'ok') return false;
    const before = page.automation;
    setActing(name); setError('');
    try {
      const job = await window.hermesDesktop.controlAutomation(name, value);
      setPage(old => old?.state === 'ok' ? { ...old, automation: job } : old);
      if (name === 'run') setStarting({ before, since: Date.now() });
      return true;
    } catch { setError(failure); return false; }
    finally { setActing(null); }
  };
  const editInConversation = async () => {
    if (acting) return;
    setActing('editor'); setError('');
    try { await window.hermesDesktop.selectThread(await window.hermesDesktop.openAutomationEditor()); }
    catch { setError('Could not open the settings conversation. Try again.'); }
    finally { setActing(null); }
  };
  if (!page) return <main className="automation-page" aria-label="Automation">{error
    ? <div className="automation-column"><p role="alert" className="automation-error">{error}</p><button type="button" className="automation-link" onClick={() => void load()}>Try again</button></div>
    : <div className="conversation-empty" role="status" aria-busy="true"><span className="conversation-loading-spinner" aria-hidden="true" /><h3>Loading…</h3></div>}</main>;
  if (page.state !== 'ok') return <main className="automation-page" aria-label="Automation"><div className="automation-column">
    <p className="automation-notice">{page.state === 'missing' ? 'This automation no longer exists.' : 'Automations are not available on this connection yet.'}</p></div></main>;
  const job = page.automation;
  const projectName = (id: string) => snapshot.channels.find(c => c.id === id)?.name;
  const live = new Map(snapshot.threads.map(t => [t.id, t]));
  const can = (name: DesktopAutomationControl) => job.controls.includes(name);
  const saveSchedule = async () => {
    if (schedule === null || !schedule.trim()) return;
    if (await control('schedule', 'This schedule was not understood. Try "every day at 9am", "every 2h" or "0 9 * * 1-5".', schedule.trim())) setSchedule(null);
  };
  return <main className="automation-page" aria-label={`Automation: ${job.name}`}>
    <div className="automation-column">
      <header className="automation-header">
        <h1>{job.name}</h1>
        <p className={`automation-status${statusClass(job)}`}>{starting ? 'Starting…' : automationStatus(job)}</p>
        <p className="automation-line">{[scheduleLabel(job.schedule), automationTiming(job)].filter(Boolean).join(' · ')}</p>
        {job.targets.map(target => <p className="automation-line" key={target.channelId + (target.threadId ?? '')}>
          {target.mode === 'new' ? 'New conversation each run in ' : 'Adds each run to one conversation in '}{projectName(target.channelId) ?? 'a project that is no longer available'}
        </p>)}
        {!job.targets.length && <p className="automation-line">Results are not delivered to a project.</p>}
        {job.controls.length > 0 && <div className="automation-actions">
          {can('pause') && <button type="button" className="automation-action" disabled={!!acting} onClick={() => void control('pause', 'Could not pause. Try again.')}>Pause</button>}
          {can('resume') && <button type="button" className="automation-action" disabled={!!acting} onClick={() => void control('resume', 'Could not resume. Try again.')}>Resume</button>}
          {can('run') && <button type="button" className="automation-action" disabled={!!acting || !!starting} onClick={() => void control('run', 'Could not start the run. Try again.')}>Run now</button>}
          {can('schedule') && schedule === null && <button type="button" className="automation-action" disabled={!!acting} onClick={() => setSchedule(job.schedule)}>Change schedule</button>}
          {job.editorChannelId !== undefined && <button type="button" className="automation-action" disabled={!!acting} onClick={() => void editInConversation()}>Edit in conversation</button>}
        </div>}
        {schedule !== null && <form className="automation-schedule" onSubmit={event => { event.preventDefault(); void saveSchedule(); }}>
          <label>Schedule<input autoFocus value={schedule} maxLength={200} onChange={event => setSchedule(event.target.value)}
            onKeyDown={event => { if (event.key === 'Escape') setSchedule(null); }} /></label>
          <span className="automation-hint">Examples: every day at 9am · weekdays at 8:30am · every 2h · 0 9 * * 1-5</span>
          <div><button type="button" className="automation-action" onClick={() => setSchedule(null)}>Cancel</button>
            <button type="submit" className="automation-action automation-primary" disabled={acting === 'schedule' || !schedule.trim()}>{acting === 'schedule' ? 'Saving…' : 'Save'}</button></div>
        </form>}
        {!!job.prompt && <button type="button" className="automation-link" aria-expanded={showPrompt} onClick={() => setShowPrompt(v => !v)}>{showPrompt ? 'Hide instructions' : 'Show instructions'}</button>}
        {showPrompt && !!job.prompt && <pre className="automation-prompt">{job.prompt}</pre>}
        {!!error && <p role="alert" className="automation-error">{error}</p>}
      </header>
      <h2 className="automation-section">Conversations</h2>
      <div className="automation-threads">
        {threads.map(item => {
          const thread = live.get(item.id), unread = thread ? thread.completedUnread === true : item.completedUnread;
          const details = [projectName(item.channelId), item.runs > 1 ? `${item.runs} results` : undefined].filter(Boolean).join(' · ');
          return <button key={item.id} type="button" className="automation-thread" disabled={!thread}
            aria-label={[thread?.title ?? item.title, details, thread?.running ? 'Running' : undefined, unread ? 'Completed, unread' : undefined, thread ? undefined : 'No longer available'].filter(Boolean).join(', ')}
            onClick={() => void window.hermesDesktop.selectThread(item.id).catch(() => setError('Could not open this conversation. Try again.'))}>
            <span className="automation-thread-text">
              <span className="automation-thread-title">{thread?.title ?? item.title}</span>
              <span className="automation-thread-details">{thread ? details : 'No longer available'}</span>
            </span>
            {thread?.running && <span className="thread-status">Running</span>}
            {unread && <span className="thread-result-unread" role="img" aria-label="Completed, unread" />}
          </button>;
        })}
        {!threads.length && <p className="automation-empty">No conversations yet. They appear here after a run delivers its result.</p>}
        {next !== null && <button type="button" className="automation-link automation-more" disabled={more} onClick={() => void loadMore()}>{more ? 'Loading…' : 'Show more'}</button>}
      </div>
    </div>
  </main>;
}
