import type { HermesClient } from '../../../packages/client/src/index';
import type { Automation } from '../../../packages/client/src/automations';

/** One job row of a list that may merge several connections. */
export type AutomationRow = Readonly<{ key: string; slot: string; connectionName: string; job: Automation }>;
export type AutomationSource = Readonly<{ slot: string; name: string; client?: Pick<HermesClient,
  'hasCapabilities' | 'supportsAutomations' | 'supportsAutomationsPaged' | 'automations' | 'automationsPage'> | null }>;
/** Next page cursor per connection; absent when that connection has no more jobs. */
export type AutomationCursors = ReadonlyMap<string, string>;
export type AutomationLoad = { rows: AutomationRow[]; cursors: Map<string, string>; notes: { key: string; connectionName: string; text: string }[] };

export const AUTOMATION_PAGE = 30;

/** Running first, then the latest run, then name (same order as the desktop sidebar). */
export function sortAutomationRows(rows: AutomationRow[]): AutomationRow[] {
  return rows.sort((a, b) => Number(b.job.running) - Number(a.job.running) || (b.job.lastRunAt ?? '').localeCompare(a.job.lastRunAt ?? '')
    || a.job.name.localeCompare(b.job.name) || a.key.localeCompare(b.key));
}

/** Add a later page; a job that appears again replaces its older copy. */
export function mergeAutomationRows(old: readonly AutomationRow[], added: readonly AutomationRow[]): AutomationRow[] {
  const byKey = new Map(old.map(row => [row.key, row]));
  for (const row of added) byKey.set(row.key, row);
  return sortAutomationRows([...byKey.values()]);
}

/**
 * First page of every connection, or (with `cursors`) the next page of the
 * connections that have more. Servers without paging return all jobs at once.
 * `channel` keeps one channel's jobs (one connection only).
 */
export async function loadAutomationRows(sources: readonly AutomationSource[], options: { cursors?: AutomationCursors; channel?: string } = {}): Promise<AutomationLoad> {
  const result: AutomationLoad = { rows: [], cursors: new Map(), notes: [] };
  await Promise.all(sources.map(async source => {
    const client = source.client;
    const after = options.cursors?.get(source.slot);
    if (options.cursors && after === undefined) return;  // that connection is complete
    if (!client?.hasCapabilities) { result.notes.push({ key: source.slot, connectionName: source.name, text: 'Connecting…' }); return; }
    if (!client.supportsAutomations) { result.notes.push({ key: source.slot, connectionName: source.name, text: 'Automations are not available on this connection yet.' }); return; }
    try {
      let jobs: readonly Automation[];
      if (client.supportsAutomationsPaged) {
        const page = await client.automationsPage({ limit: AUTOMATION_PAGE, after, channel: options.channel });
        jobs = page.automations;
        if (page.nextAfter) result.cursors.set(source.slot, page.nextAfter);
      } else {
        const all = await client.automations();
        jobs = options.channel ? all.filter(job => job.targets.some(target => target.channelId === options.channel)) : all;
      }
      for (const job of jobs) result.rows.push({ key: `${source.slot}:${job.id}`, slot: source.slot, connectionName: source.name, job });
    } catch {
      result.notes.push({ key: source.slot, connectionName: source.name, text: 'Could not load automations. Pull down to try again.' });
    }
  }));
  sortAutomationRows(result.rows);
  return result;
}

/** After Run: the run has started or finished once the job reports it. */
export function runStarted(before: Pick<Automation, 'running' | 'lastRunAt'>, now: Pick<Automation, 'running' | 'lastRunAt'>): boolean {
  return now.running || (now.lastRunAt ?? '') !== (before.lastRunAt ?? '');
}
