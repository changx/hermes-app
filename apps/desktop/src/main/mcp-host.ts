import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { BrowserControlError } from '../shared/browser-control';
import { importServers, launchKey, McpConfigError, parseMcpConfig, withApproval, type McpApproval, type McpServerConfig } from '../shared/mcp-config';
import type { DesktopMcpState } from '../shared/desktop-api';
import { cleanOutput, type Content, type EncodedImage, type ToolResult } from './mac-control';
import { HttpSession, StdioSession, type McpSession } from './mcp-session';

/**
 * Runs the MCP servers configured on this computer for the Agent ("desktop_mcp" tool).
 * Servers start on first use and stop after 10 idle minutes, when their configuration
 * changes and when the app quits. See docs/desktop-mcp-host.md.
 */

export type McpConfirmation = 'allow' | 'allow-all' | 'deny' | 'timeout';
export type McpConfirmRequest = Readonly<{ server: string; tool: string; summary: string; signal: AbortSignal }>;
export type McpHostOptions = Readonly<{
  /** Path of mcp.json. */
  file: string;
  /** Claude Desktop's configuration, for import. */
  claudeFile?: string;
  platform?: NodeJS.Platform;
  /** Asks the user to allow one call. */
  confirm(request: McpConfirmRequest): Promise<McpConfirmation>;
  /** Image bytes -> JPEG. Injected so tests run without Electron. */
  encodeImage?: (bytes: Buffer) => EncodedImage | undefined;
  spawnProcess?: typeof spawn;
  fetch?: typeof fetch;
  /** PATH for stdio servers. Default: the login shell's PATH on macOS. */
  searchPath?: () => Promise<string>;
  idleMs?: number;
  initTimeoutMs?: number;
  /** Called when the enabled server list changes. */
  onServersChanged?: () => void;
  /** Watch the file for edits made outside the app. */
  watchFile?: boolean;
}>;

type Status = 'stopped' | 'starting' | 'running' | 'failed';
type Entry = { config: McpServerConfig; key: string; session?: McpSession; opening?: Promise<McpSession>; idle?: NodeJS.Timeout; status: Status; message?: string; allowAll: boolean };
type ListedTool = { name: string; description?: string; inputSchema?: unknown; annotations?: unknown };

const MAX_IMAGES = 4;
const SUMMARY = 600;

