import type { UpdateState } from './updater';

/** Actions of the update item in the app menu. */
export type UpdateMenuAction = 'check' | 'restart';

/** The update item under "About Hermes": what it says and what it does in each update state. */
export const updateMenuItem = (state: UpdateState): { label: string; enabled: boolean; action: UpdateMenuAction } => {
  switch (state.phase) {
    case 'ready': return { label: state.available ? `Restart to Update to ${state.available}` : 'Restart to Update', enabled: true, action: 'restart' };
    case 'checking': return { label: 'Checking for Updates…', enabled: false, action: 'check' };
    case 'downloading': return { label: 'Downloading Update…', enabled: false, action: 'check' };
    default: return { label: 'Check for Updates…', enabled: true, action: 'check' };
  }
};

export type UpdateDialog = { message: string; detail?: string; buttons: string[]; restartButton?: number };

/** The answer to "Check for Updates…" (a check the user asked for). */
export const updateCheckDialog = (state: UpdateState): UpdateDialog => {
  switch (state.phase) {
    case 'ready':
      return { message: state.available ? `Hermes ${state.available} is ready to install.` : 'A new version of Hermes is ready to install.', detail: 'Restart Hermes now to finish the update, or it installs when you next quit Hermes.', buttons: ['Restart Now', 'Later'], restartButton: 0 };
    case 'downloading':
      return { message: 'A new version of Hermes is downloading.', detail: 'It installs when you restart Hermes. You can keep working.', buttons: ['OK'] };
    case 'unsupported':
      return state.reason === 'not-in-applications'
        ? { message: 'Move Hermes to the Applications folder to get updates.', detail: 'Quit Hermes, drag it from the disk image or Downloads to Applications, and open it from there.', buttons: ['OK'] }
        : { message: 'Updates are available only in the installed app.', buttons: ['OK'] };
    case 'error':
      return { message: 'Hermes could not check for updates.', detail: 'Check the network connection and try again later. Hermes also checks again by itself.', buttons: ['OK'] };
    default:
      return { message: 'Hermes is up to date.', detail: `Version ${state.version} is the newest version.`, buttons: ['OK'] };
  }
};
