import type { UpdateState } from './updater';

/** Actions of the update item in the app menu. */
export type UpdateMenuAction = 'check' | 'restart';

/** "42%" of the download, or nothing before the first byte. */
export const downloadPercent = (state: UpdateState): number | undefined =>
  state.total && state.received !== undefined ? Math.min(100, Math.floor(state.received * 100 / state.total)) : undefined;

/** "52 of 128 MB". */
const megabytes = (state: UpdateState): string =>
  state.total ? `${Math.floor((state.received ?? 0) / 1_048_576)} of ${Math.round(state.total / 1_048_576)} MB` : '';

/** The update item under "About Hermes": what it says and what it does in each update state. */
export const updateMenuItem = (state: UpdateState): { label: string; enabled: boolean; action: UpdateMenuAction } => {
  switch (state.phase) {
    case 'ready': return { label: state.available ? `Restart to Update to ${state.available}` : 'Restart to Update', enabled: true, action: 'restart' };
    case 'checking': return { label: 'Checking for Updates…', enabled: false, action: 'check' };
    case 'downloading': {
      const value = downloadPercent(state);
      return { label: `Downloading Update${state.available ? ` ${state.available}` : ''}…${value !== undefined ? ` ${value}%` : ''}`, enabled: false, action: 'check' };
    }
    case 'preparing': return { label: 'Preparing Update…', enabled: false, action: 'check' };
    case 'error': return { label: 'Update Failed – Try Again', enabled: true, action: 'check' };
    default: return { label: 'Check for Updates…', enabled: true, action: 'check' };
  }
};

export type UpdateDialog = { message: string; detail?: string; buttons: string[]; restartButton?: number };

const failureText = (state: UpdateState): { message: string; detail: string } => {
  switch (state.failure) {
    case 'damaged': return { message: 'The downloaded update was damaged.', detail: 'Hermes deleted it and downloads it again in 15 minutes. Choose Check for Updates to try now.' };
    case 'verify': return { message: 'Hermes could not install the update.', detail: 'macOS did not accept the downloaded version. Hermes tries again in 15 minutes. If this happens again, install the newest version from the download page.' };
    default: return state.available
      ? { message: `Hermes ${state.available} could not be downloaded.`, detail: 'The connection stopped. Hermes continues the download in 15 minutes. Choose Check for Updates to continue now.' }
      : { message: 'Hermes could not check for updates.', detail: 'Check the network connection. Hermes tries again in 15 minutes.' };
  }
};

/** The answer to "Check for Updates…" (a check the user asked for). */
export const updateCheckDialog = (state: UpdateState): UpdateDialog => {
  switch (state.phase) {
    case 'ready':
      return { message: state.available ? `Hermes ${state.available} is ready to install.` : 'A new version of Hermes is ready to install.', detail: 'Restart Hermes now to finish the update, or it installs when you next quit Hermes.', buttons: ['Restart Now', 'Later'], restartButton: 0 };
    case 'downloading': {
      const value = downloadPercent(state);
      const progress = value ? ` (${value}%)` : '';
      return { message: state.available ? `Hermes ${state.available} is downloading${progress}.` : `A new version of Hermes is downloading${progress}.`,
        detail: 'You can keep working. The Dock icon and the Hermes menu show the progress. Hermes tells you when the update is ready.', buttons: ['OK'] };
    }
    case 'preparing':
      return { message: 'Hermes is preparing the update.', detail: 'Hermes tells you when the update is ready.', buttons: ['OK'] };
    case 'unsupported':
      return state.reason === 'not-in-applications'
        ? { message: 'Move Hermes to the Applications folder to get updates.', detail: 'Quit Hermes, drag it from the disk image or Downloads to Applications, and open it from there.', buttons: ['OK'] }
        : { message: 'Updates are available only in the installed app.', buttons: ['OK'] };
    case 'error': return { ...failureText(state), buttons: ['OK'] };
    default:
      return { message: 'Hermes is up to date.', detail: `Version ${state.version} is the newest version.`, buttons: ['OK'] };
  }
};

/** The version for the title-bar "Update ready · Restart" button: only while an update is ready. */
export const updateReadyVersion = (state: UpdateState): string | undefined =>
  state.phase === 'ready' ? state.available ?? '' : undefined;

export type UpdateNotice = { key: string; title: string; body: string; restart: boolean };

/**
 * A system notification when an update becomes ready or a download fails. `key` lets the app show
 * each notice once per version.
 */
export const updateNotice = (state: UpdateState): UpdateNotice | undefined => {
  if (state.phase === 'ready') {
    return { key: `ready:${state.available}`, title: 'Hermes update is ready', body: `${state.available ? `Hermes ${state.available}` : 'The new version'} is downloaded. Click to restart Hermes and update, or it installs when you quit.`, restart: true };
  }
  if (state.phase === 'error' && state.available) {
    const { message, detail } = failureText(state);
    return { key: `error:${state.available}:${state.failure ?? 'network'}`, title: message, body: detail, restart: false };
  }
  return undefined;
};
