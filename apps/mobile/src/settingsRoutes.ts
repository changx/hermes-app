/** Settings page of one saved connection. */
export const connectionSettingsRoute = (connection: string) => ({ pathname: '/settings/connection' as const, params: { connection } });
/** Passwords & Logins saved on one connection's Hermes. */
export const vaultSettingsRoute = (connection: string) => ({ pathname: '/settings/vault' as const, params: { connection } });
