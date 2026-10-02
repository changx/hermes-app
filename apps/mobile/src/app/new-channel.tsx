import React from 'react';
import { Stack, useIsFocused, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FormKeyboardAvoidingView, Notice, useApp } from '../App';
import { NewChannelEditor } from '../EditorScreens';
import { KeyboardCaptureButton, useKeyboardCapture } from '../KeyboardCapture';

export default function NewChannel() {
  const { client } = useApp();
  const router = useRouter();
  const diagnostics = useKeyboardCapture('new-channel', useIsFocused());
  if (!client) return <Notice text="Opening…" />;
  return <SafeAreaView style={{ flex: 1 }} edges={['bottom', 'left', 'right']}>
    <Stack.Screen options={{ headerRight: () => <KeyboardCaptureButton route="new-channel" /> }} />
    <FormKeyboardAvoidingView diagnostics={diagnostics}>
      <NewChannelEditor client={client} onDiagnosticLayout={diagnostics.onEditorLayout}
        onCreated={channelId => router.replace({ pathname: '/channels/[channelId]', params: { channelId } })} />
    </FormKeyboardAvoidingView>
  </SafeAreaView>;
}