import type { Receipt } from '../../../packages/client/src/index';

export const DEFAULT_BASE = 'https://agent.tuly.space';
export interface Connection { baseUrl: string; token: string; id: string }
export type SendState = 'sending' | 'ambiguous' | 'accepted';
export interface SendRecord {
  connectionId: string;
  threadId: string;
  clientMessageId: string;
  text: string;
  status: SendState;
  receiptId?: string;
  receiptState?: Receipt['state'];
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
export function newSend(config: Connection, threadId: string, text: string, id: string): SendRecord {
  if (!threadId || !text.trim()) throw new Error('请输入消息');
  if (!/^mob_[a-f0-9-]{36}$/i.test(id)) throw new Error('消息标识无效');
  return { connectionId: config.id, threadId, text, clientMessageId: id, status: 'sending' };
}
export function retrySend(config: Connection, record: SendRecord): SendRecord {
  if (record.connectionId !== config.id || record.status !== 'ambiguous' || record.receiptId) throw new Error('这条消息不能原样重试');
  return { ...record, status: 'sending' };
}
export function accepted(record: SendRecord, receipt: Receipt): SendRecord {
  if (receipt.client_message_id !== record.clientMessageId || receipt.thread_id !== record.threadId) throw new Error('收据与消息不匹配');
  return { ...record, status: 'accepted', receiptId: receipt.id, receiptState: receipt.state };
}
export function restoreSend(raw: string | null, config: Connection): SendRecord | null {
  if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('待发送记录损坏');
  const r = value as Partial<SendRecord>;
  if (r.connectionId !== config.id) return null;
  if (typeof r.threadId !== 'string' || typeof r.clientMessageId !== 'string' || typeof r.text !== 'string' || !r.text.trim() ||
      !/^mob_[a-f0-9-]{36}$/i.test(r.clientMessageId) || !['sending','ambiguous','accepted'].includes(r.status || '')) throw new Error('待发送记录损坏');
  if (r.status === 'accepted' && typeof r.receiptId !== 'string') throw new Error('收据记录损坏');
  // A process may have died after dispatch but before storing the response.
  return { ...r, status: r.status === 'sending' ? 'ambiguous' : r.status } as SendRecord;
}
export function sendDescription(record: SendRecord): string {
  const states: Record<Receipt['state'], string> = { queued: '排队中', running: '执行中', completed: '已完成', failed: '失败', interrupted: '已停止', unknown: '执行状态不明（请人工确认）' };
  return record.status === 'sending' ? '提交中，尚未确认接收' : record.status === 'ambiguous' ? '接收结果不明；仅可用原 ID 和原文重试' : `已持久接收 · ${record.receiptState ? states[record.receiptState] : '查询中'}`;
}
