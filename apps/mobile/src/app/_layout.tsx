import React, { useEffect, useMemo, useRef } from 'react';
import { Stack, useNavigationContainerRef } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { FontSizeProvider, useFontSize } from '../FontSize';
import { AppProvider, useConnections } from '../App';
import { ViewerProvider, useViewerOwner } from '../Viewers';
import { NetworkStatusToast } from '../NetworkStatusToast';
import { CopyToast } from '../CopyToast';
import { removedConnectionRoutes } from '../routeOwnership';

export const unstable_settings = { initialRouteName: 'index' };

/**
 * The Stack is never remounted for a connection change. Removing one
 * connection pops only its own routes and viewers; pages of other
 * connections keep their scene, scroll position and draft.
 */
function RouteOwnership({ owners }: { owners: ReadonlyMap<string, string | null> }) {
  const navigation = useNavigationContainerRef();
  const ownerOf = useViewerOwner();
  const known = useRef(owners);
  useEffect(() => {
    const removed = new Set([...known.current.keys()].filter(slot => !owners.has(slot)));
    const removedOwners = new Set([...known.current].filter(([slot]) => removed.has(slot)).flatMap(([, owner]) => owner ? [owner] : []));
    known.current = owners;
    if (!removed.size || !navigation.isReady()) return;
    const next = removedConnectionRoutes(navigation.getRootState(), removed, id => { const owner = ownerOf(id); return !!owner && removedOwners.has(owner); });
    if (next) navigation.resetRoot(next);
  }, [owners, navigation, ownerOf]);
  return null;
}

function NativeRoutes() {
  const { ready, connections } = useConnections();
  const { scale } = useFontSize();
  const owners = useMemo(() => new Map(connections.map(c => [c.slot, c.config?.id ?? c.pairing?.config.id ?? null])), [connections]);
  return <ViewerProvider>
    <RouteOwnership owners={owners} />
    <Stack screenOptions={{ keyboardHandlingEnabled: true, headerBackButtonDisplayMode: 'minimal', contentStyle: { backgroundColor: '#f8fafc' }, headerTintColor: '#2b4e81',
      headerTitleStyle: { fontSize: 17 * scale }, headerBackTitleStyle: { fontSize: 17 * scale } }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="welcome" options={{ headerShown: false }} />
      <Stack.Protected guard={!ready || connections.length > 0}>
        <Stack.Screen name="new-channel" options={{ title: 'New channel' }} />
        <Stack.Screen name="channels/[channelId]" getId={({ params }) => `${params?.connection ?? 'primary'}:${params?.channelId}`} options={{ title: 'Channel' }} />
        <Stack.Screen name="channels/[channelId]/context" options={{ title: 'Channel context' }} />
        <Stack.Screen name="channels/[channelId]/files" options={{ title: 'Files' }} />
        <Stack.Screen name="channels/[channelId]/agents" options={{ title: 'AGENTS.md' }} />
        <Stack.Screen name="channels/[channelId]/new-topic" options={{ title: 'New topic' }} />
        <Stack.Screen name="threads/[threadId]" getId={({ params }) => `${params?.connection ?? (params?.server ? 'link:' + params.server : 'primary')}:${params?.threadId}`} options={{ title: 'Conversation' }} />
        <Stack.Screen name="threads/[threadId]/options" options={{ title: 'Session options' }} />
        <Stack.Screen name="settings/index" options={{ title: 'Settings' }} />
        <Stack.Screen name="settings/connection" options={{ title: 'Connection' }} />
        <Stack.Screen name="settings/add-connection" options={{ title: 'Add connection' }} />
        <Stack.Screen name="settings/font-size" options={{ title: 'Font size' }} />
        <Stack.Screen name="viewer/[id]" options={{ title: 'View' }} />
      </Stack.Protected>
    </Stack>
  </ViewerProvider>;
}

/** One status line: the first connection that needs attention, named when several exist. */
function ConnectionToast() {
  const { connections } = useConnections();
  const live = connections.filter(c => c.client);
  const target = live.find(c => c.status !== 'online' && (c.status !== 'suspended' || c.failed)) ?? live[0];
  if (!target) return null;
  return <NetworkStatusToast state={target.status === 'pairing' ? 'connecting' : target.status} retryAt={target.retryAt} failed={target.failed}
    source={connections.length > 1 ? target.name : undefined} />;
}

export default function RootLayout() {
  return <SafeAreaProvider><FontSizeProvider><KeyboardProvider><AppProvider><NativeRoutes /><ConnectionToast /><CopyToast /></AppProvider></KeyboardProvider></FontSizeProvider></SafeAreaProvider>;
}
