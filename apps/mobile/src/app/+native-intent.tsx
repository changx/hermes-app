import { sessionLinkRoute } from '../../../../packages/client/src/sessionLinks';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  // Preserve ordinary Expo Router routes and Expo Go launch URLs.
  if (!/^hermesapp:/i.test(path)) return path;
  return sessionLinkRoute(path) ?? '/session-unavailable';
}
