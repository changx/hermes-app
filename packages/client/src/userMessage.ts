/** Optional display metadata must never invalidate a message or its history page. */
export function userMessageSender(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,31}$/.exec(value)?.[0] === value ? value : undefined;
}

/** Display/copy/edit text only. Keep the server's original body and send identity intact. */
export function userMessageText(message: { role: string; text: string; sender?: string }): string {
  const sender = message.role === 'user' ? userMessageSender(message.sender) : undefined;
  const prefix = sender ? `[${sender}] ` : undefined;
  return prefix && message.text.startsWith(prefix) ? message.text.slice(prefix.length) : message.text;
}
