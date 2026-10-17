// Electron-free configuration of the MCP servers the desktop app runs for the Agent
// ("desktop_mcp"). Same shape as Claude Desktop's `mcpServers`, plus two optional
// Hermes fields per server: `approval` ("ask" | "auto") and `disabled`.
// See docs/desktop-mcp-host.md.

export type McpApproval = 'ask' | 'auto';
export type McpServerConfig = Readonly<{
  name: string;
  kind: 'stdio' | 'http';
  command?: string;
  args?: readonly string[];
  env?: Readonly<Record<string, string>>;
  cwd?: string;
  url?: string;
  headers?: Readonly<Record<string, string>>;
  approval: McpApproval;
  disabled: boolean;
}>;

export const MCP_SERVER_NAME = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_MCP_SERVERS = 64;
export const MAX_MCP_CONFIG_BYTES = 512 * 1024;

export class McpConfigError extends Error {}

type Raw = Record<string, unknown>;
const isObject = (value: unknown): value is Raw => !!value && typeof value === 'object' && !Array.isArray(value);

function stringMap(value: unknown, where: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) throw new McpConfigError(`${where} must be an object of text values.`);
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') throw new McpConfigError(`${where}.${key} must be text.`);
    out[key] = item;
  }
  return out;
}

/** One server entry. Throws McpConfigError naming the server and the field. */
export function parseServer(name: string, value: unknown): McpServerConfig {
  if (!MCP_SERVER_NAME.test(name)) throw new McpConfigError(`Server name "${name.slice(0, 80)}" can use only letters, digits, "_" and "-" (up to 64).`);
  if (!isObject(value)) throw new McpConfigError(`Server "${name}" must be an object.`);
  const where = `Server "${name}"`;
  const approval = value.approval ?? 'ask';
  if (approval !== 'ask' && approval !== 'auto') throw new McpConfigError(`${where}: approval must be "ask" or "auto".`);
  if (value.disabled !== undefined && typeof value.disabled !== 'boolean') throw new McpConfigError(`${where}: disabled must be true or false.`);
  const type = value.type;
  if (type !== undefined && type !== 'stdio' && type !== 'http' && type !== 'streamable-http' && type !== 'sse') throw new McpConfigError(`${where}: unknown type "${String(type).slice(0, 40)}".`);
  if (type === 'sse') throw new McpConfigError(`${where}: the older SSE transport is not supported. Use a server URL that supports Streamable HTTP.`);
  const common = { name, approval: approval as McpApproval, disabled: value.disabled === true };
  if (value.command !== undefined && value.url !== undefined) throw new McpConfigError(`${where}: use either command or url, not both.`);
  if (value.command !== undefined) {
    if (typeof value.command !== 'string' || !value.command.trim() || value.command.length > 4096) throw new McpConfigError(`${where}: command must be text.`);
    const args = value.args ?? [];
    if (!Array.isArray(args) || args.length > 256 || !args.every(item => typeof item === 'string')) throw new McpConfigError(`${where}: args must be a list of text values.`);
    if (value.cwd !== undefined && (typeof value.cwd !== 'string' || !value.cwd)) throw new McpConfigError(`${where}: cwd must be text.`);
    const env = stringMap(value.env, `${where} env`);
    return { ...common, kind: 'stdio', command: value.command, args: args as string[], ...(env ? { env } : {}), ...(typeof value.cwd === 'string' ? { cwd: value.cwd } : {}) };
  }
  if (value.url !== undefined) {
    let url: URL;
    try { url = new URL(String(value.url)); } catch { throw new McpConfigError(`${where}: url is not a valid address.`); }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new McpConfigError(`${where}: url must start with http:// or https://.`);
    const headers = stringMap(value.headers, `${where} headers`);
    return { ...common, kind: 'http', url: url.toString(), ...(headers ? { headers } : {}) };
  }
  throw new McpConfigError(`${where} needs a command (local program) or a url.`);
}

/** Parses the whole file. An empty file means no servers. */
export function parseMcpConfig(text: string): { servers: McpServerConfig[]; raw: Raw } {
  if (text.length > MAX_MCP_CONFIG_BYTES) throw new McpConfigError('The configuration is too large.');
  if (!text.trim()) return { servers: [], raw: { mcpServers: {} } };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (error) { throw new McpConfigError(`This is not valid JSON: ${(error as Error).message.slice(0, 200)}`); }
  if (!isObject(raw)) throw new McpConfigError('The configuration must be a JSON object with "mcpServers".');
  const servers = raw.mcpServers ?? {};
  if (!isObject(servers)) throw new McpConfigError('"mcpServers" must be an object.');
  const entries = Object.entries(servers);
  if (entries.length > MAX_MCP_SERVERS) throw new McpConfigError(`Up to ${MAX_MCP_SERVERS} servers are supported.`);
  return { servers: entries.map(([name, value]) => parseServer(name, value)), raw };
}

export const formatMcpConfig = (raw: Raw): string => JSON.stringify(raw, null, 2) + '\n';

/** The same file text with one server's approval changed; other fields are kept as written. */
export function withApproval(text: string, name: string, approval: McpApproval): string {
  const { raw } = parseMcpConfig(text);
  const servers = raw.mcpServers as Raw | undefined;
  if (!servers || !isObject(servers[name])) throw new McpConfigError(`Server "${name}" is not in the configuration.`);
  (servers[name] as Raw).approval = approval;
  return formatMcpConfig(raw);
}

/**
 * Adds Claude Desktop's servers whose names are not used yet. Existing servers are never
 * changed. Added servers ask before each call. Invalid entries are skipped and reported.
 */
export function importServers(text: string, otherText: string): { text: string; added: string[]; skipped: string[] } {
  const { raw } = parseMcpConfig(text);
  let other: unknown;
  try { other = JSON.parse(otherText); } catch { throw new McpConfigError('The Claude Desktop configuration is not valid JSON.'); }
  const incoming = isObject(other) && isObject(other.mcpServers) ? other.mcpServers : {};
  const servers: Raw = isObject(raw.mcpServers) ? raw.mcpServers : {};
  const added: string[] = [], skipped: string[] = [];
  for (const [name, value] of Object.entries(incoming)) {
    if (name in servers) { skipped.push(name); continue; }
    try { parseServer(name, value); } catch { skipped.push(name); continue; }
    if (Object.keys(servers).length >= MAX_MCP_SERVERS) { skipped.push(name); continue; }
    servers[name] = { ...(value as Raw), approval: 'ask' };
    added.push(name);
  }
  raw.mcpServers = servers;
  return { text: added.length ? formatMcpConfig(raw) : text, added, skipped };
}

/** Fields that need a restart of the running server when they change. */
export const launchKey = (server: McpServerConfig): string => JSON.stringify([server.kind, server.command, server.args, server.env, server.cwd, server.url, server.headers]);
