/**
 * Removes only the routes that belong to removed connections from a
 * navigation state. Remaining routes keep their keys, so React Navigation
 * keeps their screens mounted with their scene, scroll and draft.
 */
type RouteLike = { key?: string; name: string; params?: object; state?: StateLike };
type StateLike = { index?: number; routes: RouteLike[]; [field: string]: unknown };

const CONNECTION_ROUTES = /^(channels\/|threads\/|settings\/connection$)/;

/** Connection slot of a route; routes without the parameter belong to the primary slot. */
export function routeSlot(route: RouteLike): string | null {
  if (!CONNECTION_ROUTES.test(route.name)) return null;
  const value = (route.params as { connection?: unknown } | undefined)?.connection;
  return typeof value === 'string' ? value : 'primary';
}

export function filterRoutes<S extends StateLike>(state: S, drop: (route: RouteLike) => boolean): S | null {
  let changed = false;
  const routes: RouteLike[] = [];
  for (const route of state.routes) {
    if (drop(route)) { changed = true; continue; }
    const nested = route.state ? filterRoutes(route.state, drop) : null;
    if (nested) { changed = true; routes.push({ ...route, state: nested }); } else routes.push(route);
  }
  if (!changed) return null;
  // Never leave an empty stack; the home route is always the safe base.
  if (!routes.length) routes.push({ name: 'index' });
  const focused = state.routes[state.index ?? state.routes.length - 1];
  const kept = routes.indexOf(focused);
  return { ...state, routes, index: kept >= 0 ? kept : routes.length - 1 };
}

export function removedConnectionRoutes<S extends StateLike>(state: S, removed: ReadonlySet<string>, viewerOwnedByRemoved: (id: string) => boolean = () => false): S | null {
  return filterRoutes(state, route => {
    const slot = routeSlot(route);
    if (slot !== null) return removed.has(slot);
    if (route.name === 'viewer/[id]') {
      const id = (route.params as { id?: unknown } | undefined)?.id;
      return typeof id === 'string' && viewerOwnedByRemoved(id);
    }
    return false;
  });
}
