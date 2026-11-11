/** Settings page of one saved connection. */
export const connectionSettingsRoute = (connection: string) => ({ pathname: '/settings/connection' as const, params: { connection } });
/** Passwords & Logins saved on one connection's Hermes. */
export const vaultSettingsRoute = (connection: string) => ({ pathname: '/settings/vault' as const, params: { connection } });
/** API keys of one connection's Hermes profile. */
export const envKeysSettingsRoute = (connection: string) => ({ pathname: '/settings/env-keys' as const, params: { connection } });
/** SOUL.md, USER.md and MEMORY.md of one connection's Hermes profile. */
export const profileFilesSettingsRoute = (connection: string) => ({ pathname: '/settings/profile-files' as const, params: { connection } });
/** Editor of one of these files. */
export const profileFileSettingsRoute = (connection: string, file: 'soul' | 'user' | 'memory') => ({ pathname: '/settings/profile-file' as const, params: { connection, file } });
