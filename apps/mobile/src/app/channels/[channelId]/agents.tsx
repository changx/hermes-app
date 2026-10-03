import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FormKeyboardAvoidingView, Notice, useApp } from '../../../App';
import { ChannelAgentsScreen } from '../../../ChannelAgentsScreen';
import { routeId } from '../../../routeId';

export default function ChannelAgents() {
  const { channelId: rawId } = useLocalSearchParams<{ channelId: string }>();
  const { client, config } = useApp();
  const id = routeId(rawId);
  if (!id) return <Notice text="This channel is unavailable." />;
  if (!client || !config) return null;
  return <SafeAreaView style={{ flex: 1 }} edges={['bottom', 'left', 'right']}>
    <FormKeyboardAvoidingView><ChannelAgentsScreen key={config.id + ':' + id} client={client} channelId={id} /></FormKeyboardAvoidingView>
  </SafeAreaView>;
}
