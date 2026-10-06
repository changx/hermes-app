import React, { createContext, useContext, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { parseSessionLink } from '../../../packages/client/src/sessionLinks';
import { Alert } from 'react-native';

/**
 * Navigation scope of a page. The root scope knows every connection; a
 * connection page narrows it to its own slot so session links, source
 * navigation and viewers stay with the connection that opened them.
 */
export type SessionScope = Readonly<{
  /** Connection slot of the current page; null outside a connection page. */
  connection: string | null;
  /** Device credential identity of that connection; owns opened viewers. */
  owner: string | null;
  hasPage: (connection: string, id: string) => boolean;
  connectionForServer: (server: string) => string | null;
}>;
const Scope = createContext<SessionScope>({ connection: null, owner: null, hasPage: () => false, connectionForServer: () => null });
export const SessionNavigationProvider = Scope.Provider;
export const useSessionScope = () => useContext(Scope);

export function ConnectionScope({ connection, owner, children }: { connection: string; owner: string; children: React.ReactNode }) {
  const parent = useContext(Scope);
  const value = useMemo(() => ({ ...parent, connection, owner }), [parent, connection, owner]);
  return <Scope.Provider value={value}>{children}</Scope.Provider>;
}

export function threadRoute(connection: string | null, id: string, messageRef?: number) {
  return { pathname: '/threads/[threadId]' as const, params: { threadId: id, ...(connection ? { connection } : {}), ...(messageRef === undefined ? {} : { messageRef: String(messageRef) }) } };
}

export function navigateSession(router: Pick<ReturnType<typeof useRouter>, 'navigate' | 'dismissTo'>, hasPage: (id: string) => boolean, id: string, route: Parameters<ReturnType<typeof useRouter>['navigate']>[0]) {
  if (hasPage(id)) router.dismissTo(route);
  else { router.navigate(route); }
}

export function useSessionNavigation() {
  const router = useRouter(), scope = useContext(Scope);
  return {
    thread(id: string, messageRef?: number) {
      const connection = scope.connection;
      navigateSession(router, page => !!connection && scope.hasPage(connection, page), id, threadRoute(connection, id, messageRef));
    },
    link(href: string) {
      const target = parseSessionLink(href);
      if (!target) return;
      // A link names its server; open it with the matching saved connection.
      const connection = scope.connectionForServer(target.server);
      if (!connection) { Alert.alert('This conversation belongs to a Hermes that is not connected on this device.', 'Add that connection to open it.'); return; }
      navigateSession(router, page => scope.hasPage(connection, page), target.threadId, threadRoute(connection, target.threadId));
    },
  };
}
