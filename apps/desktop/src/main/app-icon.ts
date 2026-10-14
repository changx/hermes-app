import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DESKTOP_APP_ICONS, type DesktopAppIconId, type DesktopAppIconState } from '../shared/desktop-api';

type Image = { isEmpty(): boolean };
export type DockIconTarget<I extends Image> = { setIcon(image: I): void };
export type IconImages<I extends Image> = { fromBuffer(buffer: Buffer): I };

export const validAppIcon = (value: unknown): value is DesktopAppIconId =>
  typeof value === 'string' && (DESKTOP_APP_ICONS as readonly string[]).includes(value);

/**
 * The Dock icon chosen in Settings. It is a preference of this computer, stored in
 * userData, and applied at startup and on change. macOS shows it in the Dock while
 * Hermes runs; Finder and Launchpad keep the packaged default icon, because the app
 * does not modify its own bundle.
 */
export class DesktopAppIcon<I extends Image> {
  private icon: DesktopAppIconId = 'mochi';
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly file: string, private readonly imageDirectory: string,
    private readonly images: IconImages<I>, private readonly dock: DockIconTarget<I> | undefined) {}

  state(): DesktopAppIconState { return { icon: this.icon, dock: !!this.dock }; }

  /** Reads the saved choice. A missing or unreadable file keeps the default icon. */
  async load(): Promise<void> {
    try {
      const saved = (JSON.parse(await readFile(this.file, 'utf8')) as { icon?: unknown }).icon;
      if (validAppIcon(saved)) this.icon = saved;
    } catch { /* first start or damaged file: default icon */ }
    // The packaged bundle icon already is the default; only a different choice needs the Dock call.
    if (this.icon !== 'mochi') this.apply();
  }

  async set(value: unknown): Promise<DesktopAppIconState> {
    if (!validAppIcon(value)) throw new Error('Unknown app icon');
    const save = this.writes.then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.tmp`;
      await writeFile(temporary, `${JSON.stringify({ icon: value })}\n`, { mode: 0o600 });
      await rename(temporary, this.file);
    });
    this.writes = save.catch(() => {});
    await save;
    this.icon = value;
    this.apply();
    return this.state();
  }

  private apply(): void {
    if (!this.dock) return;
    try {
      const image = this.images.fromBuffer(readFileSync(join(this.imageDirectory, `${this.icon}.png`)));
      if (!image.isEmpty()) this.dock.setIcon(image);
    } catch { /* keep the current Dock icon; the saved choice applies on the next start */ }
  }
}
