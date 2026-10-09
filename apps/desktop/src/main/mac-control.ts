import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, constants, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BrowserControlError } from '../shared/browser-control';

/**
 * Native macOS app control for the Agent ("desktop_mac" tool), executed through the user's own
 * Cua Driver install. The driver's daemon (CuaDriver.app) owns the Accessibility and Screen
 * Recording grants, so Hermes App itself needs no macOS permission. Each command is one
 * `cua-driver call` to that daemon. See docs/desktop-mac-control.md.
 */

export type EncodedImage = Readonly<{ jpegBase64: string; width: number; height: number }>;
export type MacDriverOptions = Readonly<{
  /** Executable candidates, first existing one wins. */
  candidates?: readonly string[];
  platform?: NodeJS.Platform;
  /** PNG file -> JPEG. Injected so tests run without Electron. */
  encodeImage?: (pngPath: string) => EncodedImage | undefined;
  spawnProcess?: typeof spawn;
  scratch?: string;
  /** Starts the driver daemon when it is not running. */
  startDaemon?: () => Promise<void>;
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

type RunResult = { code: number | null; stdout: string; stderr: string };

export class MacDriver {
  private readonly candidates: readonly string[];
  private readonly platform: NodeJS.Platform;
  constructor(private readonly options: MacDriverOptions = {}) {
    this.candidates = options.candidates ?? defaultCandidates();
    this.platform = options.platform ?? process.platform;
  }

  /** The driver executable, or undefined when Cua Driver is not installed. Checked on every call. */
  executable(): string | undefined {
    if (this.platform !== 'darwin') return undefined;
    for (const path of this.candidates) {
      try { accessSync(path, constants.X_OK); if (statSync(path).isFile()) return path; } catch { /* next */ }
    }
    return undefined;
  }
  available(): boolean { return !!this.executable(); }

  async run(args: Readonly<Record<string, unknown>>, signal: AbortSignal, timeoutMs: number): Promise<Record<string, unknown>> {
    const { tool, input } = macRequest(args);
    const exe = this.executable();
    if (!exe) throw new BrowserControlError('no_driver', 'Cua Driver is not installed on this Mac.');
    if (tool === 'list_tools') return this.textResult(await this.exec(exe, ['list-tools'], signal, timeoutMs));
    if (tool === 'describe') {
      const name = input.tool;
      if (typeof name !== 'string' || !TOOL.test(name)) throw new BrowserControlError('invalid', 'describe needs arguments {"tool": "<name>"}.');
      return this.textResult(await this.exec(exe, ['describe', name], signal, timeoutMs));
    }
    const shot = join(this.options.scratch ?? tmpdir(), `hermes-mac-${randomUUID()}.png`);
    const callArgs = ['call', '--screenshot-out-file', shot, tool, JSON.stringify(input)];
    try {
      let result = await this.exec(exe, callArgs, signal, timeoutMs);
      // A call fails before running anything when the daemon is down: confirm with `status`,
      // start the daemon and try once more.
      if (result.code !== 0 && !signal.aborted && (await this.exec(exe, ['status'], signal, 10_000)).code !== 0) {
        await (this.options.startDaemon ?? (() => startDriverDaemon(this.options.spawnProcess ?? spawn)))();
        result = await this.exec(exe, callArgs, signal, timeoutMs);
      }
      const output = this.textResult(result);
      let image: EncodedImage | undefined;
      try { if (statSync(shot).size > 0) image = this.options.encodeImage?.(shot); } catch { /* no image */ }
      return image ? { ...output, jpeg_base64: image.jpegBase64, image_width: image.width, image_height: image.height } : output;
    } finally { rmSync(shot, { force: true }); }
  }

  private textResult(result: RunResult): Record<string, unknown> {
    if (result.code !== 0) {
      const detail = cleanOutput(result.stderr || result.stdout) || `Cua Driver exited with code ${result.code}.`;
      throw new BrowserControlError('driver_error', detail.slice(0, 2000));
    }
    return { output: cleanOutput(result.stdout) };
  }

  private exec(exe: string, argv: string[], signal: AbortSignal, timeoutMs: number): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(new BrowserControlError('cancelled', 'Stopped.')); return; }
      let child: ChildProcess;
      try {
        child = (this.options.spawnProcess ?? spawn)(exe, argv, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CUA_DRIVER_RS_UPDATE_CHECK: 'false' } });
      } catch { reject(new BrowserControlError('no_driver', 'Cua Driver could not be started.')); return; }
      let stdout = '', stderr = '', done = false;
      const finish = (fn: () => void) => { if (done) return; done = true; clearTimeout(timer); signal.removeEventListener('abort', onAbort); fn(); };
      const onAbort = () => { child.kill('SIGTERM'); finish(() => reject(new BrowserControlError('cancelled', 'Stopped.'))); };
      const timer = setTimeout(() => { child.kill('SIGTERM'); finish(() => reject(new BrowserControlError('unknown', 'Cua Driver did not answer in time.'))); }, timeoutMs);
      signal.addEventListener('abort', onAbort, { once: true });
      child.stdout?.on('data', chunk => { if (stdout.length < MAX_OUTPUT * 4) stdout += chunk; });
      child.stderr?.on('data', chunk => { if (stderr.length < 20_000) stderr += chunk; });
      child.on('error', () => finish(() => reject(new BrowserControlError('no_driver', 'Cua Driver could not be started.'))));
      child.on('close', code => finish(() => resolve({ code, stdout, stderr })));
    });
  }
}

/** Starts the CuaDriver.app daemon through LaunchServices, so it keeps its own permissions. */
async function startDriverDaemon(spawnProcess: typeof spawn): Promise<void> {
  await new Promise<void>(resolve => {
    try {
      const child = spawnProcess('/usr/bin/open', ['-n', '-g', '-a', 'CuaDriver', '--args', 'serve'], { stdio: 'ignore' });
      child.on('error', () => resolve()); child.on('close', () => resolve());
    } catch { resolve(); }
  });
  await new Promise(resolve => setTimeout(resolve, 2000));
}
