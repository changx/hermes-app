import { systemLinkRoute } from '../../../../packages/client/src/sessionLinks';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return systemLinkRoute(path);
}
