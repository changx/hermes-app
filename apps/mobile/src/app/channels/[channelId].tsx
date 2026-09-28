import React from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChannelsScreen, HeaderActions, Notice, useApp } from '../../App';
import { routeId } from '../../routeId';

export default function Channel() {
  const { channelId: rawId } = useLocalSearchParams<{ channelId: string }>();
  const router = useRouter();
  const id = routeId(rawId);
  const { client } = useApp();
  if (!id) return <Notice text="This channel is unavailable." />;
  const name = client?.channels.get(id)?.name;
  return <SafeAreaView style={{ flex: 1 }} edges={['bottom', 'left', 'right']}>
    <Stack.Screen options={{ title: name || 'Channel',
      headerRight: () => <HeaderActions onConnection={() => router.push('/connection')} onSettings={() => router.push('/settings')} /> }} />
    <ChannelsScreen channelId={id} />
  </SafeAreaView>;
}
