import type { Attachment, Receipt } from '../../../packages/client/src/index';
import { validTimestampSeconds } from './messageTime.ts';
import { MAX_FILE_ATTACHMENT_BYTES } from './attachmentHelpers.ts';

export const DEFAULT_BASE = 'https://agent.tuly.space';
export interface Connection { baseUrl: string; token: string; id: string }
export type SendState = 'queued' | 'sending' | 'ambiguous' | 'accepted' | 'blocked';
/** First message of a session that is not created yet: the outbox creates the session
 * with the record's thread ID (same ID on every retry), then sends the message. */
export interface ThreadCreate { channelId: string; title: string; automationEditor?: true }
export interface SendRecord {
  connectionId: string;
  threadId: string;
  clientMessageId: string;
  text: string;
  attachments?: Attachment[];
  createdAt?: number;
  status: SendState;
  create?: ThreadCreate;
  receiptId?: string;
  receiptState?: Receipt['state'];
  receiptRefSeq?: number;
  receiptAdmission?: Receipt['admission'];
  receiptHandedOff?: Receipt['handed_off'];
  receiptProcessing?: Receipt['processing'];
  receiptFeedback?: Receipt['feedback'];
}

// Only an HTTPS origin is accepted. Credentials, paths, fragments and query strings
// cannot be accidentally carried into a WebSocket URL or saved as a server address.
export function normalizeBase(value: string): string {
  const base = value.trim();
  const match = /^https:\/\/([a-z\d-]+(?:\.[a-z\d-]+)*(?::\d{1,5})?)(?:\/)?$/i.exec(base);
  if (!match) throw new Error('Enter an HTTPS server address without a path, account details, or query parameters.');
  return 'https://' + match[1].toLowerCase();
}
export function connection(baseUrl: string, token: string, id: string): Connection {
  if (!token.trim() || /[\r\n]/.test(token)) throw new Error('Enter valid connection credentials.');
  if (!id) throw new Error('Connection details are missing.');
  return { baseUrl: normalizeBase(baseUrl), token: token.trim(), id };
}
export function editConnection(previous: Connection | null, base: string, token: string, newId: string): Connection {
  const baseUrl = normalizeBase(base);
  const sameOrigin = previous?.baseUrl === baseUrl;
  if (!sameOrigin && !token.trim()) throw new Error('Enter new connection credentials when changing servers.');
  const nextToken = token.trim() || (sameOrigin ? previous!.token : '');
  const id = sameOrigin && nextToken === previous!.token ? previous!.id : newId;
  return connection(baseUrl, nextToken, id);
}
export function validSendContent(threadId: string, text: string, attachments: readonly Attachment[] = []): Attachment[] {
  if (!threadId || typeof text !== 'string' || !Array.isArray(attachments) || attachments.length > 8 ||
      (!text.trim() && !attachments.length)) throw new Error('Enter a message or add up to 8 attachments.');
  const seen = new Set<string>();
  return attachments.map(a => {
    if (!a || typeof a !== 'object' || typeof a.id !== 'string' || !/^att_[A-Za-z0-9_-]+$/.test(a.id) ||
        seen.has(a.id) || a.thread_id !== threadId || a.state !== 'available' || a.receipt_id != null ||
        typeof a.name !== 'string' || !a.name.length || a.name.length > 180 || a.name === '.' || a.name === '..' ||
        /[/\\\x00\r\n]/.test(a.name) || !Number.isSafeInteger(a.size) || a.size! <= 0 || a.size! > MAX_FILE_ATTACHMENT_BYTES ||
        typeof a.mime !== 'string' || !a.mime.length)
      throw new Error('This attachment is invalid or belongs to another conversation.');
    seen.add(a.id);
    return { ...a };
  });
}
export function validCreate(value: unknown): value is ThreadCreate {
  if (!value || typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  return Object.keys(c).every(k => k === 'channelId' || k === 'title' || k === 'automationEditor') &&
    typeof c.channelId === 'string' && c.channelId.length > 0 && c.channelId.length <= 200 &&
    typeof c.title === 'string' && c.title.trim().length > 0 && c.title.length <= 200 &&
    (c.automationEditor === undefined || c.automationEditor === true);
}
export function newSend(config: Connection, threadId: string, text: string, id: string, attachments: Attachment[] = [], create?: ThreadCreate): SendRecord {
  const verified = validSendContent(threadId, text, attachments);
  if (!/^mob_[a-f0-9-]{36}$/i.test(id)) throw new Error('Invalid message identifier.');
  // A session is created only with a text-only first message; files need the session first.
  if (create !== undefined && (!validCreate(create) || verified.length || !/^th_[A-Za-z0-9_-]{1,120}$/.test(threadId))) throw new Error('This conversation cannot be started.');
  return { connectionId: config.id, threadId, text, clientMessageId: id, status: 'sending', createdAt: Date.now() / 1000, ...(verified.length ? { attachments: verified } : {}),
    ...(create ? { create: { channelId: create.channelId, title: create.title, ...(create.automationEditor ? { automationEditor: true as const } : {}) } } : {}) };
}
export function retrySend(config: Connection, record: SendRecord): SendRecord {
  if (record.connectionId !== config.id || record.status !== 'ambiguous' || record.receiptId) throw new Error('This message cannot be sent again unchanged.');
  return { ...record, status: 'sending' };
}
export function accepted(record: SendRecord, receipt: Receipt): SendRecord {
  if (receipt.client_message_id !== record.clientMessageId || receipt.thread_id !== record.threadId || record.receiptId && receipt.id !== record.receiptId) throw new Error('The confirmation does not match this message.');
  if (receipt.ref_seq !== undefined && (!Number.isSafeInteger(receipt.ref_seq) || receipt.ref_seq <= 0 || record.receiptRefSeq !== undefined && record.receiptRefSeq !== receipt.ref_seq)) throw new Error('The confirmation reference does not match this message.');
  const keepCallback = receipt.processing === undefined ||
    ['completed', 'failed', 'interrupted'].includes(record.receiptProcessing ?? '');
  return { ...record, status: 'accepted', receiptId: receipt.id, receiptState: receipt.state, receiptRefSeq: receipt.ref_seq ?? record.receiptRefSeq, receiptAdmission: receipt.admission, receiptHandedOff: receipt.handed_off, receiptProcessing: keepCallback ? record.receiptProcessing : receipt.processing, receiptFeedback: receipt.feedback ?? record.receiptFeedback };
}
export function restoreSend(raw: string | null, config: Connection): SendRecord | null {
  if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('The saved message is damaged.');
  const r = value as Partial<SendRecord>;
  if (r.connectionId !== config.id) return null;
  if (r.createdAt !== undefined && !validTimestampSeconds(r.createdAt)) throw new Error('The saved message is damaged.');
  if (r.receiptRefSeq !== undefined && (!Number.isSafeInteger(r.receiptRefSeq) || r.receiptRefSeq <= 0)) throw new Error('The saved message reference is damaged.');
  if (typeof r.threadId !== 'string' || typeof r.clientMessageId !== 'string' || typeof r.text !== 'string' ||
      !/^mob_[a-f0-9-]{36}$/i.test(r.clientMessageId) || !['queued','sending','ambiguous','accepted','blocked'].includes(r.status || '')) throw new Error('The saved message is damaged.');
  let attachments: Attachment[];
  try { attachments = validSendContent(r.threadId, r.text, r.attachments); }
  catch { throw new Error('The saved message is damaged.'); }
  if (r.receiptAdmission !== undefined && r.receiptAdmission !== 'followup') throw new Error('The saved message status is damaged.');
  if (r.receiptHandedOff !== undefined && r.receiptHandedOff !== true) throw new Error('The saved message status is damaged.');
  if (r.receiptProcessing !== undefined && r.receiptProcessing !== null && !['running','completed','failed','interrupted','unknown'].includes(r.receiptProcessing)) throw new Error('The saved message status is damaged.');
  if (r.receiptFeedback !== undefined && (typeof r.receiptFeedback !== 'string' || !r.receiptFeedback.length || r.receiptFeedback.length > 2000)) throw new Error('The saved message status is damaged.');
  if (r.status === 'accepted' && typeof r.receiptId !== 'string') throw new Error('The saved message status is damaged.');
  if (r.create !== undefined && (!validCreate(r.create) || attachments.length)) throw new Error('The saved message is damaged.');
  // A process may have died after dispatch but before storing the response.
  return { ...r, ...(attachments.length ? { attachments } : { attachments: undefined }), status: r.status === 'sending' ? 'ambiguous' : r.status } as SendRecord;
}
export function sendDescription(record: SendRecord): string {
  const states: Record<Receipt['state'], string> = { queued: 'Queued', running: 'Working', received: 'Received', completed: 'Completed', failed: 'Failed', interrupted: 'Stopped', unknown: 'Outcome unknown (will not run again automatically)' };
  return record.status === 'queued' ? 'Saved on this device · Waiting for a connection' : record.status === 'sending' ? 'Sending' : record.status === 'ambiguous' ? 'Checking whether your message was received' : record.status === 'blocked' ? 'Unable to send · Message saved' : `Received · ${record.receiptState ? states[record.receiptState] : 'Checking'}`;
}
