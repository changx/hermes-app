import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { DesktopAutomation, DesktopAutomationList, DesktopAutomationPage, DesktopSnapshot, DesktopThread } from '../shared/desktop-api';
import type { AutomationThread } from '../../../../packages/client/src/automations';
import { automationStatus, automationTiming, scheduleLabel } from '../../../../packages/client/src/automationText';
import { unreadCountDescription, unreadCountLabel } from '../../../../packages/client/src/projectDirectory';
import { Icon } from './icons';

const COLLAPSED_KEY = 'hermes.sidebar.automations-collapsed';
const loadCollapsed = () => { try { return window.localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; } };
/** Directory changes (new results, reads) refresh counts after this pause; one refresh per burst. */
export const AUTOMATION_REFRESH_DELAY = 1500;
const REFRESH_INTERVAL = 60_000;

const statusClass = (job: DesktopAutomation) => job.running ? ' automation-running' : job.failed && job.state !== 'completed' ? ' automation-failed' : '';
/** Only states that need attention appear on the sidebar row; the tooltip has the full status. */
const rowStatus = (job: DesktopAutomation) => job.running || job.failed && job.state !== 'completed' || !job.enabled && job.state !== 'completed' ? automationStatus(job) : undefined;

/**
 * Sidebar Automations, above Recents: the scheduled jobs of every connection
 * that offers them. Hidden while no connection does. A row opens the job's tab.
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
  return <section className="sidebar-automations" aria-labelledby="sidebar-automations-title">
    <div className="sidebar-section-header">
      <h2 className="sidebar-section-title"><button type="button" className="sidebar-section-toggle" id="sidebar-automations-title" aria-expanded={!collapsed} aria-controls="sidebar-automations-list" onClick={toggle}>
        <span>Automations</span><Icon name={collapsed ? 'chevronRight' : 'chevronDown'} className="sidebar-section-chevron" /></button></h2>
    </div>
    {!collapsed && <div className="item-list recent-list automation-list" id="sidebar-automations-list">
      {list.automations.map(job => {
        const status = rowStatus(job), selected = job.id === activeAutomationId;
        const hint = [automationStatus(job), scheduleLabel(job.schedule), automationTiming(job), multiple ? job.connectionName : undefined].filter(Boolean).join(' · ');
        return <button key={job.id} type="button" className={`tree-thread automation-row${selected ? ' selected' : ''}`} title={hint} aria-current={selected ? 'page' : undefined}
          aria-label={[job.name, automationStatus(job), multiple ? job.connectionName : undefined, unreadCountDescription(job.unreadCount)].filter(Boolean).join(', ')}
          onClick={() => void window.hermesDesktop.openAutomation(job.id, job.name).catch(() => {})}>
          <span className="thread-row-main">
            <span className="thread-title">{job.name}</span>
            {multiple && job.connectionName ? <span className="thread-connection-name">{job.connectionName}</span> : null}
            {status ? <span className={`automation-row-status${statusClass(job)}`}>{status}</span> : null}
            {job.unreadCount > 0 ? <span className="project-unread-count" aria-hidden="true">{unreadCountLabel(job.unreadCount)}</span> : null}
          </span>
        </button>;
      })}
      {!list.automations.length && !failed.length && <p className="tree-empty">No automations yet</p>}
      {failed.map(text => <p key={text} className="tree-empty">{text}</p>)}
    </div>}
  </section>;
});

/** An Automation tab: what the job does, where it delivers, and the conversations it produced. */
export function AutomationPage({ snapshot }: { snapshot: DesktopSnapshot }) {
  const [page, setPage] = useState<DesktopAutomationPage | null>(null);
  const [threads, setThreads] = useState<readonly AutomationThread[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState(''), [more, setMore] = useState(false), [showPrompt, setShowPrompt] = useState(false);
  const generation = useRef(0);
  const active = snapshot.tabActive === true;
  const load = useCallback(async () => {
    const version = ++generation.current;
    try {
      const result = await window.hermesDesktop.getAutomation();
      if (version !== generation.current) return;
      setPage(result); setError('');
      if (result.state === 'ok') { setThreads(result.threads); setNext(result.nextBefore); }
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
  const loadMore = async () => {
    if (next === null || more) return;
    setMore(true);
    try {
      const result = await window.hermesDesktop.getAutomation(next);
      if (result.state === 'ok') { setThreads(old => [...old, ...result.threads.filter(t => !old.some(o => o.id === t.id))]); setNext(result.nextBefore); }
    } catch { setError('Could not load more conversations. Try again.'); }
    finally { setMore(false); }
  };
  if (!page) return <main className="automation-page" aria-label="Automation">{error
    ? <div className="automation-column"><p role="alert" className="automation-error">{error}</p><button type="button" className="automation-link" onClick={() => void load()}>Try again</button></div>
    : <div className="conversation-empty" role="status" aria-busy="true"><span className="conversation-loading-spinner" aria-hidden="true" /><h3>Loading…</h3></div>}</main>;
  if (page.state !== 'ok') return <main className="automation-page" aria-label="Automation"><div className="automation-column">
    <p className="automation-notice">{page.state === 'missing' ? 'This automation no longer exists.' : 'Automations are not available on this connection yet.'}</p></div></main>;
  const job = page.automation;
  const projectName = (id: string) => snapshot.channels.find(c => c.id === id)?.name;
  const live = new Map(snapshot.threads.map(t => [t.id, t]));
  return <main className="automation-page" aria-label={`Automation: ${job.name}`}>
    <div className="automation-column">
      <header className="automation-header">
        <h1>{job.name}</h1>
        <p className={`automation-status${statusClass(job)}`}>{automationStatus(job)}</p>
        <p className="automation-line">{[scheduleLabel(job.schedule), automationTiming(job)].filter(Boolean).join(' · ')}</p>
        {job.targets.map(target => <p className="automation-line" key={target.channelId + (target.threadId ?? '')}>
          {target.mode === 'new' ? 'New conversation each run in ' : 'Adds each run to one conversation in '}{projectName(target.channelId) ?? 'a project that is no longer available'}
        </p>)}
        {!job.targets.length && <p className="automation-line">Results are not delivered to a project.</p>}
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
