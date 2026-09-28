import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Crypto from 'expo-crypto';
import { Text } from './FontSize';
import { routeId } from './routeId';

type Viewer = { title: string; content: React.ReactNode; onClose?: () => void };
type Viewers = {
  entries: Map<string, Viewer>;
  openViewer: (title: string, content: React.ReactNode, onClose?: () => void) => void;
  release: (id: string) => void;
};
const Context = createContext<Viewers | null>(null);

/** Private view content never enters URLs. Expo Router owns all history and transitions. */
export function ViewerProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const entries = useRef(new Map<string, Viewer>()).current;
  const release = useCallback((id: string) => {
    const entry = entries.get(id);
    entries.delete(id);
    // Cache cleanup must not prevent another viewer from closing.
    try { entry?.onClose?.(); } catch { /* best-effort private cache cleanup */ }
  }, [entries]);
  const openViewer = useCallback((title: string, content: React.ReactNode, onClose?: () => void) => {
    const id = Crypto.randomUUID();
    entries.set(id, { title, content, onClose });
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
  const value = useMemo(() => ({ entries, openViewer, release }), [entries, openViewer, release]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useViewer() {
  const value = useContext(Context);
  if (!value) throw new Error('ViewerProvider is required');
  return value;
}

function ViewerBody({ id }: { id: string | null }) {
  const { entries, release } = useViewer();
  const entry = id ? entries.get(id) : undefined;
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => { if (!mounted.current && id) release(id); });
    };
  }, [id, release]);
  return <SafeAreaView style={{ flex: 1 }} edges={['bottom', 'left', 'right']}>
    <Stack.Screen options={{ title: entry?.title || 'View' }} />
    {entry?.content ?? <Text style={{ padding: 20 }}>This view is no longer available. Open it again from the conversation.</Text>}
  </SafeAreaView>;
}

export function ViewerScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = routeId(params.id);
  return <ViewerBody key={id ?? 'unavailable'} id={id} />;
}
