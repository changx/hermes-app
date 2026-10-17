import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BrowserControlError } from '../shared/browser-control';
import { StdioSession as Session } from './mcp-session';

/**
 * Native macOS app control for the Agent ("desktop_mac" tool), executed through the user's own
 * Cua Driver install. One long-lived `cua-driver mcp` session per app run keeps the driver's
 * window snapshots between calls (element tokens and pixel clicks need the latest
 * get_window_state of the same session). On macOS that process proxies to the CuaDriver.app
 * daemon, which owns the Accessibility and Screen Recording grants and is launched by the
 * driver when needed; Hermes App itself needs no macOS permission. See docs/desktop-mac-control.md.
 */

export type EncodedImage = Readonly<{ jpegBase64: string; width: number; height: number }>;
export type MacDriverOptions = Readonly<{
  /** Executable candidates, first existing one wins. */
  candidates?: readonly string[];
  platform?: NodeJS.Platform;
  /** PNG bytes -> JPEG. Injected so tests run without Electron. */
  encodeImage?: (png: Buffer) => EncodedImage | undefined;
  spawnProcess?: typeof spawn;
  /** The session process is stopped after this long without calls. */
  idleMs?: number;
}>;

const TOOL = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_OUTPUT = 120_000;
const MAX_ARGUMENTS = 100_000;

export function defaultCandidates(home = homedir()): string[] {
  return [
    join(home, '.local/bin/cua-driver'),
    '/Applications/CuaDriver.app/Contents/MacOS/cua-driver',
    join(home, 'Applications/CuaDriver.app/Contents/MacOS/cua-driver'),
    '/opt/homebrew/bin/cua-driver',
    '/usr/local/bin/cua-driver',
  ];
}

/** Validates the Agent's request: one driver tool name and its JSON arguments. */
export function macRequest(args: Readonly<Record<string, unknown>>): { tool: string; input: Record<string, unknown> } {
  const tool = args.tool;
  if (typeof tool !== 'string' || !TOOL.test(tool)) throw new BrowserControlError('invalid', 'tool must be a Cua Driver tool name such as get_window_state.');
  const raw = args.arguments ?? {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BrowserControlError('invalid', 'arguments must be a JSON object.');
  if (JSON.stringify(raw).length > MAX_ARGUMENTS) throw new BrowserControlError('invalid', 'arguments are too large.');
  return { tool, input: raw as Record<string, unknown> };
}

/** Driver output for the model: long base64 blobs removed, size capped. */
export function cleanOutput(text: string): string {
  const cleaned = text.replace(/[A-Za-z0-9+/=]{2000,}/g, '[binary data omitted]').trim();
  return cleaned.length > MAX_OUTPUT ? cleaned.slice(0, MAX_OUTPUT) + '\n[output truncated]' : cleaned;
}

export type Content = { type?: string; text?: string; data?: string; mimeType?: string };
export type ToolResult = { content?: Content[]; structuredContent?: unknown; isError?: boolean };

/** Text the model reads: the full structured result when present (it carries snapshot IDs and element tokens), else the text blocks. */
export function resultText(result: ToolResult): string {
  if (result.structuredContent !== undefined && result.structuredContent !== null) return cleanOutput(JSON.stringify(result.structuredContent, null, 1));
  return cleanOutput((result.content ?? []).filter(c => c.type === 'text' && typeof c.text === 'string').map(c => c.text).join('\n'));
}

export class MacDriver {
  private readonly candidates: readonly string[];
  private readonly platform: NodeJS.Platform;
  private session?: Session;
  private opening?: Promise<Session>;
  private idle?: NodeJS.Timeout;
  constructor(private readonly options: MacDriverOptions = {}) {
    this.candidates = options.candidates ?? defaultCandidates();
    this.platform = options.platform ?? process.platform;
  }

  /** The driver executable, or undefined when Cua Driver is not installed. */
  executable(): string | undefined {
    if (this.platform !== 'darwin') return undefined;
    for (const path of this.candidates) {
      try { accessSync(path, constants.X_OK); if (statSync(path).isFile()) return path; } catch { /* next */ }
    }
    return undefined;
  }
  available(): boolean { return !!this.executable(); }

  /** The current session, started on first use and again after it stops. */
  private open(): Promise<Session> {
    if (this.session && !this.session.closed) return Promise.resolve(this.session);
    if (this.opening) return this.opening;
    this.opening = (async () => {
      const exe = this.executable();
      if (!exe) throw new BrowserControlError('no_driver', 'Cua Driver is not installed on this Mac.');
      let child: ChildProcess;
      try {
        child = (this.options.spawnProcess ?? spawn)(exe, ['mcp'], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, CUA_DRIVER_RS_UPDATE_CHECK: 'false' } });
      } catch { throw new BrowserControlError('no_driver', 'Cua Driver could not be started.'); }
      const session = new Session(child);
      try { await session.ready; } catch {
        session.close();
        throw new BrowserControlError('no_driver', 'Cua Driver could not be started.');
      }
      this.session = session;
      return session;
    })().finally(() => { this.opening = undefined; });
    return this.opening;
  }

  private touch(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => this.close(), this.options.idleMs ?? 10 * 60_000);
    this.idle.unref?.();
  }

  async run(args: Readonly<Record<string, unknown>>, signal: AbortSignal, timeoutMs: number): Promise<Record<string, unknown>> {
    const { tool, input } = macRequest(args);
    const session = await this.open();
    this.touch();
    if (tool === 'list_tools' || tool === 'describe') {
      const listed = await session.request('tools/list', {}, timeoutMs, signal) as { tools?: { name: string; description?: string; inputSchema?: unknown }[] };
      const tools = listed?.tools ?? [];
      if (tool === 'list_tools') return { output: tools.map(t => `${t.name}: ${(t.description ?? '').split('\n')[0]}`).join('\n') };
      const found = tools.find(t => t.name === input.tool);
      if (!found) throw new BrowserControlError('invalid', 'describe needs arguments {"tool": "<name>"} with a tool from list_tools.');
      return { output: cleanOutput(`name: ${found.name}\n\ndescription:\n${found.description ?? ''}\n\ninput schema:\n${JSON.stringify(found.inputSchema ?? {}, null, 1)}`) };
    }
    const result = await session.request('tools/call', { name: tool, arguments: input }, timeoutMs, signal) as ToolResult;
    const output = resultText(result ?? {});
    if (result?.isError) throw new BrowserControlError('driver_error', output.slice(0, 2000) || 'Cua Driver refused the action.');
    const png = (result?.content ?? []).find(c => c.type === 'image' && typeof c.data === 'string');
    let image: EncodedImage | undefined;
    if (png?.data) { try { image = this.options.encodeImage?.(Buffer.from(png.data, 'base64')); } catch { image = undefined; } }
    return image ? { output, jpeg_base64: image.jpegBase64, image_width: image.width, image_height: image.height } : { output };
  }

  close(): void {
    if (this.idle) { clearTimeout(this.idle); this.idle = undefined; }
    this.session?.close(); this.session = undefined;
  }
}
