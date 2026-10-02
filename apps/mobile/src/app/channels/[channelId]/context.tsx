import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FormKeyboardAvoidingView, Notice, useApp } from '../../../App';
import { ChannelContextScreen } from '../../../ChannelContextScreen';
import { routeId } from '../../../routeId';

export default function ChannelContext() {
  const { channelId: rawId } = useLocalSearchParams<{ channelId: string }>();
  const { client } = useApp();
  const id = routeId(rawId);
  if (!id) return <Notice text="This channel is unavailable." />;
  if (!client) return null;
  return <SafeAreaView style={{ flex: 1 }} edges={['bottom', 'left', 'right']}>
    <FormKeyboardAvoidingView>
      <ChannelContextScreen key={id} client={client} channelId={id} />
    </FormKeyboardAvoidingView>
  </SafeAreaView>;
}
