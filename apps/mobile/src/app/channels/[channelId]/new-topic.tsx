import React from 'react';
import { Stack, useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FormKeyboardAvoidingView, Notice, useApp } from '../../../App';
import { NewTopicEditor } from '../../../EditorScreens';
import { routeId } from '../../../routeId';
import { KeyboardCaptureButton, useKeyboardCapture } from '../../../KeyboardCapture';

export default function NewTopic() {
  const { channelId: rawId } = useLocalSearchParams<{ channelId: string }>();
  const channelId = routeId(rawId);
  const { client } = useApp();
  const router = useRouter();
  const diagnostics = useKeyboardCapture('new-topic', useIsFocused());
  if (!client || !channelId || !client.channels.has(channelId)) return <Notice text="This channel is unavailable." />;
  return <SafeAreaView style={{ flex: 1 }} edges={['bottom', 'left', 'right']}>
    <Stack.Screen options={{ headerRight: () => <KeyboardCaptureButton route="new-topic" /> }} />
    <FormKeyboardAvoidingView diagnostics={diagnostics}>
      <NewTopicEditor client={client} channelId={channelId} onDiagnosticLayout={diagnostics.onEditorLayout}
        onCreated={threadId => router.replace({ pathname: '/threads/[threadId]', params: { threadId } })} />
    </FormKeyboardAvoidingView>
  </SafeAreaView>;
}