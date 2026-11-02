import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import type { ClientLogReport, HermesClient } from '../../../packages/client/src/index';

/**
 * Developer diagnostics: the app reports its own crashes to the connected
 * Hermes servers (`POST /v1/client-logs`). Reports never appear in the UI.
 * Pending reports are kept in one device file so a fatal crash is sent on
 * the next start. Delivery is best effort and never blocks the app.
 */
const MAX_PENDING = 20;
type Sink = Pick<HermesClient, 'reportClientLog'>;
let sinks: readonly Sink[] = [];
let pending: ClientLogReport[] = [];
let sending = false;
let installed = false;

const store = () => new File(Paths.document, 'hermes-client-logs.json');

function save() {
  try {
    const file = store();
    if (!pending.length) { if (file.exists) file.delete(); return; }
    if (!file.exists) file.create();
    file.writeSync(JSON.stringify(pending));
  } catch { /* diagnostics must never fail the app */ }
}

function load() {
  try {
    const file = store();
    if (!file.exists) return;
    const value: unknown = JSON.parse(file.textSync());
    if (Array.isArray(value)) pending = value.filter(item => item && typeof item === 'object' && typeof item.kind === 'string').slice(-MAX_PENDING) as ClientLogReport[];
  } catch { pending = []; }
}

function base(): Pick<ClientLogReport, 'platform' | 'os_version' | 'app_version' | 'runtime_version' | 'client_time'> {
  const runtime = Constants.expoConfig?.runtimeVersion;
  return {
    platform: Platform.OS, os_version: String(Platform.Version),
    app_version: Constants.expoConfig?.version ?? '', runtime_version: typeof runtime === 'string' ? runtime : 'exposdk:' + (Constants.expoConfig?.sdkVersion ?? ''),
    client_time: new Date().toISOString(),
  };
}

function describe(error: unknown): { message: string; stack: string } {
  if (error instanceof Error) return { message: `${error.name}: ${error.message}`, stack: error.stack ?? '' };
  try { return { message: typeof error === 'string' ? error : JSON.stringify(error) ?? String(error), stack: '' }; }
  catch { return { message: String(error), stack: '' }; }
}

let currentRoute = '';
/** The open route path, recorded with each report. */
export function setClientLogRoute(route: string) { currentRoute = route; }

export function reportClientError(kind: ClientLogReport['kind'], error: unknown, extra: { componentStack?: string; fatal?: boolean } = {}) {
  const { message, stack } = describe(error);
  const report: ClientLogReport = { kind, message: message || '(no message)', stack, route: currentRoute, ...base(),
    ...(extra.componentStack ? { component_stack: extra.componentStack } : {}), ...(extra.fatal !== undefined ? { fatal: extra.fatal } : {}) };
  pending = [...pending, report].slice(-MAX_PENDING);
  save();
  void flush();
}

async function flush() {
  if (sending || !sinks.length || !pending.length) return;
  sending = true;
  try {
    while (pending.length && sinks.length) {
      const report = pending[0];
      // One server that stores the report is enough; try each connection in turn.
      let stored = false;
      for (const sink of sinks) {
        try { await sink.reportClientLog(report); stored = true; break; } catch { /* next connection */ }
      }
      if (!stored) break;
      pending = pending.slice(1);
      save();
    }
  } finally { sending = false; }
}

/** The connected clients that can receive reports. Pending reports are sent at once. */
export function setClientLogSinks(next: readonly Sink[]) { sinks = next; void flush(); }

type Handler = (error: unknown, isFatal?: boolean) => void;
type ErrorUtilsShape = { getGlobalHandler(): Handler; setGlobalHandler(handler: Handler): void };
type HermesShape = { enablePromiseRejectionTracker?: (options: { allRejections: boolean; onUnhandled: (id: number, error: unknown) => void; onHandled: () => void }) => void };

/** Captures uncaught JS errors and unhandled promise rejections once per process. */
export function installClientLogs() {
  if (installed) return;
  installed = true;
  load();
  const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsShape }).ErrorUtils;
  if (errorUtils) {
    const previous = errorUtils.getGlobalHandler();
    errorUtils.setGlobalHandler((error, isFatal) => {
      reportClientError(isFatal ? 'fatal' : 'error', error, { fatal: !!isFatal });
      previous(error, isFatal);
    });
  }
  const hermes = (globalThis as { HermesInternal?: HermesShape }).HermesInternal;
  // Release builds install no rejection tracker; development keeps React Native's own.
  if (!__DEV__ && hermes?.enablePromiseRejectionTracker) {
    hermes.enablePromiseRejectionTracker({ allRejections: true, onUnhandled: (_id, error) => reportClientError('unhandled_rejection', error), onHandled: () => {} });
  }
}
