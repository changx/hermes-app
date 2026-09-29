import React from 'react';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FormKeyboardAvoidingView, Notice, useApp } from '../App';
import { NewChannelEditor } from '../EditorScreens';

export default function NewChannel() {
  const { client } = useApp();
  const router = useRouter();
  if (!client) return <Notice text="Opening…" />;
  return <SafeAreaView style={{ flex: 1 }} edges={['bottom', 'left', 'right']}>
    <FormKeyboardAvoidingView>
      <NewChannelEditor client={client}
        onCreated={channelId => router.replace({ pathname: '/channels/[channelId]', params: { channelId } })} />
    </FormKeyboardAvoidingView>
  </SafeAreaView>;
}