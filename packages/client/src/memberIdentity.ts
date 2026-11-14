/**
 * Who this connection's credential speaks as (plugin `GET /v1/me`, capability `member_identity`).
 * The server decides: a paired device speaks as its bound member, an unbound device can only
 * read, and the administrator token speaks as no member. Clients show it read-only.
 */
export type MemberIdentity = { auth: 'device' | 'admin'; deviceId: string | null; member: string | null };

const MEMBER = /^[A-Za-z][A-Za-z0-9_.-]{0,31}$/;

/** Validated `/v1/me` body, or undefined when the server sent something else. */
export function parseMemberIdentity(body: unknown): MemberIdentity | undefined {
  const x = body as { auth?: unknown; device_id?: unknown; member?: unknown } | null;
  if (!x || typeof x !== 'object' || (x.auth !== 'device' && x.auth !== 'admin')) return undefined;
  const deviceId = typeof x.device_id === 'string' && x.device_id ? x.device_id : null;
  const member = typeof x.member === 'string' && MEMBER.test(x.member) ? x.member : null;
  if (x.member !== null && x.member !== undefined && member === null) return undefined;
  return { auth: x.auth, deviceId, member: x.auth === 'admin' ? null : member };
}

/** Text for the read-only identity row. `bound` is false when this device cannot send. */
export function memberIdentityText(identity: MemberIdentity): { value: string; hint: string; bound: boolean } {
  if (identity.auth === 'admin') return { value: 'Administrator token', hint: 'Messages from this connection are not attributed to a team member.', bound: true };
  if (identity.member) return { value: identity.member, hint: 'Your messages are labelled with this name. Only an administrator can change it.', bound: true };
  return { value: 'Not linked to a team member', hint: 'You can read but not send. Ask an administrator to link this device.', bound: false };
}
