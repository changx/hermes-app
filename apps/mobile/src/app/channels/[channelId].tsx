import React from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChannelsScreen, ConnectionScope, HeaderActions, HeaderTitle, Notice, routeConnection, useApp } from '../../App';
import { routeId } from '../../routeId';

function ChannelPage({ id }: { id: string }) {
  const router = useRouter();
  const { client, name, multiple } = useApp();
  const title = client?.channels.get(id)?.name || 'Channel';
  return <>
    <Stack.Screen options={{ title, ...(multiple ? { headerTitle: () => <HeaderTitle title={title} subtitle={name} /> } : {}),
      headerRight: () => <HeaderActions onSettings={() => router.push('/settings')} /> }} />
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
