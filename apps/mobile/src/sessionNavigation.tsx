import React, { createContext, useContext } from 'react';
import { useRouter } from 'expo-router';
import { parseSessionLink, sessionLinkRoute, sessionServer } from '../../../packages/client/src/sessionLinks';
import { Alert } from 'react-native';

const Pages = createContext<{ hasPage: (id: string) => boolean; server?: string }>({ hasPage: () => false });
export const SessionNavigationProvider = Pages.Provider;

export function navigateSession(router: Pick<ReturnType<typeof useRouter>, 'navigate' | 'dismissTo'>, hasPage: (id: string) => boolean, id: string, route: Parameters<ReturnType<typeof useRouter>['navigate']>[0]) {
  if (hasPage(id)) router.dismissTo(route);
  else router.navigate(route);
}

export function useSessionNavigation() {
  const router = useRouter(), pages = useContext(Pages);
  return {
    thread(id: string, messageRef?: number) {
      navigateSession(router, pages.hasPage, id, { pathname: '/threads/[threadId]', params: { threadId: id, ...(messageRef === undefined ? {} : { messageRef: String(messageRef) }) } });
    },
    link(href: string) {
      const target = parseSessionLink(href), route = sessionLinkRoute(href);
      if (!target || !route) return;
      if (pages.server && sessionServer(pages.server) !== target.server) {
        Alert.alert('This conversation belongs to another Hermes.'); return;
      }
      navigateSession(router, pages.hasPage, target.threadId, route as never);
    },
  };
}
