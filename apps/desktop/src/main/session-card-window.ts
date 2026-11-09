import { BrowserWindow, screen, type Rectangle, type WebContents } from 'electron';
import { join } from 'node:path';
import type { SessionCardRequest } from '../shared/desktop-api';

/** Gap between the sidebar edge and the card; margin kept from the screen edge. */
export const CARD_GAP = 6;
const EDGE = 8, MIN_WIDTH = 220;

const invalid = (): never => { throw new Error('Invalid desktop request'); };
const str = (value: unknown, maximum: number): string => typeof value === 'string' && value.length <= maximum ? value : invalid();
const optional = (value: unknown, maximum: number): string | undefined => value === undefined || value === null || value === '' ? undefined : str(value, maximum);
const list = (value: unknown, items: number, maximum: number): string[] => Array.isArray(value) && value.length <= items ? value.map(item => str(item, maximum)) : invalid();
const num = (value: unknown, low: number, high: number): number => typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high ? value : invalid();

/** Validates the renderer's card request: plain text and numbers only. */
export function sessionCardRequest(value: unknown): SessionCardRequest | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const card = value as Record<string, unknown>;
  const rowTop = num(card.rowTop, -100_000, 100_000), rowBottom = num(card.rowBottom, rowTop, 100_000);
  return { title: str(card.title, 2000), project: optional(card.project, 400), connection: optional(card.connection, 400),
    statuses: list(card.statuses, 8, 60), labels: list(card.labels, 20, 100), lastMessage: optional(card.lastMessage, 100), usage: optional(card.usage, 100),
    rowTop, rowBottom, sidebarRight: num(card.sidebarRight, 0, 100_000), fontSize: num(card.fontSize, 8, 48) };
}

/** Card width for the text size: about 20em, kept readable on small and large settings. */
export const cardWidth = (fontSize: number): number => Math.round(Math.min(420, Math.max(260, fontSize * 20)));

/**
 * Left edge at the sidebar's right edge (never over the sidebar), top level with
 * the row. Kept inside the screen's work area: it moves up near the bottom, and
 * narrows (not moves left) near the right edge.
 */
export function cardBounds(content: Rectangle, area: Rectangle, card: Pick<SessionCardRequest, 'rowTop' | 'sidebarRight'>, width: number, height: number): Rectangle {
  const x = Math.round(content.x + card.sidebarRight + CARD_GAP);
  const room = area.x + area.width - EDGE - x;
  const w = Math.round(Math.max(Math.min(width, room), Math.min(width, MIN_WIDTH)));
  const bottom = area.y + area.height - EDGE;
  const y = Math.round(Math.max(area.y + EDGE, Math.min(content.y + card.rowTop, bottom - height)));
  return { x, y, width: w, height: Math.round(height) };
}

/**
 * Sidebar Session card as a native child window. Session pages are native views
 * that cover the window's own HTML, so only a window can show the card to the
 * right of the sidebar. The window never takes focus and ignores the mouse.
 * It loads a static page without preload or IPC; main fills it with text.
 */
export class SessionCardWindow {
  private window?: BrowserWindow;
  private loaded?: Promise<void>;
  private generation = 0;

  constructor(private readonly owner: () => BrowserWindow | null, private readonly directory: string,
    private readonly secure: (contents: WebContents) => void) {}

  get contents(): WebContents | undefined { return this.window && !this.window.isDestroyed() ? this.window.webContents : undefined; }
  get visible(): boolean { return !!this.window && !this.window.isDestroyed() && this.window.isVisible(); }
  get bounds(): Rectangle | undefined { return this.window && !this.window.isDestroyed() ? this.window.getBounds() : undefined; }
  owns(contents: WebContents): boolean { return !!contents && contents === this.contents; }

  /** Creates the hidden window ahead of time, so the first card shows without a page load. */
  prepare(): void {
    const parent = this.owner();
    if (!parent || parent.isDestroyed() || this.window && !this.window.isDestroyed()) return;
    const window = new BrowserWindow({
      parent, show: false, frame: false, focusable: false, resizable: false, movable: false, minimizable: false, maximizable: false,
      fullscreenable: false, skipTaskbar: true, hasShadow: true, roundedCorners: true, backgroundColor: '#ffffff', width: 320, height: 80,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false,
        allowRunningInsecureContent: false, backgroundThrottling: false, spellcheck: false },
    });
    window.setIgnoreMouseEvents(true);
    this.secure(window.webContents);
    this.window = window;
    this.loaded = window.loadFile(join(this.directory, '../renderer/session-card.html')).catch(() => undefined);
    window.on('closed', () => { if (this.window === window) { this.window = undefined; this.loaded = undefined; } });
  }

  async show(card: SessionCardRequest): Promise<void> {
    const generation = ++this.generation, parent = this.owner();
    if (!parent || parent.isDestroyed() || parent.isMinimized() || !parent.isVisible()) return;
    this.prepare();
    const window = this.window;
    if (!window) return;
    await this.loaded;
    if (generation !== this.generation || window.isDestroyed()) return;
    const content = parent.getContentBounds(), area = screen.getDisplayMatching(content).workArea;
    const width = cardBounds(content, area, card, cardWidth(card.fontSize), 0).width;
    const text = { title: card.title, project: card.project, connection: card.connection, statuses: card.statuses, labels: card.labels, lastMessage: card.lastMessage, usage: card.usage, fontSize: card.fontSize };
    const height = Number(await window.webContents.executeJavaScript(`window.showCard(${JSON.stringify({ ...text, width })})`));
    if (generation !== this.generation || window.isDestroyed() || !Number.isFinite(height) || height <= 0) return;
    window.setBounds(cardBounds(content, area, card, width, Math.ceil(height)));
    if (!window.isVisible()) window.showInactive();
  }

  hide(): void {
    this.generation++;
    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) this.window.hide();
  }

  dispose(): void {
    this.generation++;
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = undefined; this.loaded = undefined;
  }
}
