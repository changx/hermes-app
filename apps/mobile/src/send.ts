import type { Attachment, Receipt } from '../../../packages/client/src/index';

export const DEFAULT_BASE = 'https://agent.tuly.space';
export interface Connection { baseUrl: string; token: string; id: string }
export type SendState = 'queued' | 'sending' | 'ambiguous' | 'accepted' | 'blocked';
export interface SendRecord {
  connectionId: string;
  threadId: string;
  clientMessageId: string;
  text: string;
  attachments?: Attachment[];
  status: SendState;
  receiptId?: string;
  receiptState?: Receipt['state'];
  receiptAdmission?: Receipt['admission'];
  receiptHandedOff?: Receipt['handed_off'];
}

// Only an HTTPS origin is accepted. Credentials, paths, fragments and query strings
// cannot be accidentally carried into a WebSocket URL or saved as a server address.
export function normalizeBase(value: string): string {
  const base = value.trim();
  const match = /^https:\/\/([a-z\d-]+(?:\.[a-z\d-]+)*(?::\d{1,5})?)(?:\/)?$/i.exec(base);
  if (!match) throw new Error('服务器地址必须是 HTTPS 域名（不可包含路径、账号或参数）');
  return 'https://' + match[1].toLowerCase();
}
export function connection(baseUrl: string, token: string, id: string): Connection {
  if (!token.trim() || /[\r\n]/.test(token)) throw new Error('请输入有效的访问令牌');
  if (!id) throw new Error('连接标识缺失');
  return { baseUrl: normalizeBase(baseUrl), token: token.trim(), id };
}
export function editConnection(previous: Connection | null, base: string, token: string, newId: string): Connection {
  const baseUrl = normalizeBase(base);
  const sameOrigin = previous?.baseUrl === baseUrl;
  if (!sameOrigin && !token.trim()) throw new Error('更换服务器时必须重新输入该服务器的令牌');
  const nextToken = token.trim() || (sameOrigin ? previous!.token : '');
  const id = sameOrigin && nextToken === previous!.token ? previous!.id : newId;
  return connection(baseUrl, nextToken, id);
}
export function validSendContent(threadId: string, text: string, attachments: readonly Attachment[] = []): Attachment[] {
  if (!threadId || typeof text !== 'string' || !Array.isArray(attachments) || attachments.length > 8 ||
      (!text.trim() && !attachments.length)) throw new Error('请输入消息或添加附件（最多 8 个）');
  const seen = new Set<string>();
  return attachments.map(a => {
    if (!a || typeof a !== 'object' || typeof a.id !== 'string' || !/^att_[A-Za-z0-9_-]+$/.test(a.id) ||
        seen.has(a.id) || a.thread_id !== threadId || a.state !== 'available' || a.receipt_id != null ||
        typeof a.name !== 'string' || !a.name.length || a.name.length > 180 || a.name === '.' || a.name === '..' ||
        /[/\\\x00\r\n]/.test(a.name) || !Number.isSafeInteger(a.size) || a.size! <= 0 || a.size! > 10 * 1024 * 1024 ||
        typeof a.mime !== 'string' || !a.mime.length)
      throw new Error('附件无效或不属于当前话题');
    seen.add(a.id);
    return { ...a };
  });
}
export function newSend(config: Connection, threadId: string, text: string, id: string, attachments: Attachment[] = []): SendRecord {
  const verified = validSendContent(threadId, text, attachments);
  if (!/^mob_[a-f0-9-]{36}$/i.test(id)) throw new Error('消息标识无效');
  return { connectionId: config.id, threadId, text, clientMessageId: id, status: 'sending', ...(verified.length ? { attachments: verified } : {}) };
}
export function retrySend(config: Connection, record: SendRecord): SendRecord {
  if (record.connectionId !== config.id || record.status !== 'ambiguous' || record.receiptId) throw new Error('这条消息不能原样重试');
  return { ...record, status: 'sending' };
}
export function accepted(record: SendRecord, receipt: Receipt): SendRecord {
  if (receipt.client_message_id !== record.clientMessageId || receipt.thread_id !== record.threadId) throw new Error('收据与消息不匹配');
  return { ...record, status: 'accepted', receiptId: receipt.id, receiptState: receipt.state, receiptAdmission: receipt.admission, receiptHandedOff: receipt.handed_off };
}
export function restoreSend(raw: string | null, config: Connection): SendRecord | null {
  if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('待发送记录损坏');
  const r = value as Partial<SendRecord>;
  if (r.connectionId !== config.id) return null;
  if (typeof r.threadId !== 'string' || typeof r.clientMessageId !== 'string' || typeof r.text !== 'string' ||
      !/^mob_[a-f0-9-]{36}$/i.test(r.clientMessageId) || !['queued','sending','ambiguous','accepted','blocked'].includes(r.status || '')) throw new Error('待发送记录损坏');
  let attachments: Attachment[];
  try { attachments = validSendContent(r.threadId, r.text, r.attachments); }
  catch { throw new Error('待发送记录损坏'); }
  if (r.receiptAdmission !== undefined && r.receiptAdmission !== 'followup') throw new Error('收据记录损坏');
  if (r.receiptHandedOff !== undefined && r.receiptHandedOff !== true) throw new Error('收据记录损坏');
  if (r.status === 'accepted' && typeof r.receiptId !== 'string') throw new Error('收据记录损坏');
  // A process may have died after dispatch but before storing the response.
  return { ...r, ...(attachments.length ? { attachments } : { attachments: undefined }), status: r.status === 'sending' ? 'ambiguous' : r.status } as SendRecord;
}
export function sendDescription(record: SendRecord): string {
  const states: Record<Receipt['state'], string> = { queued: '排队中', running: '执行中', received: '已接收', completed: '已完成', failed: '失败', interrupted: '已停止', unknown: '执行结果待核对（不会自动重跑）' };
  return record.status === 'queued' ? '已保存在本机 · 等待连接' : record.status === 'sending' ? '提交中' : record.status === 'ambiguous' ? '正在自动核对接收状态' : record.status === 'blocked' ? '发送受阻 · 记录已保留' : `已接收 · ${record.receiptState ? states[record.receiptState] : '查询中'}`;
}
