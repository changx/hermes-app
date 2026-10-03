import React, { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { FontSizeProvider, useFontSize } from '../FontSize';
import { AppProvider, useApp } from '../App';
import { ViewerProvider } from '../Viewers';

export const unstable_settings = { initialRouteName: 'index' };

function NativeRoutes() {
  const { ready, config, identity, editing, pendingPairing } = useApp();
  const { scale } = useFontSize();
  const router = useRouter();
  // Restore an interrupted authorization on its own page, not behind a chat.
  useEffect(() => {
    if (ready && editing && pendingPairing) router.replace('/connection');
  }, [ready, editing, pendingPairing, router]);
  // Keep the route until the cold SecureStore read completes; otherwise a
  // direct link is discarded before its saved identity can be restored.
  return <ViewerProvider key={identity}>
    <Stack key={identity} screenOptions={{ keyboardHandlingEnabled: true, headerBackButtonDisplayMode: 'minimal', contentStyle: { backgroundColor: '#f8fafc' }, headerTintColor: '#2b4e81',
      headerTitleStyle: { fontSize: 17 * scale }, headerBackTitleStyle: { fontSize: 17 * scale } }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="connection" options={{ title: 'Connection' }} />
      <Stack.Protected guard={!ready || (!!config && !(editing && pendingPairing))}>
        <Stack.Screen name="new-channel" options={{ title: 'New channel' }} />
        <Stack.Screen name="channels/[channelId]" options={{ title: 'Channel' }} />
        <Stack.Screen name="channels/[channelId]/context" options={{ title: 'Channel context' }} />
        <Stack.Screen name="channels/[channelId]/files" options={{ title: 'Files' }} />
        <Stack.Screen name="channels/[channelId]/agents" options={{ title: 'AGENTS.md' }} />
        <Stack.Screen name="channels/[channelId]/new-topic" options={{ title: 'New topic' }} />
        <Stack.Screen name="threads/[threadId]" getId={({ params }) => String(params?.threadId)} options={{ title: 'Conversation' }} />
        <Stack.Screen name="settings" options={{ title: 'Agent settings' }} />
        <Stack.Screen name="viewer/[id]" options={{ title: 'View' }} />
      </Stack.Protected>
    </Stack>
  </ViewerProvider>;
}

export default function RootLayout() {
  return <SafeAreaProvider><FontSizeProvider><KeyboardProvider><AppProvider><NativeRoutes /></AppProvider></KeyboardProvider></FontSizeProvider></SafeAreaProvider>;
}
