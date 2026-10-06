import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ConnectionScope, FormKeyboardAvoidingView, Notice, routeConnection, useApp } from '../../../App';
import { ChannelContextScreen } from '../../../ChannelContextScreen';
import { routeId } from '../../../routeId';

function Page({ id }: { id: string }) {
  const { client, config } = useApp();
  if (!client || !config) return null;
  return <FormKeyboardAvoidingView><ChannelContextScreen key={config.id + ':' + id} client={client} channelId={id} /></FormKeyboardAvoidingView>;
}

export default function ChannelContext() {
  const { channelId: rawId, connection } = useLocalSearchParams<{ channelId: string; connection?: string | string[] }>();
  const id = routeId(rawId), slot = routeConnection(connection);
  if (!id || !slot) return <Notice text="This channel is unavailable." />;
  return <SafeAreaView style={{ flex: 1 }} edges={['bottom', 'left', 'right']}>
    <ConnectionScope slot={slot} fallback={<Notice text="This channel is unavailable." />}><Page id={id} /></ConnectionScope>
  </SafeAreaView>;
}
