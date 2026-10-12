import React from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View } from 'react-native';
import { ChannelsScreen, ConnectionScope, HeaderActions, HeaderIcon, HeaderTitle, Notice, channelRoute, routeConnection, useApp } from '../../App';
import { routeId } from '../../routeId';

function ChannelPage({ id }: { id: string }) {
  const router = useRouter();
  const { client, name, multiple, slot } = useApp();
  const title = client?.channels.get(id)?.name || 'Channel';
  return <>
    <Stack.Screen options={{ title, ...(multiple ? { headerTitle: () => <HeaderTitle title={title} subtitle={name} /> } : {}),
      headerRight: () => <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {client?.supportsAutomations && <HeaderIcon label="Automations" ios="clock.arrow.circlepath" android="schedule"
          onPress={() => router.push(channelRoute(slot, id, '/automations'))} />}
        <HeaderActions onSettings={() => router.push('/settings')} />
      </View> }} />
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
