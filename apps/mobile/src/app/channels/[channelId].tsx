import React from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChannelsScreen, ConnectionScope, HeaderActions, HeaderTitle, Notice, routeConnection, settingsRoute, useApp } from '../../App';
import { routeId } from '../../routeId';

function ChannelPage({ id }: { id: string }) {
  const router = useRouter();
  const { client, slot, name, multiple } = useApp();
  const title = client?.channels.get(id)?.name || 'Channel';
  return <>
    <Stack.Screen options={{ title, ...(multiple ? { headerTitle: () => <HeaderTitle title={title} subtitle={name} /> } : {}),
      headerRight: () => <HeaderActions onConnection={() => router.push('/connection')} onSettings={() => router.push(settingsRoute(slot))} /> }} />
    <ChannelsScreen channelId={id} />
  </>;
}

export default function Channel() {
  const { channelId: rawId, connection } = useLocalSearchParams<{ channelId: string; connection?: string | string[] }>();
  const id = routeId(rawId), slot = routeConnection(connection);
  if (!id || !slot) return <Notice text="This channel is unavailable." />;
  return <SafeAreaView style={{ flex: 1 }} edges={['bottom', 'left', 'right']}>
    <ConnectionScope slot={slot} fallback={<Notice text="This channel is unavailable." />}><ChannelPage id={id} /></ConnectionScope>
  </SafeAreaView>;
}
