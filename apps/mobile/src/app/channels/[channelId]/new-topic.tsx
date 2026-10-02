import React from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FormKeyboardAvoidingView, Notice, useApp } from '../../../App';
import { NewTopicEditor } from '../../../EditorScreens';
import { routeId } from '../../../routeId';

export default function NewTopic() {
  const { channelId: rawId } = useLocalSearchParams<{ channelId: string }>();
  const channelId = routeId(rawId);
  const { client } = useApp();
  const router = useRouter();
  if (!client || !channelId || !client.channels.has(channelId)) return <Notice text="This channel is unavailable." />;
  return <SafeAreaView style={{ flex: 1 }} edges={['bottom', 'left', 'right']}>
    <FormKeyboardAvoidingView>
      <NewTopicEditor client={client} channelId={channelId}
        onCreated={threadId => router.replace({ pathname: '/threads/[threadId]', params: { threadId } })} />
    </FormKeyboardAvoidingView>
  </SafeAreaView>;
}