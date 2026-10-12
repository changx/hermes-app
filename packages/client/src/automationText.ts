import type { Automation } from './automations';

/** Plain-language state of one job for its list row and detail page. */
export function automationStatus(job: Pick<Automation, 'running' | 'enabled' | 'state' | 'failed'>): string {
  if (job.running) return 'Running';
  if (job.state === 'completed') return 'Finished';
  if (!job.enabled) return 'Paused';
  if (job.failed) return 'Last run failed';
  return 'Scheduled';
}

const time = (value: string | undefined, now: Date): string | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const sameDay = date.toDateString() === now.toDateString();
  const clock = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return sameDay ? clock : `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${clock}`;
};

/** Second line of a job row: next run while active, otherwise the last run. */
export function automationTiming(job: Pick<Automation, 'enabled' | 'state' | 'nextRunAt' | 'lastRunAt'>, now = new Date()): string {
  const next = job.enabled && job.state !== 'completed' ? time(job.nextRunAt, now) : undefined;
  if (next) return `Next ${next}`;
  const last = time(job.lastRunAt, now);
  return last ? `Last ${last}` : 'Not run yet';
}

/** Schedule text from core, e.g. `every 1440m`, shown in hours or days when exact. */
export function scheduleLabel(schedule: string): string {
  const every = /^every (\d+)m$/.exec(schedule.trim());
  if (!every) return schedule;
  const minutes = Number(every[1]);
  if (minutes % 1440 === 0) return minutes === 1440 ? 'Every day' : `Every ${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? 'Every hour' : `Every ${minutes / 60} hours`;
  return `Every ${minutes} minutes`;
}
