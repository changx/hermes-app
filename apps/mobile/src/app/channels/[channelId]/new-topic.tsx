import React from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ConnectionScope, FormKeyboardAvoidingView, Notice, routeConnection, useApp } from '../../../App';
import { NewTopicEditor } from '../../../EditorScreens';
import { threadRoute } from '../../../sessionNavigation';
import { routeId } from '../../../routeId';

function Page({ channelId }: { channelId: string }) {
  const { client, slot } = useApp();
  const router = useRouter();
  if (!client || !client.channels.has(channelId)) return <Notice text="This channel is unavailable." />;
  return <FormKeyboardAvoidingView>
    <NewTopicEditor client={client} channelId={channelId} onCreated={threadId => router.replace(threadRoute(slot, threadId))} />
  </FormKeyboardAvoidingView>;
}

export default function NewTopic() {
  const { channelId: rawId, connection } = useLocalSearchParams<{ channelId: string; connection?: string | string[] }>();
  const channelId = routeId(rawId), slot = routeConnection(connection);
  if (!channelId || !slot) return <Notice text="This channel is unavailable." />;
  return <SafeAreaView style={{ flex: 1 }} edges={['bottom', 'left', 'right']}>
    <ConnectionScope slot={slot} fallback={<Notice text="This channel is unavailable." />}><Page channelId={channelId} /></ConnectionScope>
  </SafeAreaView>;
}
