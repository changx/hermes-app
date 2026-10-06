/** Settings page of one saved connection. */
export const connectionSettingsRoute = (connection: string) => ({ pathname: '/settings/connection' as const, params: { connection } });
