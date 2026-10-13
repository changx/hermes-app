import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Crypto from 'expo-crypto';
import { Text } from './FontSize';
import { routeId } from './routeId';
import { SessionNavigationProvider, useSessionScope } from './sessionNavigation';

type Viewer = { title: string; content: React.ReactNode; onClose?: () => void; owner: string | null };
type Viewers = {
  entries: Map<string, Viewer>;
  openViewer: (title: string, content: React.ReactNode, onClose?: () => void) => void;
  release: (id: string) => void;
};
type Registry = Omit<Viewers, 'openViewer'> & { open: (title: string, content: React.ReactNode, onClose: (() => void) | undefined, owner: string | null) => void };
const Context = createContext<Registry | null>(null);

/**
 * Private view content never enters URLs. Expo Router owns all history and
 * transitions. A viewer records the connection that opened it, so removing
 * that connection can pop exactly its viewers (see RouteOwnership).
 */
export function ViewerProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const entries = useRef(new Map<string, Viewer>()).current;
  const release = useCallback((id: string) => {
    const entry = entries.get(id);
    entries.delete(id);
    // Cache cleanup must not prevent another viewer from closing.
    try { entry?.onClose?.(); } catch { /* best-effort private cache cleanup */ }
  }, [entries]);
  const open = useCallback((title: string, content: React.ReactNode, onClose: (() => void) | undefined, owner: string | null) => {
    const id = Crypto.randomUUID();
    entries.set(id, { title, content, onClose, owner });
    try { router.push({ pathname: '/viewer/[id]', params: { id } }); }
    catch (error) { release(id); throw error; }
  }, [entries, release, router]);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // A StrictMode effect replay is not a route/identity removal.
      queueMicrotask(() => { if (!mounted.current) for (const id of entries.keys()) release(id); });
    };
  }, [entries, release]);
  const value = useMemo(() => ({ entries, open, release }), [entries, open, release]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Owner of an open viewer route, used to pop a removed connection's viewers. */
export function useViewerOwner(): (id: string) => string | null | undefined {
  const value = useContext(Context);
  return useCallback((id: string) => value?.entries.get(id)?.owner, [value]);
}

export function useViewer(): Viewers {
  const value = useContext(Context);
  if (!value) throw new Error('ViewerProvider is required');
  const scope = useSessionScope();
  // The viewer route renders outside the opener, so it carries the opener's scope.
  const openViewer = useCallback((title: string, content: React.ReactNode, onClose?: () => void) =>
    value.open(title, <SessionNavigationProvider value={scope}>{content}</SessionNavigationProvider>, onClose, scope.owner), [value, scope]);
  return useMemo(() => ({ entries: value.entries, release: value.release, openViewer }), [value, openViewer]);
}

function ViewerBody({ id }: { id: string | null }) {
  const { entries, release } = useViewer();
  const entry = id ? entries.get(id) : undefined;
  // Content such as a gallery can rename the page; `Stack.Screen` reapplies this title on focus changes.
  const [title, setTitle] = useState(entry?.title || 'View');
  const options = useMemo(() => ({ title }), [title]);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => { if (!mounted.current && id) release(id); });
    };
  }, [id, release]);
  return <SafeAreaView style={{ flex: 1 }} edges={['bottom', 'left', 'right']}>
    <Stack.Screen options={options} />
    <ViewerTitle.Provider value={setTitle}>
      {entry?.content ?? <Text style={{ padding: 20 }}>This view is no longer available. Open it again from the conversation.</Text>}
    </ViewerTitle.Provider>
  </SafeAreaView>;
}

const ViewerTitle = createContext<((title: string) => void) | null>(null);
/** Sets the title of the viewer page that shows this content. */
export function useViewerTitle(title: string) {
  const setTitle = useContext(ViewerTitle);
  useEffect(() => { setTitle?.(title); }, [setTitle, title]);
}

export function ViewerScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = routeId(params.id);
  return <ViewerBody key={id ?? 'unavailable'} id={id} />;
}
