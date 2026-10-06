import React from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ConnectionScope, FormKeyboardAvoidingView, Notice, routeConnection, useApp } from '../../App';
import { ConnectionSettings } from '../../SettingsScreens';

function Title() {
  const { name } = useApp();
  return <Stack.Screen options={{ title: name }} />;
}

export default function ConnectionSettingsRoute() {
  const { connection } = useLocalSearchParams<{ connection?: string | string[] }>();
  const slot = routeConnection(connection);
  if (!slot) return <Notice text="This connection is unavailable." />;
  return <SafeAreaView style={{ flex: 1, backgroundColor: '#f2f5f9' }} edges={['bottom', 'left', 'right']}>
    <ConnectionScope slot={slot} fallback={<Notice text="This connection was removed." />}>
      <Title />
      <FormKeyboardAvoidingView><ConnectionSettings /></FormKeyboardAvoidingView>
    </ConnectionScope>
  </SafeAreaView>;
}
