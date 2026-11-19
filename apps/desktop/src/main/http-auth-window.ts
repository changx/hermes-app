import { BrowserWindow, type WebContents } from 'electron';
import { join } from 'node:path';

/** What the sign-in sheet shows. The server's realm text is never shown (as in Chrome). */
export type HttpAuthChallenge = { host: string; proxy: boolean; secure: boolean };
export type HttpCredentials = { username: string; password: string };
type AuthInfo = { isProxy: boolean; scheme: string; host: string; port: number; realm: string };

const DEFAULT_PORTS: Record<string, number> = { 'http:': 80, 'https:': 443 };

/** The sheet text for one 401/407 challenge. */
export function httpAuthChallenge(url: string, info: AuthInfo): HttpAuthChallenge {
  let protocol = '';
  try { protocol = new URL(url).protocol; } catch { /* Shown as not private. */ }
  const port = Number.isInteger(info.port) && info.port > 0 && info.port !== DEFAULT_PORTS[protocol] ? `:${info.port}` : '';
  return { host: `${String(info.host).slice(0, 253)}${port}`, proxy: !!info.isProxy, secure: protocol === 'https:' };
}

/** Requests for the same server and realm share one sheet. */
export function httpAuthKey(info: AuthInfo): string {
  return JSON.stringify([!!info.isProxy, String(info.scheme).toLowerCase(), String(info.host).toLowerCase(), info.port, info.realm]);
}

const WIDTH = 380;

/**
 * Asks for a username and password in a sheet on `parent` (a separate window without one).
 * The page has no preload and no IPC; main fills in text and waits for its result.
 * Resolves undefined when the user cancels or closes the sheet.
 */
export function askHttpAuth(parent: BrowserWindow | undefined, directory: string, secure: (contents: WebContents) => void, challenge: HttpAuthChallenge): Promise<HttpCredentials | undefined> {
  const owner = parent && !parent.isDestroyed() ? parent : undefined;
  const window = new BrowserWindow({
    ...(owner ? { parent: owner, modal: true } : {}), show: false, width: WIDTH, height: 240, useContentSize: true, resizable: false,
    minimizable: false, maximizable: false, fullscreenable: false, title: 'Sign in', backgroundColor: '#ffffff', autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false,
      allowRunningInsecureContent: false, spellcheck: false },
  });
  secure(window.webContents);
  return new Promise(resolve => {
    let done = false;
    const finish = (value: HttpCredentials | undefined) => {
      if (done) return; done = true;
      if (!window.isDestroyed()) window.destroy();
      resolve(value);
    };
    window.on('closed', () => finish(undefined));
    void (async () => {
      await window.loadFile(join(directory, '../renderer/http-auth.html'));
      if (window.isDestroyed()) return;
      const height = Number(await window.webContents.executeJavaScript(`window.prepareSignIn(${JSON.stringify(challenge)})`));
      if (window.isDestroyed()) return;
      if (Number.isFinite(height) && height > 0) window.setContentSize(WIDTH, Math.min(600, Math.ceil(height)));
      window.show(); window.webContents.focus();
      const value = await window.webContents.executeJavaScript('window.signInResult') as unknown;
      const valid = value && typeof value === 'object' && typeof (value as HttpCredentials).username === 'string' && typeof (value as HttpCredentials).password === 'string';
      finish(valid ? { username: (value as HttpCredentials).username, password: (value as HttpCredentials).password } : undefined);
    })().catch(() => finish(undefined));
  });
}