/** PATH of the user's login shell. Apps opened from Finder do not get the Terminal PATH, so npx/uvx are missing otherwise. */
export function loginShellPath(spawnProcess: typeof spawn = spawn, shell = process.env.SHELL || '/bin/zsh', timeoutMs = 10_000): Promise<string> {
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local/bin')];
  const merge = (path: string) => [...new Set([...path.split(':').filter(Boolean), ...extra, '/usr/bin', '/bin', '/usr/sbin', '/sbin'])].join(':');
  return new Promise(resolve => {
    let child: ChildProcess, out = '';
    const done = () => { clearTimeout(timer); const found = /__HERMES_PATH__(.*)__HERMES_END__/s.exec(out); resolve(merge(found ? found[1].trim() : process.env.PATH ?? '')); };
    const timer = setTimeout(() => { try { child?.kill(); } catch { /* gone */ } done(); }, timeoutMs);
    try {
      child = spawnProcess(shell, ['-ilc', 'printf "__HERMES_PATH__%s__HERMES_END__" "$PATH"'], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch { done(); return; }
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => { out = (out + chunk).slice(-64 * 1024); });
    child.on('error', done);
    child.on('close', done);
  });
}

/** Up to 600 characters describing the arguments, for the approval dialog. */
export function argumentSummary(args: Readonly<Record<string, unknown>>): string {
  const text = JSON.stringify(args, null, 1) ?? '{}';
  return text.length > SUMMARY ? text.slice(0, SUMMARY) + '…' : text;
}

/** Text of a tool result: text blocks; structured content when there is no text; links for resources. */
export function mcpResultText(result: ToolResult): string {
  const parts: string[] = [];
  for (const block of (result.content ?? []) as (Content & { resource?: { uri?: string; text?: string }; uri?: string; name?: string })[]) {
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    else if (block.type === 'resource' && block.resource) parts.push(typeof block.resource.text === 'string' ? block.resource.text : `[resource ${block.resource.uri ?? ''}]`);
    else if (block.type === 'resource_link') parts.push(`[resource ${block.name ?? ''} ${block.uri ?? ''}]`.trim());
    else if (block.type === 'audio') parts.push('[audio omitted]');
  }
  if (!parts.length && result.structuredContent !== undefined && result.structuredContent !== null) parts.push(JSON.stringify(result.structuredContent, null, 1));
  return cleanOutput(parts.join('\n'));
}

export class McpHost {
  private readonly entries = new Map<string, Entry>();
  private text = '';
  private error?: string;
  private watcher?: FSWatcher;
  private reloadTimer?: NodeJS.Timeout;
  private pathPromise?: Promise<string>;
  private closed = false;
  private lastNames = '';
  constructor(private readonly options: McpHostOptions) {}

  /** Reads the file and starts watching it. A missing file means no servers. */
  start(): void {
    this.reload();
    if (this.options.watchFile === false) return;
    try {
      mkdirSync(dirname(this.options.file), { recursive: true });
      const name = basename(this.options.file);
      this.watcher = watch(dirname(this.options.file), (_event, changed) => {
        if (changed && changed.toString() !== name) return;
        if (this.reloadTimer) clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(() => { this.reloadTimer = undefined; this.reload(); }, 200);
      });
      this.watcher.on('error', () => { /* Settings still reloads on save. */ });
    } catch { /* No watching; Settings still saves and reloads. */ }
  }

  private readFile(): string {
    try { return readFileSync(this.options.file, 'utf8'); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw new McpConfigError('The configuration file could not be read.');
    }
  }

  /** Applies the file. An invalid file keeps the last valid servers and reports the error. */
  reload(): void {
    if (this.closed) return;
    let text: string;
    try { text = this.readFile(); this.apply(text, parseMcpConfig(text).servers); }
    catch (error) { this.error = error instanceof McpConfigError ? error.message : 'The configuration could not be read.'; }
  }

  private apply(text: string, servers: readonly McpServerConfig[]): void {
    this.text = text; this.error = undefined;
    const wanted = new Map(servers.map(server => [server.name, server]));
    for (const [name, entry] of this.entries) {
      const next = wanted.get(name);
      if (!next || launchKey(next) !== entry.key || next.disabled) { this.stop(entry); this.entries.delete(name); }
    }
    for (const server of servers) {
      const entry = this.entries.get(server.name);
      if (entry) entry.config = server;
      else this.entries.set(server.name, { config: server, key: launchKey(server), status: 'stopped', allowAll: false });
    }
    const names = this.servers().join(',');
    if (names !== this.lastNames) { this.lastNames = names; this.options.onServersChanged?.(); }
  }

  /** Enabled server names, offered to the Agent. */
  servers(): string[] { return [...this.entries.values()].filter(e => !e.config.disabled).map(e => e.config.name); }

  state(): DesktopMcpState {
    return {
      path: this.options.file, text: this.text, ...(this.error ? { error: this.error } : {}),
      claudeAvailable: !!this.options.claudeFile && this.exists(this.options.claudeFile),
      servers: [...this.entries.values()].map(e => ({
        name: e.config.name, kind: e.config.kind, approval: e.config.approval, disabled: e.config.disabled,
        status: e.config.disabled ? 'stopped' : e.status, ...(e.message ? { message: e.message } : {}),
      })),
    };
  }
  private exists(path: string): boolean { try { readFileSync(path); return true; } catch { return false; } }

  /** Validates and writes the file, then applies it. Throws McpConfigError with a readable message. */
  save(text: string): DesktopMcpState {
    const { servers } = parseMcpConfig(text);
    this.write(text);
    this.apply(text, servers);
    return this.state();
  }
  private write(text: string): void {
    mkdirSync(dirname(this.options.file), { recursive: true });
    const temporary = `${this.options.file}.${process.pid}.tmp`;
    // The file can hold API keys: readable by this user only.
    writeFileSync(temporary, text, { mode: 0o600 });
    renameSync(temporary, this.options.file);
  }

  /** Creates an empty configuration so the file can be shown and edited. */
  ensureFile(): string {
    try { readFileSync(this.options.file); } catch { this.write('{\n  "mcpServers": {}\n}\n'); this.reload(); }
    return this.options.file;
  }

  setApproval(name: string, approval: McpApproval): DesktopMcpState {
    const state = this.save(withApproval(this.readFile(), name, approval));
    const entry = this.entries.get(name);
    if (entry && approval === 'ask') entry.allowAll = false;
    return state;
  }

  importClaude(): { state: DesktopMcpState; added: string[]; skipped: string[] } {
    if (!this.options.claudeFile) throw new McpConfigError('Claude Desktop is not available on this computer.');
    let other: string;
    try { other = readFileSync(this.options.claudeFile, 'utf8'); } catch { throw new McpConfigError('Claude Desktop configuration was not found on this computer.'); }
    const result = importServers(this.readFile(), other);
    const state = result.added.length ? this.save(result.text) : this.state();
    return { state, added: result.added, skipped: result.skipped };
  }

  private searchPath(): Promise<string> {
    if (this.options.searchPath) return this.options.searchPath();
    if ((this.options.platform ?? process.platform) !== 'darwin') return Promise.resolve(process.env.PATH ?? '');
    this.pathPromise ??= loginShellPath(this.options.spawnProcess ?? spawn);
    return this.pathPromise;
  }

  private open(entry: Entry): Promise<McpSession> {
    if (entry.session && !entry.session.closed) return Promise.resolve(entry.session);
    if (entry.opening) return entry.opening;
    const config = entry.config, label = `MCP server "${config.name}"`;
    entry.status = 'starting'; entry.message = undefined;
    const opening = (async () => {
      let session: McpSession;
      if (config.kind === 'http') {
        session = new HttpSession(config.url!, config.headers ?? {}, label, this.options.fetch ?? fetch, this.options.initTimeoutMs);
      } else {
        const PATH = await this.searchPath();
        let child: ChildProcess;
        try {
          child = (this.options.spawnProcess ?? spawn)(config.command!, [...(config.args ?? [])], {
            stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PATH, ...(config.env ?? {}) }, ...(config.cwd ? { cwd: config.cwd } : {}),
          });
        } catch (error) { throw new BrowserControlError('server_error', `Could not start ${label}: ${(error as Error).message.slice(0, 300)}`); }
        session = new StdioSession(child, label, this.options.initTimeoutMs);
      }
      try { await session.ready; } catch (error) {
        session.close();
        const stdio = session instanceof StdioSession ? session : undefined;
        const why = stdio?.startError === 'ENOENT' ? `"${config.command}" was not found. Check the command, or install it.`
          : stdio?.stderrTail() || (error as Error).message || 'it stopped while starting.';
        throw new BrowserControlError('server_error', `Could not start ${label}: ${why.slice(-1000)}`);
      }
      return session;
    })();
    entry.opening = opening;
    opening.then(session => {
      if (this.entries.get(config.name) !== entry || this.closed) { session.close(); return; }
      entry.session = session; entry.status = 'running';
    }, error => { entry.status = 'failed'; entry.message = (error as Error).message.slice(0, 1000); })
      .finally(() => { if (entry.opening === opening) entry.opening = undefined; });
    return opening;
  }

  private touch(entry: Entry): void {
    if (entry.idle) clearTimeout(entry.idle);
    entry.idle = setTimeout(() => this.stop(entry), this.options.idleMs ?? 10 * 60_000);
    entry.idle.unref?.();
  }
  private stop(entry: Entry): void {
    if (entry.idle) { clearTimeout(entry.idle); entry.idle = undefined; }
    entry.session?.close(); entry.session = undefined;
    if (entry.status === 'running' || entry.status === 'starting') entry.status = 'stopped';
  }

  private async listTools(session: McpSession, timeoutMs: number, signal: AbortSignal): Promise<ListedTool[]> {
    const tools: ListedTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const listed = await session.request('tools/list', cursor ? { cursor } : {}, timeoutMs, signal) as { tools?: ListedTool[]; nextCursor?: string };
      tools.push(...(listed?.tools ?? []).filter(t => t && typeof t.name === 'string'));
      cursor = typeof listed?.nextCursor === 'string' && listed.nextCursor ? listed.nextCursor : undefined;
      if (!cursor) break;
    }
    return tools;
  }

  /** Runs one Agent request: {server, tool, arguments}. tool "list" and "describe" read tool information. */
  async run(args: Readonly<Record<string, unknown>>, signal: AbortSignal, timeoutMs: number): Promise<Record<string, unknown>> {
    const server = args.server, tool = args.tool, raw = args.arguments ?? {};
    if (typeof server !== 'string' || typeof tool !== 'string' || !tool) throw new BrowserControlError('invalid', 'server and tool are required.');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BrowserControlError('invalid', 'arguments must be a JSON object.');
    const input = raw as Record<string, unknown>;
    const entry = this.entries.get(server);
    if (!entry || entry.config.disabled) throw new BrowserControlError('no_server', `No MCP server named "${server}" on this computer.`);
    const session = await this.open(entry);
    this.touch(entry);
    if (tool === 'list' || tool === 'describe') {
      const tools = await this.listTools(session, timeoutMs, signal);
      if (tool === 'list') return { output: cleanOutput(tools.length ? tools.map(t => `${t.name}: ${(t.description ?? '').split('\n')[0]}`).join('\n') : 'This server has no tools.') };
      const found = tools.find(t => t.name === input.tool);
      if (!found) throw new BrowserControlError('invalid', 'describe needs arguments {"tool": "<name>"} with a tool from list.');
      return { output: cleanOutput(`name: ${found.name}\n\ndescription:\n${found.description ?? ''}\n\ninput schema:\n${JSON.stringify(found.inputSchema ?? {}, null, 1)}${found.annotations ? `\n\nannotations:\n${JSON.stringify(found.annotations)}` : ''}`) };
    }
    if (entry.config.approval === 'ask' && !entry.allowAll) {
      const answer = await this.options.confirm({ server, tool, summary: argumentSummary(input), signal });
      if (signal.aborted) throw new BrowserControlError('cancelled', 'Stopped.');
      if (answer === 'deny') throw new BrowserControlError('denied', 'The user declined.');
      if (answer === 'timeout') throw new BrowserControlError('not_confirmed', 'The user did not answer.');
      if (answer === 'allow-all') entry.allowAll = true;
    }
    const result = await session.request('tools/call', { name: tool, arguments: input }, timeoutMs, signal) as ToolResult;
    this.touch(entry);
    const output = mcpResultText(result ?? {});
    if (result?.isError) throw new BrowserControlError('server_error', output.slice(0, 2000) || 'The tool reported an error.');
    const images: EncodedImage[] = [];
    for (const block of result?.content ?? []) {
      if (images.length >= MAX_IMAGES) break;
      if (block.type !== 'image' || typeof block.data !== 'string') continue;
      try { const image = this.options.encodeImage?.(Buffer.from(block.data, 'base64')); if (image) images.push(image); } catch { /* skipped */ }
    }
    return images.length ? { output, images: images.map(i => ({ jpeg_base64: i.jpegBase64, width: i.width, height: i.height })) } : { output };
  }

  close(): void {
    this.closed = true;
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.watcher?.close();
    for (const entry of this.entries.values()) this.stop(entry);
  }
}

/** Claude Desktop's configuration file on this platform, when it has one. */
export function claudeConfigPath(platform: NodeJS.Platform = process.platform, home = homedir()): string | undefined {
  if (platform === 'darwin') return join(home, 'Library/Application Support/Claude/claude_desktop_config.json');
  if (platform === 'win32') return process.env.APPDATA ? join(process.env.APPDATA, 'Claude/claude_desktop_config.json') : undefined;
  return undefined;
}
